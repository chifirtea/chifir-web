# Merchant generator (admin)

Internal tool that turns a store URL into a reviewed, placed, published merchant in the city.
Decision record: `docs/adr/007-generated-merchants-need-human-approval.md`. Nothing generated
reaches the city without a human approving it; the data layer enforces that, not the UI.

## Flow

1. **Paste a URL** at `/admin/generate`. Shopify stores are the target: the server reads the
   public `/products.json` (and `/collections.json`) and the homepage for name, description, logo
   and colour candidates. Other sites yield an identity-only extraction the reviewer completes
   by hand. Everything fetched is untrusted web content: reduced to plain text, capped, never
   interpreted (`lib/onboarding/extract.ts`).
2. **Structure.** With `ANTHROPIC_API_KEY`, Claude proposes the merchant through one strict tool
   whose input schema is compiled from the merchant proposal schema; the result is re-validated
   with Zod, retried once with the errors, and falls back to a heuristic mapping when the call
   fails. Without a key the heuristic runs alone (`lib/onboarding/structure.ts`). Prices are the
   one thing neither path may invent: a product whose price was not seen in the extraction is
   dropped with a warning.
3. **Review** (`DraftReview`). The reviewer edits identity, category, brand palette, products,
   the AI employee's persona and greeting, picks the storefront and interior templates from the
   registries, and chooses a district and a free parcel on the placement map. Every edit moves an
   `extracted` draft into `in_review`; approving re-validates the whole proposal and the
   placement; editing an approved draft reopens it; a reviewer can also mark a draft `rejected`
   (`lib/onboarding/review.ts`, pure and unit-tested).
4. **Approve, then publish.** `POST /api/admin/drafts/[id]/publish` calls the data source's
   `publishMerchantDraft`, which refuses anything that `draftPublishProblem` flags: not approved,
   no placement, parcel missing, wrong district, billboard, occupied, no products. The merchant,
   its products, employee config and parcel tenancy are written in one step (static mode in
   memory, Supabase in a transaction) and the response carries a deep link to the new storefront.

## Access

- `features.admin` is on for local development and, in production, only when
  `ADMIN_ACCESS_TOKEN` (16+ characters) is set. Otherwise `/admin/generate` and `/api/admin/*`
  return 404.
- With a token configured, every API call needs `authorization: Bearer <token>` or the
  `chifir_admin` cookie that `POST /api/admin/session { token }` sets. Tokens are compared in
  constant time and never logged (`lib/onboarding/auth.ts`).
- The admin page is a server shell that renders no draft content; data loads through the gated
  API from the browser.

## Outbound fetch policy (SSRF)

A reviewer pastes a URL and the server fetches it, so every hop follows the same rules
(`lib/onboarding/ssrf.ts`): https only, no credentials in the URL, hostname must resolve to a
public unicast address (v4 and v6 literal checks included), at most 3 redirects each re-checked,
10 s, 2 MB, HTML or JSON only. `?allowLocal=1` admits loopback over http outside production so
the flow can run against the bundled fixture store (`lib/onboarding/fixture-server.ts`).
Known gap: the address is resolved here and again by `fetch`; pinning the socket is a follow-up
for when the tool leaves "admin-only prototype".

## API

| Route                                 | Purpose                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `POST /api/admin/session`             | Exchange the token for the admin cookie (`DELETE` clears it)                    |
| `POST /api/admin/drafts/extract`      | `{ url, hints? }` → extract + structure → `extracted` draft                     |
| `GET /api/admin/drafts`               | All drafts, newest first                                                        |
| `GET/PATCH /api/admin/drafts/[id]`    | Read; reviewer edits (`proposal`, `placement`, `reviewerNotes`, `status`)       |
| `POST /api/admin/drafts/[id]/publish` | Publish an approved draft; 409 with the reason otherwise                        |
| `GET /api/admin/placements`           | Free parcels (flagged for template fit), taken-lot outlines, suggested district |

Wire shapes live in `lib/onboarding/api.ts` (types only, client-safe); request bodies are
validated with Zod in `lib/onboarding/http.ts`.

## Try it locally

```bash
pnpm dev
# in another terminal: a Shopify-shaped fixture store on loopback (default port 4317)
pnpm exec tsx src/lib/onboarding/fixture-server.ts
# then open http://localhost:3000/admin/generate?allowLocal=1 and extract http://127.0.0.1:4317/
```

Static mode keeps drafts in memory (they vanish on restart); Supabase mode stores them in
`merchant_drafts` (migration `0002_city_alive.sql`).
