"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { KeyRound, LogOut, Plus, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import type { MerchantDraft, MerchantType } from "@/types/domain";
import { AdminApiError, adminApi } from "./adminApi";
import { DraftReview } from "./DraftReview";
import { inputClass, SelectField } from "./fields";
import { StatusChip } from "./StatusChip";

export interface GeneratorAppProps {
  /** A token is configured and this browser has no valid admin cookie yet. */
  needsToken: boolean;
  tokenRequired: boolean;
  aiConfigured: boolean;
  /** Dev only: loopback fixture stores may be extracted (`?allowLocal=1`). */
  allowLocal: boolean;
  initialDraftId?: string;
}

/**
 * /admin/generate: paste a store URL → extract → review → approve → publish. Internal tool;
 * the server gates every call (ADMIN_ACCESS_TOKEN in production) and owns every rule.
 */
export function GeneratorApp({ needsToken, tokenRequired, aiConfigured, allowLocal, initialDraftId }: GeneratorAppProps) {
  if (needsToken) return <TokenGate />;
  return <Generator tokenRequired={tokenRequired} aiConfigured={aiConfigured} allowLocal={allowLocal} initialDraftId={initialDraftId} />;
}

function Generator({ tokenRequired, aiConfigured, allowLocal, initialDraftId }: Omit<GeneratorAppProps, "needsToken">) {
  const [drafts, setDrafts] = useState<MerchantDraft[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | undefined>(initialDraftId);

  const refresh = useCallback(async () => {
    try {
      setDrafts(await adminApi.listDrafts());
      setListError(null);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Could not load drafts.");
    }
  }, []);

  useEffect(() => {
    // Initial load of the drafts list (external data); the effect only kicks it off.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const select = (id: string | undefined) => {
    setSelectedId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("draft", id);
    else url.searchParams.delete("draft");
    window.history.replaceState(null, "", url);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const upsert = (d: MerchantDraft) => setDrafts((list) => [d, ...(list ?? []).filter((x) => x.id !== d.id)]);
  const selected = drafts?.find((d) => d.id === selectedId);

  return (
    <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-5 px-4 pb-16 pt-6 sm:px-6" data-testid="admin-generator">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Chifir admin · internal prototype</p>
          <h1 className="font-display text-3xl font-bold tracking-tight">Merchant generator</h1>
          <p className="mt-1 max-w-2xl text-[14px] text-fog-2">
            Paste a store URL. We read its public catalog, propose a merchant, and a person reviews every field before anything reaches the city.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={aiConfigured ? "signal" : "neutral"}>
            <Sparkles className="h-3 w-3" aria-hidden="true" /> {aiConfigured ? "AI structuring on" : "No AI key: heuristic proposals"}
          </Badge>
          {allowLocal ? <Badge tone="sodium">Local fixtures allowed (dev)</Badge> : null}
          {tokenRequired ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-11 sm:h-9"
              leading={<LogOut className="h-3.5 w-3.5" />}
              onClick={() => void adminApi.endSession().finally(() => window.location.reload())}
            >
              Sign out
            </Button>
          ) : null}
        </div>
      </header>

      <DraftList drafts={drafts} error={listError} selectedId={selectedId} onSelect={select} onRefresh={() => void refresh()} />

      {selected ? (
        <DraftReview key={selected.id} draft={selected} onDraft={upsert} />
      ) : (
        <ExtractStep
          allowLocal={allowLocal}
          onExtracted={(d) => {
            upsert(d);
            select(d.id);
          }}
        />
      )}
    </main>
  );
}

function DraftList({
  drafts,
  error,
  selectedId,
  onSelect,
  onRefresh,
}: {
  drafts: MerchantDraft[] | null;
  error: string | null;
  selectedId: string | undefined;
  onSelect: (id: string | undefined) => void;
  onRefresh: () => void;
}) {
  return (
    <nav aria-label="Drafts" className="sign flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow">Drafts {drafts ? `(${drafts.length})` : ""}</p>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="h-11 min-w-11 sm:h-9 sm:min-w-0" leading={<RefreshCw className="h-3.5 w-3.5" />} onClick={onRefresh} aria-label="Refresh drafts">
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button variant={selectedId ? "secondary" : "ghost"} size="sm" className="h-11 sm:h-9" leading={<Plus className="h-3.5 w-3.5" />} onClick={() => onSelect(undefined)} data-testid="new-extraction">
            New
          </Button>
        </div>
      </div>
      {error ? <p className="text-[13px] text-danger">{error}</p> : null}
      {drafts && drafts.length === 0 ? <p className="text-[13px] text-fog-3">No drafts yet. Extract a store below.</p> : null}
      {drafts && drafts.length ? (
        <ul className="scroll-thin -mx-1 flex gap-2 overflow-x-auto px-1 pb-1" data-testid="draft-list">
          {drafts.map((d) => (
            <li key={d.id} className="shrink-0">
              <button
                type="button"
                onClick={() => onSelect(d.id)}
                aria-current={d.id === selectedId ? "page" : undefined}
                className={cn(
                  "flex min-h-11 max-w-[16rem] flex-col items-start gap-1 rounded-xl border px-3 py-2 text-left transition-colors",
                  d.id === selectedId ? "border-signal/60 bg-signal/10" : "border-line hover:bg-white/4",
                )}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="truncate font-display text-[14px] font-semibold">{d.proposal.merchant.name}</span>
                  <StatusChip status={d.status} />
                </span>
                <span className="w-full truncate text-[11px] text-fog-3">
                  {hostOf(d.sourceUrl)} · {new Date(d.updatedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </nav>
  );
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

const TYPE_HINTS: Array<{ value: "" | MerchantType; label: string }> = [
  { value: "", label: "Detect automatically" },
  { value: "restaurant", label: "Restaurant / food" },
  { value: "retail", label: "Retail" },
  { value: "service", label: "Service" },
  { value: "venue", label: "Venue" },
  { value: "popup", label: "Pop-up" },
];

function ExtractStep({ allowLocal, onExtracted }: { allowLocal: boolean; onExtracted: (d: MerchantDraft) => void }) {
  const [url, setUrl] = useState("");
  const [type, setType] = useState<"" | MerchantType>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onExtracted(await adminApi.extract(url.trim(), { allowLocal, ...(type ? { merchantType: type } : {}) }));
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Extraction failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sign p-5 sm:p-6" aria-labelledby="extract-title">
      <p className="eyebrow">Step 1 · Extract</p>
      <h2 id="extract-title" className="font-display text-xl font-semibold tracking-tight">
        Paste a store URL
      </h2>
      <p className="mt-1 max-w-2xl text-[14px] text-fog-2">
        Shopify stores work best: we read <code className="text-fog">/products.json</code>, <code className="text-fog">/collections.json</code> and the homepage. Other sites give identity only. Only public{" "}
        <code className="text-fog">https</code> hosts are fetched.
      </p>
      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem_auto] sm:items-end">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-fog-2">Store URL</span>
          <input
            className={inputClass}
            type="url"
            inputMode="url"
            required
            placeholder="https://store.example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            data-testid="extract-url"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <SelectField label="Merchant type" value={type} options={TYPE_HINTS} onChange={setType} />
        <Button type="submit" size="md" loading={busy} leading={<Wand2 className="h-4 w-4" />} data-testid="extract-submit" className="min-h-11">
          {busy ? "Reading the store…" : "Extract"}
        </Button>
      </form>
      {error ? (
        <p className="mt-3 text-[14px] text-danger" role="alert" data-testid="extract-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function TokenGate() {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminApi.startSession(token);
      window.location.reload();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not sign in.");
      setBusy(false);
    }
  };
  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-4 py-16">
      <form onSubmit={submit} className="sign flex flex-col gap-4 p-6" data-testid="admin-token-gate">
        <div>
          <p className="eyebrow">Chifir admin</p>
          <h1 className="font-display text-2xl font-bold tracking-tight">Admin access</h1>
          <p className="mt-1 text-[14px] text-fog-2">Enter the admin access token. It is stored in an httpOnly cookie for 12 hours.</p>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-fog-2">Token</span>
          <input className={inputClass} type="password" autoComplete="current-password" value={token} onChange={(e) => setToken(e.target.value)} minLength={16} required />
        </label>
        {error ? <p className="text-[13px] text-danger" role="alert">{error}</p> : null}
        <Button type="submit" loading={busy} leading={<KeyRound className="h-4 w-4" />}>
          Continue
        </Button>
      </form>
    </main>
  );
}
