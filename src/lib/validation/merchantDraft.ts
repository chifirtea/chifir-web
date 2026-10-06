import { z } from "zod";
import type {
  InteriorTemplateId,
  MerchantDraftStatus,
  MerchantProposal,
  MerchantType,
  StorefrontTemplateId,
} from "@/types/domain";
import { dietaryTagSchema } from "./ai";
import { addressSchema, fulfillmentTypeSchema } from "./checkout";

/**
 * Merchant generator schemas (ADR-007). `merchantProposalSchema` is both the input schema of the
 * AI's `propose_merchant` tool (compiled to strict JSON schema) and the gate every reviewer edit
 * passes before it is stored, so the AI and the human are held to the same contract. Objects are
 * strict: a field the schema does not know is rejected, never silently kept.
 *
 * Client-safe: pure Zod, no server imports (the admin UI reuses the enums and limits).
 */

export const MAX_PROPOSAL_PRODUCTS = 40;
export const MAX_VARIANT_OPTIONS = 30;

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Dot-namespaced category slug: "food.ramen", "fashion.streetwear", "gifts.flowers". */
export const CATEGORY = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;

/** Compile-time check that an enum tuple lists every member of a domain union. */
type Covers<Tuple extends readonly string[], Union extends string> =
  Exclude<Union, Tuple[number]> extends never ? true : ["missing", Exclude<Union, Tuple[number]>];

const MERCHANT_TYPES = ["restaurant", "retail", "service", "venue", "popup"] as const;
const STOREFRONT_TEMPLATES = [
  "bistro",
  "fast-casual",
  "cafe",
  "boutique",
  "flagship",
  "kiosk",
  "popup",
] as const;
const INTERIOR_TEMPLATES = [
  "restaurant-counter",
  "restaurant-dining",
  "retail-racks",
  "retail-gallery",
  "popup-gallery",
] as const;
const DRAFT_STATUSES = ["extracted", "in_review", "approved", "published", "rejected"] as const;

export const merchantTypeSchema = z.enum(MERCHANT_TYPES);
export const storefrontTemplateSchema = z.enum(STOREFRONT_TEMPLATES);
export const interiorTemplateSchema = z.enum(INTERIOR_TEMPLATES);
export const draftStatusSchema = z.enum(DRAFT_STATUSES);
export const inventoryStatusSchema = z.enum(["in_stock", "low_stock", "out_of_stock", "preorder"]);
export const employeeContextSchema = z.enum(["cart", "dietary", "budget", "location", "occasion"]);

// These evaluate to `true` only when the tuples above cover their domain unions.
export type EnumCoverage = [
  Covers<typeof MERCHANT_TYPES, MerchantType>,
  Covers<typeof STOREFRONT_TEMPLATES, StorefrontTemplateId>,
  Covers<typeof INTERIOR_TEMPLATES, InteriorTemplateId>,
  Covers<typeof DRAFT_STATUSES, MerchantDraftStatus>,
];
const enumCoverage: EnumCoverage = [true, true, true, true];
void enumCoverage;

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();
const idSchema = z.string().min(1).max(64);
const cents = z.number().int().min(0).max(100_000_000);
const minutes = z.number().int().min(0).max(24 * 60 * 14);
const days = z.number().int().min(0).max(365);

export const hexColorSchema = z.string().regex(HEX_COLOR, "Expected a #rrggbb colour");
export const slugSchema = z.string().regex(SLUG, "Lowercase letters, digits and dashes").max(64);
export const categorySchema = z
  .string()
  .regex(CATEGORY, "Dot-namespaced, e.g. food.ramen or fashion.streetwear")
  .max(64);
/** External media and site links: http(s) only. Images stay untrusted (rendered with fallbacks). */
export const externalUrlSchema = z.url({ protocol: /^https?$/ }).max(2048);
const tagSchema = z.string().trim().min(1).max(32);

export const brandPaletteSchema = z.strictObject({
  primary: hexColorSchema,
  secondary: hexColorSchema,
  accent: hexColorSchema,
  onPrimary: hexColorSchema,
});

export const storefrontConfigSchema = z.strictObject({
  signText: optionalText(40),
  signStyle: z.enum(["neon", "backlit", "painted", "marquee"]),
  facade: z.enum(["brick", "plaster", "glass", "concrete", "wood", "tile"]),
  awning: z.boolean(),
  floors: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  windowDisplay: z.enum(["products", "menu", "none"]),
  accentLights: z.boolean(),
});

export const fulfillmentOptionsSchema = z.strictObject({
  /** Generated merchants always start on the simulated provider; a real one is wired by hand. */
  provider: z.literal("simulated"),
  delivery: z
    .strictObject({
      enabled: z.boolean(),
      feeCents: cents,
      minutesMin: minutes,
      minutesMax: minutes,
      radiusKm: z.number().positive().max(500).optional(),
    })
    .optional(),
  pickup: z.strictObject({ enabled: z.boolean(), minutesMin: minutes, minutesMax: minutes }).optional(),
  shipping: z
    .strictObject({ enabled: z.boolean(), feeCents: cents, daysMin: days, daysMax: days })
    .optional(),
  booking: z.strictObject({ enabled: z.boolean(), slotMinutes: z.number().int().min(5).max(600) }).optional(),
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");
const intervalsSchema = z.array(z.strictObject({ open: hhmm, close: hhmm })).max(4).optional();
export const openingHoursSchema = z.strictObject({
  timezone: z.string().min(1).max(64),
  weekly: z.strictObject({
    mon: intervalsSchema,
    tue: intervalsSchema,
    wed: intervalsSchema,
    thu: intervalsSchema,
    fri: intervalsSchema,
    sat: intervalsSchema,
    sun: intervalsSchema,
  }),
});

export const merchantFieldsSchema = z.strictObject({
  slug: slugSchema,
  name: text(80),
  tagline: optionalText(120),
  description: text(600),
  category: categorySchema,
  merchantType: merchantTypeSchema,
  tags: z.array(tagSchema).max(12),
  priceLevel: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  logoUrl: externalUrlSchema.optional(),
  heroImageUrl: externalUrlSchema.optional(),
  images: z.array(externalUrlSchema).max(8),
  brand: brandPaletteSchema,
  websiteUrl: externalUrlSchema.optional(),
  address: addressSchema.optional(),
  geo: z.strictObject({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
  openingHours: openingHoursSchema.optional(),
  storefrontTemplate: storefrontTemplateSchema,
  interiorTemplate: interiorTemplateSchema,
  storefrontConfig: storefrontConfigSchema,
  fulfillment: fulfillmentOptionsSchema,
  sponsored: z.boolean().default(false),
});

export const variantOptionSchema = z.strictObject({
  id: idSchema,
  name: text(60),
  priceDeltaCents: z.number().int().min(-100_000_000).max(100_000_000),
  inventoryStatus: inventoryStatusSchema.optional(),
});

export const variantGroupSchema = z.strictObject({
  id: idSchema,
  name: text(60),
  required: z.boolean(),
  options: z.array(variantOptionSchema).min(1).max(MAX_VARIANT_OPTIONS),
});

export const productAttributesSchema = z.strictObject({
  spiceLevel: z
    .union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
    .optional(),
  dietary: z.array(dietaryTagSchema).max(7).optional(),
  allergens: z.array(text(40)).max(12).optional(),
  calories: z.number().int().min(0).max(10_000).optional(),
  sizes: z.array(text(20)).max(20).optional(),
  colors: z.array(text(30)).max(20).optional(),
  material: optionalText(80),
  occasion: z.array(text(30)).max(8).optional(),
  gender: z.enum(["men", "women", "unisex"]).optional(),
  serves: z.number().int().min(1).max(50).optional(),
});

export const leadTimeSchema = z.strictObject({
  minutesMin: minutes.optional(),
  minutesMax: minutes.optional(),
  daysMin: days.optional(),
  daysMax: days.optional(),
});

export const productProposalSchema = z.strictObject({
  slug: slugSchema,
  title: text(120),
  description: z.string().trim().max(600),
  category: slugSchema,
  /** Integer cents, copied from the source catalog. Never invented: `finalizeProposal` drops the rest. */
  priceCents: cents,
  currency: z.enum(["USD", "EUR", "GBP"]).default("USD"),
  compareAtPriceCents: cents.optional(),
  imageUrl: externalUrlSchema.optional(),
  images: z.array(externalUrlSchema).max(8),
  inventoryStatus: inventoryStatusSchema,
  variantGroups: z.array(variantGroupSchema).max(3),
  attributes: productAttributesSchema,
  tags: z.array(tagSchema).max(20),
  fulfillmentTypes: z.array(fulfillmentTypeSchema).min(1).max(7),
  leadTime: leadTimeSchema,
  featured: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  active: z.boolean().default(true),
});

export const employeeProposalSchema = z.strictObject({
  name: text(40),
  role: text(40),
  avatarUrl: externalUrlSchema.optional(),
  personality: text(400),
  tone: text(120),
  greeting: text(280),
  knowledge: z.array(text(200)).max(20),
  upsellRules: z.array(text(200)).max(10),
  prohibitedClaims: z.array(text(200)).min(1).max(12),
  brandLanguage: z.array(text(200)).max(10),
  escalation: z.strictObject({ enabled: z.boolean(), contact: optionalText(120) }),
  allowedContext: z.array(employeeContextSchema).max(5),
});

export const merchantProposalSchema = z.strictObject({
  merchant: merchantFieldsSchema,
  products: z.array(productProposalSchema).max(MAX_PROPOSAL_PRODUCTS),
  employee: employeeProposalSchema,
});

export type ValidatedProposal = z.output<typeof merchantProposalSchema>;
export type ProposalInput = z.input<typeof merchantProposalSchema>;
/** Compile-time proof that a validated proposal is a `MerchantProposal` (what the data layer stores). */
export type ProposalShapeCheck = ValidatedProposal extends MerchantProposal ? true : never;
const proposalShapeCheck: ProposalShapeCheck = true;
void proposalShapeCheck;

/**
 * Platform rules that every generated employee carries, whatever the merchant page said
 * (ARCHITECTURE §9: fixed platform rules always win over merchant configuration).
 */
export const PLATFORM_PROHIBITED_CLAIMS: readonly string[] = [
  "Do not make medical, health or therapeutic claims about any product.",
  "Do not state, estimate or promise a price that is not in the catalog.",
];

function uniqueSlug(base: string, taken: Set<string>): string {
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  taken.add(slug);
  return slug;
}

const normaliseTags = (tags: string[], max: number): string[] =>
  [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, max);

/**
 * Deterministic clean-up applied after validation, on every path (AI, heuristic, reviewer edits):
 * lowercase unique tags, unique product slugs, dense sort order, platform prohibitions present.
 */
export function normalizeProposal(p: ValidatedProposal): ValidatedProposal {
  const taken = new Set<string>();
  const products = p.products.map((product, i) => ({
    ...product,
    slug: uniqueSlug(product.slug, taken),
    tags: normaliseTags(product.tags, 20),
    sortOrder: i,
  }));
  const prohibited = [...p.employee.prohibitedClaims];
  for (const rule of PLATFORM_PROHIBITED_CLAIMS) if (!prohibited.includes(rule)) prohibited.unshift(rule);
  return {
    merchant: { ...p.merchant, tags: normaliseTags(p.merchant.tags, 12) },
    products,
    employee: { ...p.employee, prohibitedClaims: prohibited.slice(0, 12) },
  };
}

/** Reasons a proposal is not ready to be approved (beyond schema validity). */
export function proposalProblems(p: ValidatedProposal): string[] {
  const problems: string[] = [];
  if (p.products.length === 0) problems.push("Add at least one product.");
  if (p.products.some((x) => !x.active)) problems.push("Remove products you excluded, or re-include them.");
  for (const rule of PLATFORM_PROHIBITED_CLAIMS) {
    if (!p.employee.prohibitedClaims.includes(rule)) problems.push(`Employee rules must keep: "${rule}"`);
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Admin API request bodies
// ---------------------------------------------------------------------------------------------

export const placementSchema = z.strictObject({ districtId: idSchema, parcelId: idSchema });

export const extractRequestSchema = z.strictObject({
  url: z.string().trim().min(1).max(2048),
  hints: z
    .strictObject({
      merchantType: merchantTypeSchema.optional(),
      category: categorySchema.optional(),
    })
    .optional(),
});

/**
 * A reviewer edit. `proposal` is the whole edited proposal (the editor holds all of it), so there
 * is exactly one validation path for stored proposals. `placement: null` clears the placement.
 */
export const draftPatchSchema = z
  .strictObject({
    proposal: merchantProposalSchema.optional(),
    placement: placementSchema.nullable().optional(),
    reviewerNotes: z.string().trim().max(2000).optional(),
    status: z.enum(["in_review", "approved", "rejected"]).optional(),
  })
  .refine((patch) => Object.values(patch).some((v) => v !== undefined), {
    message: "Nothing to change.",
  });

export type DraftPatch = z.output<typeof draftPatchSchema>;

export const adminSessionSchema = z.strictObject({ token: z.string().min(16).max(256) });

const TRANSITIONS: Record<MerchantDraftStatus, readonly MerchantDraftStatus[]> = {
  extracted: ["in_review", "rejected"],
  in_review: ["in_review", "approved", "rejected"],
  approved: ["in_review", "approved", "rejected"],
  rejected: ["in_review"],
  published: [],
};

/**
 * extracted → in_review → approved | rejected; approved/rejected can be reopened; published is
 * final. approved → approved is a re-approval of an edited draft (re-validated like the first).
 */
export function canTransition(from: MerchantDraftStatus, to: MerchantDraftStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
