"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, ExternalLink, Save, Send, ThumbsDown } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import type { MerchantDraft } from "@/types/domain";
import type { PlacementsResponse, PublishResponse } from "@/lib/onboarding/api";
import { asExtraction } from "@/lib/onboarding/types";
import { AdminApiError, adminApi, type DraftEdits } from "./adminApi";
import { forApprovalProposal, proposalIssues, reviewChecklist, STATUS_LABEL, type Proposal } from "./editor";
import { EmployeeEditor } from "./EmployeeEditor";
import { ExtractionPanel } from "./ExtractionPanel";
import { Section, TextArea } from "./fields";
import { MerchantEditor } from "./MerchantEditor";
import { PlacementPicker, type PlacementChoice } from "./PlacementPicker";
import { ProductTable } from "./ProductTable";
import { StatusChip } from "./StatusChip";

interface Failure {
  message: string;
  problems: string[];
}

const failure = (err: unknown): Failure =>
  err instanceof AdminApiError ? { message: err.message, problems: err.problems } : { message: err instanceof Error ? err.message : "Something went wrong.", problems: [] };

/**
 * Step 2 (review) and step 3 (approve, publish) for one draft. The whole proposal is edited
 * locally and saved as one PATCH; approval is a separate, explicit act that the server
 * re-validates; publishing is only offered for an approved, saved draft.
 */
export function DraftReview({ draft, onDraft }: { draft: MerchantDraft; onDraft: (d: MerchantDraft) => void }) {
  const extraction = useMemo(() => asExtraction(draft.extraction), [draft.extraction]);
  const [proposal, setProposal] = useState<Proposal>(draft.proposal);
  const [placement, setPlacement] = useState<PlacementChoice | undefined>(draft.placement);
  const [notes, setNotes] = useState(draft.reviewerNotes ?? "");
  const [dirty, setDirty] = useState(false);
  const [revision, setRevision] = useState(0);
  const [placements, setPlacements] = useState<PlacementsResponse | null>(null);
  const [placementsError, setPlacementsError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "save" | "approve" | "reject" | "publish">(null);
  const [fail, setFail] = useState<Failure | null>(null);
  const [published, setPublished] = useState<PublishResponse | null>(null);
  const locked = draft.status === "published";

  useEffect(() => {
    let alive = true;
    adminApi
      .placements(draft.id)
      .then((r) => alive && setPlacements(r))
      .catch((err: unknown) => alive && setPlacementsError(failure(err).message));
    return () => {
      alive = false;
    };
  }, [draft.id, draft.status]);

  const edit = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setDirty(true);
    setRevision((r) => r + 1);
    setFail(null);
  };
  const onProposal = edit(setProposal);
  const onPlacement = edit((p: PlacementChoice | null) => setPlacement(p ?? undefined));
  const onNotes = edit(setNotes);

  const parcel = placement ? placements?.parcels.find((o) => o.parcel.id === placement.parcelId)?.parcel : undefined;
  const issues = useMemo(() => proposalIssues(proposal), [proposal]);
  const checklist = useMemo(() => reviewChecklist(proposal, extraction, parcel), [proposal, extraction, parcel]);

  const edits = (): DraftEdits => ({ proposal, placement: placement ?? null, reviewerNotes: notes });
  const adopt = (d: MerchantDraft) => {
    onDraft(d);
    setProposal(d.proposal);
    setPlacement(d.placement);
    setNotes(d.reviewerNotes ?? "");
    setDirty(false);
  };

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(kind);
    setFail(null);
    try {
      await fn();
    } catch (err) {
      setFail(failure(err));
    } finally {
      setBusy(null);
    }
  };

  const save = () => run("save", async () => adopt(await adminApi.patchDraft(draft.id, edits())));

  const approve = () =>
    run("approve", async () => {
      const body: DraftEdits = { ...edits(), proposal: forApprovalProposal(proposal) };
      // extracted/rejected → in_review first (the state machine has no shortcut to approved).
      const reopened = draft.status === "extracted" || draft.status === "rejected";
      if (reopened) adopt(await adminApi.patchDraft(draft.id, { ...body, status: "in_review" }));
      adopt(await adminApi.patchDraft(draft.id, reopened ? { status: "approved" } : { ...body, status: "approved" }));
    });

  const reject = () => run("reject", async () => adopt(await adminApi.patchDraft(draft.id, { reviewerNotes: notes, status: "rejected" })));

  const publish = () =>
    run("publish", async () => {
      const result = await adminApi.publish(draft.id);
      setPublished(result);
      adopt(await adminApi.getDraft(draft.id));
    });

  const cityUrl = published?.cityUrl ?? (locked ? `/city?to=${encodeURIComponent(draft.proposal.merchant.slug)}` : null);

  return (
    <div className="flex flex-col gap-4" data-testid="draft-review" data-status={draft.status}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">Step 2 · Review</p>
          <h2 className="truncate font-display text-2xl font-semibold tracking-tight">{proposal.merchant.name}</h2>
        </div>
        <div className="flex items-center gap-2">
          <StatusChip status={draft.status} />
          {dirty ? <Badge tone="sodium">Unsaved changes</Badge> : null}
        </div>
      </div>

      <fieldset disabled={locked || busy !== null} className="flex min-w-0 flex-col gap-4">
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <ExtractionPanel extraction={extraction} />
          <MerchantEditor proposal={proposal} extraction={extraction} onChange={onProposal} />
        </div>
        <ProductTable proposal={proposal} extraction={extraction} onChange={onProposal} />
        <div className="grid min-w-0 gap-4 xl:grid-cols-2">
          <EmployeeEditor proposal={proposal} onChange={onProposal} />
          <div className="flex min-w-0 flex-col gap-4">
            <PlacementPicker data={placements} error={placementsError} merchant={proposal.merchant} placement={placement} onChange={onPlacement} />
            <Section eyebrow="Audit" title="Reviewer notes">
              <TextArea label="Notes (kept with the draft)" value={notes} maxLength={2000} rows={4} onChange={onNotes} />
            </Section>
          </div>
        </div>
      </fieldset>

      <ApprovePanel
        key={revision}
        status={draft.status}
        dirty={dirty}
        busy={busy}
        schemaIssues={issues.schema}
        readiness={issues.readiness}
        checklist={checklist}
        fail={fail}
        cityUrl={cityUrl}
        onSave={save}
        onApprove={approve}
        onReject={reject}
        onPublish={publish}
      />
    </div>
  );
}

function ApprovePanel({
  status,
  dirty,
  busy,
  schemaIssues,
  readiness,
  checklist,
  fail,
  cityUrl,
  onSave,
  onApprove,
  onReject,
  onPublish,
}: {
  status: MerchantDraft["status"];
  dirty: boolean;
  busy: string | null;
  schemaIssues: string[];
  readiness: string[];
  checklist: ReturnType<typeof reviewChecklist>;
  fail: Failure | null;
  cityUrl: string | null;
  onSave: () => void;
  onApprove: () => void;
  onReject: () => void;
  onPublish: () => void;
}) {
  // Both acknowledgements reset on every edit (the panel is keyed by revision).
  const [reviewed, setReviewed] = useState(false);
  const [pricesOk, setPricesOk] = useState(false);
  const priceFlags = checklist.pricesNotInSource.length;
  const blockers = [
    ...schemaIssues,
    ...readiness,
    ...(checklist.placementChosen ? [] : ["Choose a district and a parcel."]),
    ...(checklist.templateProblem ? [checklist.templateProblem] : []),
    ...(checklist.interiorProblem ? [checklist.interiorProblem] : []),
    ...(checklist.noFulfillment ? ["Enable at least one fulfillment channel."] : []),
  ];
  const canApprove = status !== "published" && blockers.length === 0 && reviewed && (priceFlags === 0 || pricesOk) && !busy;
  const canPublish = status === "approved" && !dirty && !busy;

  if (status === "published") {
    return (
      <Section eyebrow="Step 3 · Done" title="Published to the city" className="border-mint/30">
        <div className="flex flex-col gap-3" data-testid="publish-success">
          <p className="flex items-center gap-2 text-[15px] text-mint">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> The store is live in the city. This draft is now read-only.
          </p>
          {cityUrl ? (
            <a href={cityUrl} className="inline-flex min-h-11 w-fit items-center gap-2 rounded-xl bg-signal px-4 font-display font-semibold text-night hover:bg-[#ff7053]" data-testid="city-link">
              Walk there: {cityUrl} <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          ) : null}
        </div>
      </Section>
    );
  }

  return (
    <Section eyebrow="Step 3" title="Approve and publish">
      <div className="flex flex-col gap-4" data-testid="approve-panel">
        <ul className="grid gap-1.5 text-[13px] sm:grid-cols-2">
          <Check ok={checklist.included > 0}>
            {checklist.included} product{checklist.included === 1 ? "" : "s"} included{checklist.excluded ? `, ${checklist.excluded} excluded (dropped on approval)` : ""}
          </Check>
          <Check ok={priceFlags === 0} warn>
            {priceFlags === 0 ? "Every price appears in the source catalog" : `${priceFlags} price${priceFlags === 1 ? "" : "s"} not in the source: ${checklist.pricesNotInSource.slice(0, 3).join(", ")}`}
          </Check>
          <Check ok={checklist.placementChosen && !checklist.templateProblem}>{checklist.placementChosen ? checklist.templateProblem ?? "Placement fits the storefront template" : "No placement yet"}</Check>
          <Check ok={checklist.platformRulesKept}>Employee keeps the platform rules (no medical claims, no invented prices)</Check>
        </ul>

        {blockers.length ? (
          <div className="rounded-lg border border-danger/30 bg-danger/8 p-3 text-[13px]" data-testid="approve-blockers">
            <p className="mb-1 font-medium text-danger">Fix before approving</p>
            <ul className="list-disc space-y-0.5 pl-5 text-fog-2">
              {blockers.slice(0, 12).map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {fail ? (
          <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-[13px]" role="alert" data-testid="action-error">
            <p className="font-medium text-danger">{fail.message}</p>
            {fail.problems.length ? (
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-fog-2">
                {fail.problems.slice(0, 12).map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-1">
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-[14px]">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-signal)]" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} data-testid="reviewed-checkbox" />
            <span>
              <span className="font-medium text-fog">I reviewed this merchant</span>
              <span className="block text-[12px] text-fog-3">Name, prices, images, AI employee and placement match the real store and contain nothing misleading.</span>
            </span>
          </label>
          {priceFlags ? (
            <label className="flex min-h-11 cursor-pointer items-start gap-3 text-[14px]">
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-sodium)]" checked={pricesOk} onChange={(e) => setPricesOk(e.target.checked)} />
              <span>
                <span className="font-medium text-sodium">I confirmed the {priceFlags} price{priceFlags === 1 ? "" : "s"} that differ from the source</span>
                <span className="block text-[12px] text-fog-3">Customers will pay these prices.</span>
              </span>
            </label>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="md" leading={<Save className="h-4 w-4" />} onClick={onSave} loading={busy === "save"} disabled={!dirty || Boolean(busy)} data-testid="save-draft">
            Save draft
          </Button>
          <Button variant="secondary" size="md" leading={<CheckCircle2 className="h-4 w-4" />} onClick={onApprove} loading={busy === "approve"} disabled={!canApprove} data-testid="approve-draft">
            {status === "approved" && !dirty ? "Approved" : "Approve"}
          </Button>
          <Button variant={status === "approved" ? "primary" : "secondary"} size="md" leading={<Send className="h-4 w-4" />} onClick={onPublish} loading={busy === "publish"} disabled={!canPublish} data-testid="publish-draft">
            Publish to the city
          </Button>
          <span className="flex-1" />
          <Button variant="ghost" size="md" leading={<ThumbsDown className="h-4 w-4" />} onClick={onReject} loading={busy === "reject"} disabled={Boolean(busy) || status === "rejected"} data-testid="reject-draft">
            Reject
          </Button>
        </div>
        <p className="text-[12px] text-fog-3">
          {status === "approved"
            ? dirty
              ? "You edited an approved draft: approve it again before publishing."
              : "Approved. Publishing creates the merchant, its products and employee, and takes the parcel."
            : `Status: ${STATUS_LABEL[status]}. Publishing is available once the draft is approved.`}
        </p>
      </div>
    </Section>
  );
}

function Check({ ok, warn = false, children }: { ok: boolean; warn?: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span aria-hidden="true" className={ok ? "text-mint" : warn ? "text-sodium" : "text-danger"}>
        {ok ? "✓" : warn ? "!" : "✕"}
      </span>
      <span className={ok ? "text-fog-2" : "text-fog"}>{children}</span>
    </li>
  );
}
