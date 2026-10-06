"use client";

import type { MerchantType, StorefrontConfig } from "@/types/domain";
import { INTERIOR_RULE_LIST, STOREFRONT_RULE_LIST } from "@/lib/onboarding/placement";
import type { Extraction } from "@/lib/onboarding/types";
import { CHANNELS, changeMerchantType, contrastRatio, toggleChannel, type Channel, type Proposal, type ProposalMerchant } from "./editor";
import { ColorField, Section, SelectField, TextArea, TextField, Thumb, Toggle } from "./fields";
import { InteriorPreview, StorefrontPreview } from "./TemplatePreview";

const TYPES: Array<{ value: MerchantType; label: string }> = [
  { value: "restaurant", label: "Restaurant / food" },
  { value: "retail", label: "Retail" },
  { value: "service", label: "Service" },
  { value: "venue", label: "Venue" },
  { value: "popup", label: "Pop-up" },
];

const CHANNEL_LABEL: Record<Channel, string> = {
  delivery: "Delivery",
  pickup: "Pickup",
  shipping: "Shipping",
  booking: "Booking",
};

const opt = <T extends string>(values: readonly T[]) => values.map((v) => ({ value: v, label: v[0]?.toUpperCase() + v.slice(1) }));

export function MerchantEditor({ proposal, extraction, onChange }: { proposal: Proposal; extraction: Extraction; onChange: (p: Proposal) => void }) {
  const m = proposal.merchant;
  const set = (patch: Partial<ProposalMerchant>) => onChange({ ...proposal, merchant: { ...m, ...patch } });
  const setConfig = (patch: Partial<StorefrontConfig>) => set({ storefrontConfig: { ...m.storefrontConfig, ...patch } });
  const setOptional = (key: "tagline" | "logoUrl" | "heroImageUrl" | "websiteUrl", value: string) => {
    const next = { ...m };
    if (value.trim()) next[key] = value;
    else delete next[key];
    onChange({ ...proposal, merchant: next });
  };
  const contrast = contrastRatio(m.brand.primary, m.brand.onPrimary);
  const swatches = extraction.colorCandidates;
  const imageChoices = [...new Set([...extraction.logoCandidates, ...(extraction.ogImage ? [extraction.ogImage] : [])])];

  return (
    <Section eyebrow="Proposal" title="Proposed merchant">
      <div className="flex flex-col gap-6" data-testid="merchant-editor">
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="sr-only">Identity</legend>
          <TextField label="Name" value={m.name} maxLength={80} onChange={(name) => set({ name })} testId="merchant-name" />
          <TextField label="Slug (deep link)" value={m.slug} maxLength={64} onChange={(slug) => set({ slug: slug.toLowerCase() })} hint={`/city?to=${m.slug}`} />
          <TextField className="sm:col-span-2" label="Tagline" value={m.tagline ?? ""} maxLength={120} onChange={(v) => setOptional("tagline", v)} placeholder="Optional" />
          <TextArea className="sm:col-span-2" label="Description" value={m.description} maxLength={600} onChange={(description) => set({ description })} />
          <TextField label="Category" value={m.category} maxLength={64} onChange={(category) => set({ category: category.toLowerCase() })} hint="Dot-namespaced, e.g. food.ramen" />
          <SelectField label="Merchant type" value={m.merchantType} options={TYPES} onChange={(t) => onChange(changeMerchantType(proposal, t))} testId="merchant-type" />
          <SelectField
            label="Price level"
            value={String(m.priceLevel ?? "")}
            options={[{ value: "", label: "Not set" }, ...[1, 2, 3, 4].map((n) => ({ value: String(n), label: "$".repeat(n) }))]}
            onChange={(v) => {
              const next = { ...m };
              if (v) next.priceLevel = Number(v) as 1 | 2 | 3 | 4;
              else delete next.priceLevel;
              onChange({ ...proposal, merchant: next });
            }}
          />
          <TextField label="Tags" value={m.tags.join(", ")} onChange={(v) => set({ tags: v.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 12) })} hint="Comma separated, max 12" />
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-[13px] font-semibold text-fog">Brand colours</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["primary", "secondary", "accent", "onPrimary"] as const).map((key) => (
              <ColorField key={key} label={key === "onPrimary" ? "Text on primary" : key[0]?.toUpperCase() + key.slice(1)} value={m.brand[key]} swatches={swatches} onChange={(v) => set({ brand: { ...m.brand, [key]: v } })} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-lg px-3 py-2 font-display text-[15px] font-semibold" style={{ background: m.brand.primary, color: m.brand.onPrimary }}>
              {m.storefrontConfig.signText ?? m.name}
            </span>
            <span className="h-8 w-8 rounded-md" style={{ background: m.brand.secondary }} aria-label="Secondary" />
            <span className="h-8 w-8 rounded-md" style={{ background: m.brand.accent }} aria-label="Accent" />
            <span className={contrast >= 4.5 ? "text-[12px] text-mint" : "text-[12px] text-sodium"}>Sign contrast {contrast.toFixed(1)}:1{contrast < 4.5 ? " (low)" : ""}</span>
          </div>
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-1 text-[13px] font-semibold text-fog">Images</legend>
          {(["logoUrl", "heroImageUrl"] as const).map((key) => (
            <div key={key} className="flex flex-col gap-2">
              <div className="flex items-end gap-2">
                <TextField className="flex-1" type="url" label={key === "logoUrl" ? "Logo URL" : "Hero image URL"} value={m[key] ?? ""} onChange={(v) => setOptional(key, v)} placeholder="https://…" />
                <Thumb src={m[key]} alt={key === "logoUrl" ? "Logo preview" : "Hero preview"} className="h-11 w-11 sm:h-9 sm:w-9" />
              </div>
              {imageChoices.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {imageChoices.map((url) => (
                    <button key={url} type="button" onClick={() => setOptional(key, url)} title={url} aria-label={`Use ${url}`} className={m[key] === url ? "rounded-lg ring-2 ring-sodium" : "rounded-lg opacity-80 hover:opacity-100"}>
                      <Thumb src={url} alt="" className="h-11 w-11 sm:h-9 sm:w-9" />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          <TextField className="sm:col-span-2" type="url" label="Website" value={m.websiteUrl ?? ""} onChange={(v) => setOptional("websiteUrl", v)} />
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-[13px] font-semibold text-fog">Building</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-end gap-3">
              <SelectField
                className="flex-1"
                label="Storefront template"
                value={m.storefrontTemplate}
                testId="storefront-template"
                options={STOREFRONT_RULE_LIST.map((r) => ({ value: r.id, label: r.suitableFor.includes(m.merchantType) ? r.label : `${r.label} (not for ${m.merchantType})`, disabled: !r.suitableFor.includes(m.merchantType) }))}
                onChange={(storefrontTemplate) => set({ storefrontTemplate })}
                hint={`Fits: ${STOREFRONT_RULE_LIST.find((r) => r.id === m.storefrontTemplate)?.suitableTiers.join(", ")} lots`}
              />
              <StorefrontPreview template={m.storefrontTemplate} brand={m.brand} config={m.storefrontConfig} />
            </div>
            <div className="flex items-end gap-3">
              <SelectField
                className="flex-1"
                label="Interior template"
                value={m.interiorTemplate}
                options={INTERIOR_RULE_LIST.map((r) => ({ value: r.id, label: r.suitableFor.includes(m.merchantType) ? r.label : `${r.label} (not for ${m.merchantType})`, disabled: !r.suitableFor.includes(m.merchantType) }))}
                onChange={(interiorTemplate) => set({ interiorTemplate })}
              />
              <InteriorPreview template={m.interiorTemplate} brand={m.brand} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField label="Sign text" value={m.storefrontConfig.signText ?? ""} maxLength={40} placeholder={m.name} onChange={(v) => {
              const next = { ...m.storefrontConfig };
              if (v.trim()) next.signText = v;
              else delete next.signText;
              set({ storefrontConfig: next });
            }} />
            <SelectField label="Sign style" value={m.storefrontConfig.signStyle} options={opt(["neon", "backlit", "painted", "marquee"] as const)} onChange={(signStyle) => setConfig({ signStyle })} />
            <SelectField label="Façade" value={m.storefrontConfig.facade} options={opt(["brick", "plaster", "glass", "concrete", "wood", "tile"] as const)} onChange={(facade) => setConfig({ facade })} />
            <SelectField label="Floors" value={String(m.storefrontConfig.floors) as "1" | "2" | "3"} options={opt(["1", "2", "3"] as const)} onChange={(v) => setConfig({ floors: Number(v) as 1 | 2 | 3 })} />
            <SelectField label="Window display" value={m.storefrontConfig.windowDisplay} options={opt(["products", "menu", "none"] as const)} onChange={(windowDisplay) => setConfig({ windowDisplay })} />
            <div className="flex flex-col justify-end">
              <Toggle label="Awning" checked={m.storefrontConfig.awning} onChange={(awning) => setConfig({ awning })} />
              <Toggle label="Accent lights" checked={m.storefrontConfig.accentLights} onChange={(accentLights) => setConfig({ accentLights })} />
            </div>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-[13px] font-semibold text-fog">Fulfillment</legend>
          <p className="mb-1 text-[12px] text-fog-3">Provider: simulated (a real provider is wired by hand after onboarding). Products follow the store&apos;s channels.</p>
          <div className="grid gap-x-4 sm:grid-cols-2">
            {CHANNELS.map((c) => (
              <Toggle key={c} label={CHANNEL_LABEL[c]} checked={Boolean(m.fulfillment[c]?.enabled)} onChange={(on) => onChange(toggleChannel(proposal, c, on))} hint={channelHint(m, c)} />
            ))}
          </div>
        </fieldset>
      </div>
    </Section>
  );
}

function channelHint(m: ProposalMerchant, c: Channel): string | undefined {
  const f = m.fulfillment;
  if (c === "delivery" && f.delivery) return `${f.delivery.minutesMin}–${f.delivery.minutesMax} min, $${(f.delivery.feeCents / 100).toFixed(2)} fee`;
  if (c === "pickup" && f.pickup) return `${f.pickup.minutesMin}–${f.pickup.minutesMax} min`;
  if (c === "shipping" && f.shipping) return `${f.shipping.daysMin}–${f.shipping.daysMax} days, $${(f.shipping.feeCents / 100).toFixed(2)}`;
  if (c === "booking" && f.booking) return `${f.booking.slotMinutes} min slots`;
  return undefined;
}
