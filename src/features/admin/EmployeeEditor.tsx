"use client";

import type { EmployeeContextKey } from "@/types/domain";
import { PLATFORM_PROHIBITED_CLAIMS } from "@/lib/validation/merchantDraft";
import type { Proposal, ProposalEmployee } from "./editor";
import { ListEditor, Section, TextArea, TextField, Toggle } from "./fields";

const CONTEXT: Array<{ key: EmployeeContextKey; label: string; hint: string }> = [
  { key: "cart", label: "Cart", hint: "What the visitor has in their cart" },
  { key: "dietary", label: "Dietary", hint: "Saved dietary preferences" },
  { key: "budget", label: "Budget", hint: "A budget the visitor mentioned" },
  { key: "location", label: "Location", hint: "Delivery area / city district" },
  { key: "occasion", label: "Occasion", hint: "Date night, gift, birthday…" },
];

/**
 * The merchant's AI employee. Platform prohibitions are locked (the server re-adds them anyway);
 * everything else is the reviewer's call. Only name/role/greeting ever reach the browser later.
 */
export function EmployeeEditor({ proposal, onChange }: { proposal: Proposal; onChange: (p: Proposal) => void }) {
  const e = proposal.employee;
  const set = (patch: Partial<ProposalEmployee>) => onChange({ ...proposal, employee: { ...e, ...patch } });
  const toggleContext = (key: EmployeeContextKey, on: boolean) =>
    set({ allowedContext: on ? [...new Set([...e.allowedContext, key])] : e.allowedContext.filter((k) => k !== key) });

  return (
    <Section eyebrow="In-store AI" title="AI employee">
      <div className="flex flex-col gap-5" data-testid="employee-editor">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Name" value={e.name} maxLength={40} onChange={(name) => set({ name })} />
          <TextField label="Role" value={e.role} maxLength={40} onChange={(role) => set({ role })} hint="Shown in the UI: host, barista, stylist…" />
          <TextArea className="sm:col-span-2" label="Greeting" value={e.greeting} maxLength={280} rows={2} onChange={(greeting) => set({ greeting })} />
          <TextArea label="Personality" value={e.personality} maxLength={400} rows={3} onChange={(personality) => set({ personality })} />
          <TextField label="Tone" value={e.tone} maxLength={120} onChange={(tone) => set({ tone })} />
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <ListEditor label="Knowledge" items={e.knowledge} max={20} onChange={(knowledge) => set({ knowledge })} hint="Plain facts the employee may state. Keep to what the source says." />
          <ListEditor
            label="Prohibited claims"
            items={e.prohibitedClaims}
            max={12}
            locked={PLATFORM_PROHIBITED_CLAIMS}
            onChange={(prohibitedClaims) => set({ prohibitedClaims })}
            hint="Platform rules (locked) always apply."
          />
          <ListEditor label="Upsell rules" items={e.upsellRules} max={10} onChange={(upsellRules) => set({ upsellRules })} />
          <ListEditor label="Brand language" items={e.brandLanguage} max={10} onChange={(brandLanguage) => set({ brandLanguage })} placeholder="Words or phrases the brand uses" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset>
            <legend className="mb-1 text-[13px] font-semibold text-fog">Allowed context</legend>
            {CONTEXT.map((c) => (
              <Toggle key={c.key} label={c.label} hint={c.hint} checked={e.allowedContext.includes(c.key)} onChange={(on) => toggleContext(c.key, on)} />
            ))}
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[13px] font-semibold text-fog">Escalation</legend>
            <Toggle label="Hand off to a person when stuck" checked={e.escalation.enabled} onChange={(enabled) => set({ escalation: { ...e.escalation, enabled } })} />
            <TextField
              label="Escalation contact"
              value={e.escalation.contact ?? ""}
              maxLength={120}
              placeholder="Optional: email or phone"
              onChange={(v) => {
                const { contact: _drop, ...rest } = e.escalation;
                void _drop;
                set({ escalation: v.trim() ? { ...rest, contact: v } : rest });
              }}
            />
          </fieldset>
        </div>
      </div>
    </Section>
  );
}
