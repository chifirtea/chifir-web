import type {
  FulfillmentOptions,
  FulfillmentType,
  MerchantDraftStatus,
  MerchantProposal,
  MerchantType,
  Parcel,
  VariantGroup,
} from "@/types/domain";
import { formatCents } from "@/lib/utils/money";
import { merchantProposalSchema, proposalProblems, PLATFORM_PROHIBITED_CLAIMS } from "@/lib/validation/merchantDraft";
import { defaultTemplates, INTERIOR_RULES, placementProblem, STOREFRONT_RULES } from "@/lib/onboarding/placement";
import type { Extraction } from "@/lib/onboarding/types";

/**
 * Pure helpers behind the review editor. The editor holds the whole proposal (exclusions are
 * `active: false` until approval strips them), validates it with the same Zod schema the server
 * uses, and summarises what the reviewer must look at before approving.
 */

export type Proposal = MerchantProposal;
export type ProposalMerchant = Proposal["merchant"];
export type ProposalProduct = Proposal["products"][number];
export type ProposalEmployee = Proposal["employee"];

export const STATUS_LABEL: Record<MerchantDraftStatus, string> = {
  extracted: "Extracted",
  in_review: "In review",
  approved: "Approved",
  published: "Published",
  rejected: "Rejected",
};

/** "68", "68.5", "$1,249.00" → cents; anything else (incl. 3+ decimals) → null. */
export function parseDollars(input: string): number | null {
  const m = input.trim().replace(/^\$/, "").replace(/,/g, "").match(/^(\d{1,7})(?:\.(\d{1,2}))?$/);
  if (!m?.[1]) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

export const dollarsInput = (cents: number): string => (cents / 100).toFixed(2);

/** "Size: S, M, L (+$4), XL (+$4) · Color: Navy, Olive (+$50)" */
export function variantSummary(groups: readonly VariantGroup[]): string {
  if (groups.length === 0) return "No options";
  return groups
    .map((g) => {
      const opts = g.options.map((o) => (o.priceDeltaCents ? `${o.name} (${o.priceDeltaCents > 0 ? "+" : ""}${formatCents(o.priceDeltaCents)})` : o.name));
      return `${g.name}: ${opts.join(", ")}`;
    })
    .join(" · ");
}

export interface IssueList {
  /** Schema errors, "path: message". */
  schema: string[];
  /** Readiness problems the server also enforces on approval. */
  readiness: string[];
}

/** Validates what approval will send (excluded products stripped). */
export function proposalIssues(proposal: Proposal): IssueList {
  const forApproval = forApprovalProposal(proposal);
  const parsed = merchantProposalSchema.safeParse(forApproval);
  if (!parsed.success) {
    return {
      schema: parsed.error.issues.slice(0, 30).map((i) => `${i.path.map(String).join(".") || "proposal"}: ${i.message}`),
      readiness: [],
    };
  }
  return { schema: [], readiness: proposalProblems(parsed.data) };
}

/** Excluded products are dropped at approval; nothing inactive is ever published. */
export function forApprovalProposal(proposal: Proposal): Proposal {
  return { ...proposal, products: proposal.products.filter((p) => p.active).map((p, i) => ({ ...p, sortOrder: i })) };
}

/** Every price the source listed (product base + each variant). */
export function sourcePriceSet(extraction: Extraction): Set<number> {
  const set = new Set<number>();
  for (const p of extraction.products) {
    set.add(p.priceCents);
    for (const v of p.variants) set.add(v.priceCents);
  }
  return set;
}

export interface PriceCheck {
  /** Base price as listed by the source for the same handle, when there is one. */
  sourceCents?: number;
  /** The proposed price appears nowhere in the source catalog. */
  notInSource: boolean;
}

export function priceCheck(product: ProposalProduct, extraction: Extraction, prices: Set<number>): PriceCheck {
  const source = extraction.products.find((p) => p.handle === product.slug);
  return {
    ...(source ? { sourceCents: source.priceCents } : {}),
    notInSource: !prices.has(product.priceCents),
  };
}

export interface ReviewChecklist {
  included: number;
  excluded: number;
  pricesNotInSource: string[];
  placementChosen: boolean;
  templateProblem: string | null;
  interiorProblem: string | null;
  platformRulesKept: boolean;
  noFulfillment: boolean;
}

export function reviewChecklist(
  proposal: Proposal,
  extraction: Extraction,
  parcel: Pick<Parcel, "tier"> | undefined,
): ReviewChecklist {
  const prices = sourcePriceSet(extraction);
  const active = proposal.products.filter((p) => p.active);
  const m = proposal.merchant;
  const f = m.fulfillment;
  return {
    included: active.length,
    excluded: proposal.products.length - active.length,
    pricesNotInSource: active.filter((p) => !prices.has(p.priceCents)).map((p) => p.title),
    placementChosen: Boolean(parcel),
    templateProblem: parcel ? placementProblem(m.storefrontTemplate, m.merchantType, parcel) : null,
    interiorProblem: INTERIOR_RULES[m.interiorTemplate].suitableFor.includes(m.merchantType)
      ? null
      : `Interior "${INTERIOR_RULES[m.interiorTemplate].label}" does not suit a ${m.merchantType}.`,
    platformRulesKept: PLATFORM_PROHIBITED_CLAIMS.every((r) => proposal.employee.prohibitedClaims.includes(r)),
    noFulfillment: !(f.delivery?.enabled || f.pickup?.enabled || f.shipping?.enabled || f.booking?.enabled),
  };
}

// ---------------------------------------------------------------------------------------------
// Fulfillment
// ---------------------------------------------------------------------------------------------

export type Channel = "delivery" | "pickup" | "shipping" | "booking";
export const CHANNELS: readonly Channel[] = ["delivery", "pickup", "shipping", "booking"];

const CHANNEL_DEFAULTS: { [K in Channel]-?: NonNullable<FulfillmentOptions[K]> } = {
  delivery: { enabled: true, feeCents: 399, minutesMin: 25, minutesMax: 45 },
  pickup: { enabled: true, minutesMin: 15, minutesMax: 30 },
  shipping: { enabled: true, feeCents: 699, daysMin: 3, daysMax: 7 },
  booking: { enabled: true, slotMinutes: 60 },
};

export function enabledChannels(f: FulfillmentOptions): FulfillmentType[] {
  return CHANNELS.filter((c) => f[c]?.enabled);
}

/**
 * Toggles a store channel and keeps every product's `fulfillmentTypes` in step with the store
 * (checkout refuses a product whose type the merchant does not offer).
 */
export function toggleChannel(proposal: Proposal, channel: Channel, on: boolean): Proposal {
  const current = proposal.merchant.fulfillment[channel];
  const fulfillment: FulfillmentOptions = {
    ...proposal.merchant.fulfillment,
    [channel]: current ? { ...current, enabled: on } : { ...CHANNEL_DEFAULTS[channel], enabled: on },
  };
  const types = enabledChannels(fulfillment);
  return {
    ...proposal,
    merchant: { ...proposal.merchant, fulfillment },
    products: types.length ? proposal.products.map((p) => ({ ...p, fulfillmentTypes: [...types] })) : proposal.products,
  };
}

/** Changing the merchant type keeps templates that still suit it and swaps the rest for defaults. */
export function changeMerchantType(proposal: Proposal, type: MerchantType): Proposal {
  const m = proposal.merchant;
  const defaults = defaultTemplates(type);
  return {
    ...proposal,
    merchant: {
      ...m,
      merchantType: type,
      storefrontTemplate: STOREFRONT_RULES[m.storefrontTemplate].suitableFor.includes(type) ? m.storefrontTemplate : defaults.storefront,
      interiorTemplate: INTERIOR_RULES[m.interiorTemplate].suitableFor.includes(type) ? m.interiorTemplate : defaults.interior,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------------------------

export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) return 0;
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** WCAG contrast ratio between two #rrggbb colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// ---------------------------------------------------------------------------------------------
// Map geometry
// ---------------------------------------------------------------------------------------------

/** World-space axis-aligned extents of a parcel (rotations are multiples of 90°). */
export function parcelRect(p: Pick<Parcel, "position" | "rotationY" | "size">): { minX: number; minZ: number; maxX: number; maxZ: number } {
  const quarter = Math.round(p.rotationY / (Math.PI / 2));
  const swapped = Math.abs(quarter) % 2 === 1;
  const w = swapped ? p.size.depth : p.size.width;
  const d = swapped ? p.size.width : p.size.depth;
  return { minX: p.position.x - w / 2, maxX: p.position.x + w / 2, minZ: p.position.z - d / 2, maxZ: p.position.z + d / 2 };
}

/** Unit vector the storefront faces (engine convention: forward = (sin yaw, cos yaw)). */
export function facing(rotationY: number): { x: number; z: number } {
  return { x: Math.round(Math.sin(rotationY)), z: Math.round(Math.cos(rotationY)) };
}
