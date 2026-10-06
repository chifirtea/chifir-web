# ADR-007: Generated merchants are drafts until a human approves them

**Status:** accepted (v0.2)

## Context
The merchant generator turns a URL into a store: extraction (Shopify `/products.json`, homepage
metadata), AI structuring into the merchant schema, then a storefront. Extraction is lossy and
the AI can misread a page; a wrong price or claim in the city is a real-world problem.

## Decision
- A `merchant_drafts` row holds the extraction, the AI proposal (validated against the merchant
  schema with Zod before it is stored) and the reviewer's edits. It has no effect on the city.
- `publishMerchantDraft` is the only path from a draft to catalog rows, and it refuses unless the
  draft is `approved` with a placement on a free parcel (`draftPublishProblem`). The check is in
  the data layer, so no UI shortcut can skip it.
- Admin routes are gated by `ADMIN_ACCESS_TOKEN` in production (open on localhost), fetch only
  `https` public hosts (SSRF guard), cap sizes and time, and never run merchant page content as
  instructions.

## Consequences
- The AI proposes, a person decides. Published merchants render with the same templates and data
  path as seeded ones, so the generator adds no engine code.
- Drafts are auditable: source URL, what was extracted, what was changed, who published.
