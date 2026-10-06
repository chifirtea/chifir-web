import { describe, expect, it } from "vitest";
import { districts, buildParcels } from "@/data/seed/districts";
import type { MerchantDraft } from "@/types/domain";
import { parseShopifyProducts } from "./extract";
import { applyDraftPatch } from "./review";
import { FIXTURE_ORIGIN, PRODUCTS_JSON } from "./shopify.fixture";
import { structureMerchantHeuristic } from "./structure";

const parcels = buildParcels(new Date("2026-10-06T12:00:00Z"));
const fashion = districts.find((d) => d.slug === "fashion-street")!.id;
const food = districts.find((d) => d.slug === "food-street")!.id;
const lot = (slug: string) => parcels.find((p) => p.slug === slug)!;

const proposal = structureMerchantHeuristic({
  sourceUrl: `${FIXTURE_ORIGIN}/`,
  origin: FIXTURE_ORIGIN,
  platform: "shopify",
  name: "Northwind Goods",
  logoCandidates: [],
  colorCandidates: [],
  products: parseShopifyProducts(PRODUCTS_JSON, FIXTURE_ORIGIN).products,
  categories: [],
  fetchedAt: "2026-10-06T12:00:00.000Z",
  warnings: [],
  meta: {},
}).proposal;

const draft = (over: Partial<MerchantDraft> = {}): MerchantDraft => ({
  id: "draft_1",
  sourceUrl: `${FIXTURE_ORIGIN}/`,
  status: "in_review",
  extraction: {},
  proposal: structuredClone(proposal),
  createdAt: "2026-10-06T12:00:00.000Z",
  updatedAt: "2026-10-06T12:00:00.000Z",
  ...over,
});
const placed = { districtId: fashion, parcelId: lot("fa-n3").id };
const ctx = { parcels };

describe("applyDraftPatch", () => {
  it("moves an extracted draft into review on its first edit", () => {
    const out = applyDraftPatch(draft({ status: "extracted" }), { reviewerNotes: "checked prices", placement: placed }, ctx);
    expect(out.ok && out.next.status).toBe("in_review");
    expect(out.ok && out.next.placement).toEqual(placed);
    expect(out.ok && out.next.reviewerNotes).toBe("checked prices");
  });

  it("refuses to approve straight from extracted", () => {
    const out = applyDraftPatch(draft({ status: "extracted", placement: placed }), { status: "approved" }, ctx);
    expect(out).toMatchObject({ ok: false, status: 409 });
  });

  it("approves a complete draft with a fitting free placement", () => {
    const out = applyDraftPatch(draft({ placement: placed }), { status: "approved" }, ctx);
    expect(out.ok && out.next.status).toBe("approved");
  });

  it("requires a placement, a product and a fitting template to approve", () => {
    const noPlacement = applyDraftPatch(draft(), { status: "approved" }, ctx);
    expect(noPlacement).toMatchObject({ ok: false, status: 422 });
    expect(!noPlacement.ok && noPlacement.problems).toContain("Choose a district and a parcel.");

    const empty = applyDraftPatch(draft({ placement: placed }), { status: "approved", proposal: { ...proposal, products: [] } }, ctx);
    expect(!empty.ok && empty.problems).toContain("Add at least one product.");

    const kiosk = { districtId: fashion, parcelId: lot("fa-s3").id };
    const misfit = applyDraftPatch(draft({ placement: kiosk }), { status: "approved" }, ctx);
    expect(!misfit.ok && misfit.problems?.join(" ")).toMatch(/does not fit parcel tier "kiosk"/);
  });

  it("re-validates the stored proposal on approval", () => {
    const broken = draft({ placement: placed });
    (broken.proposal.merchant as { slug: string }).slug = "Not A Slug";
    const out = applyDraftPatch(broken, { status: "approved" }, ctx);
    expect(out).toMatchObject({ ok: false, status: 422, error: "The proposal is not valid." });
    expect(!out.ok && out.problems?.[0]).toMatch(/^merchant\.slug/);
  });

  it("refuses a slug a live merchant already uses", () => {
    const out = applyDraftPatch(draft({ placement: placed }), { status: "approved" }, { parcels, merchantSlugs: new Set(["northwind-goods"]) });
    expect(!out.ok && out.problems?.join(" ")).toMatch(/already used/);
  });

  it("checks placements: existence, district and freedom", () => {
    expect(applyDraftPatch(draft(), { placement: { districtId: fashion, parcelId: "nope" } }, ctx)).toMatchObject({ ok: false, status: 400 });
    expect(applyDraftPatch(draft(), { placement: { districtId: food, parcelId: lot("fa-n3").id } }, ctx)).toMatchObject({ ok: false, status: 400 });
    expect(applyDraftPatch(draft(), { placement: { districtId: fashion, parcelId: lot("fa-n1").id } }, ctx)).toMatchObject({ ok: false, status: 409 });
    const cleared = applyDraftPatch(draft({ placement: placed }), { placement: null }, ctx);
    expect(cleared.ok && cleared.next.placement).toBeUndefined();
  });

  it("reopens an approved draft when it is edited, unless re-approved in the same request", () => {
    const approved = draft({ status: "approved", placement: placed });
    const edited = { ...proposal, merchant: { ...proposal.merchant, tagline: "Coastal streetwear" } };
    const reopened = applyDraftPatch(approved, { proposal: edited }, ctx);
    expect(reopened.ok && reopened.next.status).toBe("in_review");
    const reapproved = applyDraftPatch(approved, { proposal: edited, status: "approved" }, ctx);
    expect(reapproved.ok && reapproved.next.status).toBe("approved");
    const notesOnly = applyDraftPatch(approved, { reviewerNotes: "ok" }, ctx);
    expect(notesOnly.ok && notesOnly.next.status).toBe("approved");
  });

  it("rejects, reopens rejected drafts, and never edits a published one", () => {
    expect(applyDraftPatch(draft(), { status: "rejected" }, ctx)).toMatchObject({ ok: true });
    expect(applyDraftPatch(draft({ status: "rejected" }), { status: "approved" }, ctx)).toMatchObject({ ok: false, status: 409 });
    expect(applyDraftPatch(draft({ status: "published" }), { reviewerNotes: "late" }, ctx)).toMatchObject({ ok: false, status: 409 });
  });

  it("normalises edited proposals (platform rules, slugs)", () => {
    const edited = structuredClone(proposal);
    edited.employee.prohibitedClaims = ["Be kind."];
    edited.products[1]!.slug = edited.products[0]!.slug;
    const out = applyDraftPatch(draft(), { proposal: edited }, ctx);
    expect(out.ok && out.next.proposal.employee.prohibitedClaims.length).toBe(3);
    expect(out.ok && new Set(out.next.proposal.products.map((p) => p.slug)).size).toBe(3);
  });
});
