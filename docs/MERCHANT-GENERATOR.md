# Merchant generator (admin)

Internal prototype: paste a store URL, get a draft merchant, have a person review and edit every
field, then publish it into the city. The store renders with the same templates and data path as
seeded merchants, so the engine needs no changes. The rules come from
[ADR-007](adr/007-generated-merchants-need-human-approval.md): **the AI proposes, a person
decides.**

- UI: `/admin/generate` (`/admin` redirects there)
- API: `/api/admin/*`
- Code: `src/lib/onboarding/*` (server), `src/lib/validation/merchantDraft.ts` (schemas),
  `src/features/admin/*` (UI)

It handles Shopify-style stores. It does not try to handle every site on the web well (see
[Known gaps](#known-gaps)).

## Flow

```
URL ──► extract ──► structure ──► draft (extracted) ──► review/edit (in_review) ──► approve ──► publish ──► /city?to=<slug>
        SSRF-guarded  AI or         stored, no effect    human, in the UI          human,       data layer
        fetches       heuristic     on the city                                      re-validated re-checks
```

1. **Extract** (`POST /api/admin/drafts/extract { url, hints? }`). `extractMerchant(url)` fetches
   `{origin}/products.json?limit=50` and `{origin}/collections.json` (the Shopify storefront JSON),
   then the homepage for `<title>`, meta description, `og:*`, icons, `theme-color` and CSS colour
   custom properties. Partial failures become warnings. The call fails only when the URL breaks
   the policy or nothing at all could be read.
2. **Structure.** With `ANTHROPIC_API_KEY` set, `structureMerchant()` asks Claude (`AI_MODEL`,
   default `claude-opus-5-5`) for a proposal through one strict tool, `propose_merchant`. The
   tool's input schema is compiled from the Zod `merchantProposalSchema`. Without a key, or when
   the AI call fails, `structureMerchantHeuristic()` maps the extraction directly and picks an
   employee template by merchant type. `extraction.meta.proposalSource` records which path ran
   (`"ai"` | `"heuristic"`), and the UI shows it.
3. **Draft.** Saved with status `extracted`. A draft has no effect on the city.
4. **Review** (`PATCH /api/admin/drafts/[id]`). The reviewer sees "What we found" (the raw
   extraction: source prices, logo candidates, colours, warnings) beside the editable proposal:
   - identity, category, type, price level and tags
   - brand colours, with swatches from the page and a contrast readout
   - logo and hero URLs, with previews
   - storefront and interior templates, with colour-block previews
   - storefront config (sign, façade, awning, floors, window display, lights)
   - fulfillment channels
   - products: include/exclude, title, price, "was" (compare-at) price, category, image and
     description, with a variant summary and that product's source price (and compare-at) on each
     row. A "Shown to customers" panel per row holds everything else a customer sees: featured,
     lead time, dietary tags, allergens, calories, spice level, material, sizes and colours. Its
     one-line summary is always visible.
   - the AI employee: name, role, greeting, personality, tone, rule lists and allowed context
   - placement: district, then a free parcel, on a mini map
   - reviewer notes

   Any edit moves the draft to `in_review`.
5. **Approve** (`PATCH { status: "approved" }`). Approval needs an explicit "I reviewed this
   merchant" checkbox. Two more confirmations appear when they apply: one when any product's price,
   "was" price or option prices differ from **that product's own** source entry, and one when a
   description, dietary tag, allergen or calorie count is not in the source. All of them reset on
   every edit. The server then re-validates everything (see below). Excluded products are dropped
   at approval. From `extracted` or `rejected`, the UI first saves the full proposal as
   `in_review` (excluded products kept) and only the approving request carries the stripped one,
   so a refused approval loses nothing.
6. **Publish** (`POST /api/admin/drafts/[id]/publish`). This calls `ds.publishMerchantDraft(id)`,
   which creates the merchant, its products and its employee, occupies the parcel, and marks the
   draft `published` (read-only). The UI then links to `/city?to=<slug>`.

Status machine (`canTransition`):
`extracted → in_review → approved | rejected`. `approved → in_review` happens on edit, and
`approved → approved` is a re-approval. `rejected → in_review` reopens a draft. `published` is
final. Approval is never possible directly from `extracted`.

## API

All routes run on the Node runtime, send `cache-control: no-store`, validate bodies with strict
Zod schemas (`lib/onboarding/http.ts`; bodies must be `application/json`, else 415), and pass
through `requireAdmin` first, which also refuses cross-site writes with 403 (see Security model). Wire shapes live in
`lib/onboarding/api.ts` (types only, client-safe).

| Route | Purpose |
| --- | --- |
| `POST /api/admin/session` | Exchange the token for the admin cookie (`DELETE` clears it) |
| `POST /api/admin/drafts/extract` | `{ url, hints? }` (+ `?allowLocal=1` in dev) → extract + structure → `extracted` draft (201). Policy violations 400, unreachable store 502, no valid proposal possible 502 with `problems[]` |
| `GET /api/admin/drafts` | All drafts, newest first |
| `GET/PATCH /api/admin/drafts/[id]` | Read; reviewer edits (`proposal`, `placement` or `null`, `reviewerNotes`, `status`). Bad transition 409, not ready to approve 422 with `problems[]` |
| `POST /api/admin/drafts/[id]/publish` | Publish an approved draft → `{ merchantId, slug, cityUrl }`. Otherwise 409 with the reason |
| `GET /api/admin/placements?draftId=&districtId=` | Free parcels (flagged for template fit), taken-lot outlines (geometry only), suggested district |

## Mandatory review: where it is enforced

| Layer | Check |
|---|---|
| Structuring (`finalizeProposal`, both AI and heuristic) | Each product is matched to its source product by handle (else title). Unmatched or duplicate products are dropped, as is any product whose price is not one of *its own* source prices. Option groups must reproduce every source variant price (see below) or are rebuilt from the source. A "was" price the source does not list, dietary tags, allergens and calories the source does not state are removed, AI-written product descriptions are replaced with the store's text, and `sponsored` is forced off. Every change is a warning on the draft. |
| UI (`ApprovePanel`, `ProductTable`) | Every customer-facing product field is shown and editable. Each row is compared with its own source product (`checkProductAgainstSource`, shared with the server). Approve stays disabled until the "I reviewed this merchant" box is ticked; price and claim differences each need their own confirmation. All boxes reset on any edit. Blockers are listed. |
| API (`applyDraftPatch`, `src/lib/onboarding/review.ts`) | Approval re-parses the whole stored proposal with `merchantProposalSchema` and requires: ≥ 1 product, no excluded products, both platform employee rules present, a placement on a free parcel that the storefront template fits (`placementProblem`, the same type and tier rules as `validatePlacement`), and a slug no live merchant uses. |
| Data layer (`draftPublishProblem`) | `publishMerchantDraft` refuses anything not `approved`, without a placement, on a missing, billboard or occupied parcel, or with no products. No UI or route can skip this check. |

## Security model

- **Cross-site requests (CSRF).** Admin is open in development and the cookie is only
  `SameSite=Lax`, so writes are also checked for where they come from:
  - Bodies must be `application/json` (415 otherwise). A `text/plain` or form POST is a CORS
    "simple request" any web page can send without a preflight.
  - Every non-GET admin request (including the bodyless publish and `DELETE /api/admin/session`)
    needs `Sec-Fetch-Site: same-origin` or `none`. Without that header, `Origin` must match `Host`
    (or `X-Forwarded-Host`). A request with neither header comes from a non-browser client (curl,
    scripts), which a CSRF attack cannot produce, and is allowed. `same-site` is refused too, so a
    sibling subdomain cannot write.
- **Access.** `requireAdmin(req)` guards every admin route:
  - `ADMIN_ACCESS_TOKEN` set (min 16 chars): requests need `authorization: Bearer <token>` or the
    `chifir_admin` cookie. `POST /api/admin/session { token }` sets the cookie: httpOnly,
    `SameSite=Lax`, `Secure` in production, 12 h. Comparison is constant-time over SHA-256
    digests, and the token is never logged.
  - No token, outside production: open, so the prototype works on localhost.
  - No token, in production: every admin route and page returns **404**.
  - The `/admin/generate` shell 404s unless `features.admin`. With a token set and no cookie, it
    shows only a token prompt. All data loads through the gated API.
- **SSRF** (`src/lib/onboarding/ssrf.ts`). Every hop, including each redirect, is checked:
  - `https:` only, default port only, no credentials in the URL.
  - Hostnames `localhost`, `*.local`, `*.internal`, `*.localdomain`, `*.home.arpa` and `*.onion`
    are blocked.
  - IP literals must be public unicast. Rejected IPv4 ranges: 0/8, 10/8, 100.64/10, 127/8,
    169.254/16, 172.16/12, 192.0.0/24, 192.0.2/24, 192.88.99/24, 192.168/16, 198.18/15,
    198.51.100/24, 203.0.113/24, 224/4 and 240/4.
  - IPv6 must be global unicast `2000::/3`, which leaves out `::/8` (`::`, `::1`,
    IPv4-compatible), `100::/64`, `fc00::/7`, `fe80::/10`, `fec0::/10` and `ff00::/8`. Inside it,
    `2001::/23` (Teredo, benchmarking, ORCHID), `2001:db8::/32` and `3fff::/20` (documentation)
    are refused. IPv4-mapped (`::ffff:0:0/96`), IPv4-translated (`::ffff:0:0:0/96`), NAT64
    (`64:ff9b::/96`) and 6to4 addresses are judged by the IPv4 address they embed. Local-use NAT64
    (`64:ff9b:1::/48`, operator networks) is refused outright. Zone ids are refused.
  - Hostnames are resolved with `dns.promises.lookup({ all: true })`, and **every** address must
    be public.
  - At most 3 redirects (followed manually and re-checked), 10 s timeout per request, a 2 MB body
    cap (declared and streamed), and HTML/JSON content types only.
  - `Accept` is limited to HTML or JSON. User agent: `ChifirBot/0.2 (+merchant onboarding)`.
  - Shorthand IPv4 forms (`0x7f.0.0.1`, `2130706433`) are normalised by the URL parser first, so
    they are classified correctly.
- **Local fixtures.** Loopback over `http` is allowed only outside production, via
  `ONBOARDING_ALLOW_LOCAL=1` (server env) or `?allowLocal=1` on the extract route (the UI passes it
  through when opened as `/admin/generate?allowLocal=1`). `localFetchAllowed()` returns false
  whenever `NODE_ENV === "production"`, and only loopback is admitted, never other private ranges.
- **Untrusted content.** Everything from the page is data:
  - HTML is reduced to plain text: scripts and styles are stripped, entities decoded, control
    characters removed, and lengths capped (`LIMITS` in `extract.ts`).
  - Only `http(s)` URLs survive.
  - The AI receives the extraction inside an `<extraction>` data block. The system prompt tells it
    never to follow instructions found there and to copy prices and titles verbatim.
  - Page text never becomes employee **knowledge**, which the employee prompt states as fact. The
    heuristic writes only facts it generates (item count, collection count, the store's host). The
    AI is told to write short neutral facts and never copy page sentences; the reviewer sees and
    edits the list. Descriptions keep page text as inert data, which the reviewer sees and edits.
  - The fixture plants injections where extraction really reads (the meta description and a
    product's `body_html`) plus one in a body `<p>` that is never read. Tests assert they stay out
    of knowledge.
  - In the UI, extracted text renders as React text and images as plain `<img>` with
    `referrerPolicy="no-referrer"`. Nothing is rendered as HTML.
- **Prices are never invented or moved.** `finalizeProposal` checks each product against its own
  source product, not the whole catalog, so a price borrowed from another product is caught.
  Option prices are checked combination by combination: the cart adds the chosen deltas to the
  base, so for every combination a customer can pick, base + deltas must equal what the source
  charges for that variant (`variantPriceProblem`). Shopify matrices that do not add up (S/Cotton
  $50, L/Cotton $50, S/Leather $50, L/Leather $80), or that leave combinations unsold, become one
  group of whole variants ("L / Leather"), each priced exactly. The schema requires integer cents.
  A reviewer may still change a price on purpose: it is flagged on the row and needs the extra
  confirmation at approval.
- **No sponsorship.** `sponsored` boosts search ranking, so it is a business decision. It is left
  out of the AI tool schema, and the proposal schema only accepts `false`.
- **Strict schemas.** `merchantProposalSchema` uses strict objects. Unknown fields (`rating`,
  `id`, `status`, `inventoryCount`, `systemPrompt`, …) are rejected, not dropped. Fulfillment is
  always `provider: "simulated"`. Templates are enums.

## Shopify field mapping

| Shopify (`/products.json`) | Extraction | Proposal (`Product`) |
|---|---|---|
| `title` | `title` (plain text, ≤ 120) | `title` (verbatim) |
| `handle` | `handle` (slugified) | `slug` (made unique) |
| `body_html` | `description` (HTML → text, ≤ 600) | `description` |
| `product_type` | `productType` | `category` (slug) and merchant tags |
| `tags` (array or comma string) | `tags` (lowercase, ≤ 20) | `tags` |
| `vendor` | `vendor` | — |
| `variants[].price` (`"68.00"`, `"1,249.00"`) | `variants[].priceCents` (exact; unparseable → variant skipped with a warning) | base `priceCents` = lowest variant price |
| `variants[].compare_at_price` | `compareAtPriceCents` (only when higher) | `compareAtPriceCents` of the base variant (kept only when it equals the source's compare-at at that price) |
| `variants[].available` | `available` | `inventoryStatus` (any available → `in_stock`) and per-option status |
| `options[] {name, values}` + `variants[].option1..3` | `options`, `variants[].options` (placeholder "Title / Default Title" dropped) | `variantGroups`: one per option (≥ 2 values), `priceDeltaCents` = cheapest variant with that value − base, **if** every combination then costs its source price; otherwise one group of whole variants with exact deltas. `attributes.sizes` / `colors` from options named Size / Colour (only values that fit the 20 / 30-character chip limits) |
| `images[].src` (`//cdn…` allowed) | `images` (absolute, ≤ 8) | `imageUrl` = first, `images` |

| Collections and homepage | Extraction | Proposal (`Merchant`) |
|---|---|---|
| `/collections.json` `title` | `categories[]` | category inference; employee knowledge gets only the collection *count* (titles are page text) |
| `og:site_name` → `og:title` → `<title>` (before " – ", " \| ") → hostname | `name` | `name`, `slug` |
| meta `description` / `og:description` | `description` | `description` |
| `apple-touch-icon`, `<img>` with "logo", `icon` links, `og:image` | `logoCandidates[]` (≤ 6) | `logoUrl` = first |
| `og:image` | `ogImage` | `heroImageUrl` (else first product image) |
| `theme-color`, `--color-*` / `--primary*` / `--brand*` / … custom properties (by frequency) | `colorCandidates[]` (≤ 8, `#rrggbb`) | `brand` (near-white skipped, `onPrimary` by luminance) |

The heuristic clamps every derived string to its schema limit. If the candidate still fails
validation (for example, an extraction stored before a cap existed), it leaves out the offending
optional part (an image, a "was" price, chips, tags, a knowledge line, an optional merchant field)
or the product, with a warning, rather than failing the extraction.

The heuristic infers the merchant type from food words in the name, description, collections and
products: restaurant if any match, else retail. It infers the category from keyword tables, e.g.
`food.ramen` or `fashion.apparel`. Templates come from `defaultTemplates(type)`:
- restaurant: bistro + restaurant-dining
- retail: boutique + retail-racks
- service: cafe + retail-gallery
- venue: flagship + retail-gallery
- pop-up: popup + popup-gallery

The reviewer can change any of these. Placement suggestions:
- `food.*` / `drink.*` → Food Street
- `fashion.*` / `beauty.*` → Fashion Street
- anything else → Central Plaza (the kiosk)
- otherwise the first district with a free lot

Only districts that still have a free parcel are suggested.

## AI structuring details

- Official SDK, `client.beta.messages.stream(...).finalMessage()`, `max_tokens` 16k,
  `output_config.effort: "medium"`, and server-side refusal fallbacks (`fallbacks: "default"`).
  The system prompt is cached.
- One tool, `propose_merchant`, with `strict: true`, `tool_choice: auto` and
  `disable_parallel_tool_use`. The current Opus generation rejects forced `tool_choice`, so the
  prompt instructs the model to call the tool instead.
- Tool input is null-stripped and parsed with Zod. On failure the errors go back as an `is_error`
  tool result and the call is retried **once**. After that it fails readably and the route falls
  back to the heuristic proposal, with a warning on the draft.
- `refusal` and `max_tokens` are terminal. Missing key → `NotConfiguredError`.

## Limits

| What | Limit |
|---|---|
| Products read from `/products.json` | 50 (`?limit=50`, one page) |
| Products in a proposal | 40 |
| Variants per product read | 30; option groups 3; values per option 30 |
| Images | 8 per product, 8 merchant images, 6 logo candidates, 8 colours |
| Text | name 80, description 600, product title 120, tag 32, option name 60, size chip 20, colour chip 30, knowledge line 200 |
| Prices | up to $1,000,000.00 per product (higher ones are left out with a warning) |
| Fetch | 3 redirects, 10 s per request, 2 MB per body |
| Employee | greeting 280, ≤ 20 knowledge facts, ≤ 12 prohibited claims |

## Running it locally

```bash
# 1. The app (any port; the shared sandbox server is on 3100)
pnpm dev

# 2. A fake Shopify store on 127.0.0.1:4317 (the unit-test fixture, images served locally)
pnpm exec tsx src/lib/onboarding/fixture-server.ts 4317

# 3. Open the generator with loopback fixtures allowed (dev only)
open "http://localhost:3000/admin/generate?allowLocal=1"
#    → paste http://127.0.0.1:4317/ → Extract → review → pick Fashion Street / fa-n3
#    → tick "I reviewed this merchant" → Approve → Publish → follow the /city?to=northwind-goods link
```

The fixture's meta description and the Dockside Cap's description carry a planted prompt
injection. Edit them out of the descriptions during review, and check that the employee's
knowledge does not contain them.

Without `ANTHROPIC_API_KEY` the heuristic proposal is used. The badge in the header says so. With a
key, the same flow runs through Claude.

To try the token gate, set `ADMIN_ACCESS_TOKEN` (16+ characters) and reload the page. API clients
can send `authorization: Bearer <token>` instead of the cookie.

In static mode (no Supabase), drafts and published merchants live in the dev server's memory and
are gone after a restart. With Supabase, `merchant_drafts` and the catalog rows are written with
the service role.

Tests (no network): `pnpm exec vitest run src/lib/onboarding src/lib/validation/merchantDraft.test.ts src/features/admin`.

## Known gaps

This is a prototype for Shopify-style stores. It does not try to handle every site on the web
well.

- **Generic sites** yield identity only (name, description, logo, colours). There is no product
  scraping from HTML or JSON-LD, and no way to add products by hand yet, so they cannot be
  approved.
- **One catalog page.** Only the first 50 products are read (no pagination). Prices are assumed to
  be USD (the store currency is not read). Inventory counts are never shown (no fake scarcity).
- **DNS rebinding / TOCTOU.** The hostname is resolved for the check and again by `fetch`. Pinning
  the socket to the checked address needs a custom dispatcher. This is acceptable for an
  admin-only tool and is noted in `ssrf.ts`.
- **Images are hot-linked** from the store's CDN, not copied. `http:` image URLs are accepted (for
  local fixtures), so on an `https` deployment they fail as mixed content and the UI and textures
  fall back to monograms.
- **No audit identity.** Drafts record source, extraction, edits and notes, but not *who* approved
  them. The admin token is shared, and `created_by` stays empty until admins sign in with real
  accounts.
- **Static mode is in-memory.** Published merchants vanish on restart.
- **Supabase publish is not one transaction.** It inserts the merchant, then the employee and the
  products, then claims the parcel with a conditional update. If the parcel is taken in between,
  the inserted rows are left behind. A Postgres function (RPC) wrapping all four writes would fix
  this.
- **Opening hours, address and geo** are not extracted. The schema accepts them, but the editor
  does not expose them yet.
- **Knowledge is still "stated as fact" in the employee prompt** (`src/lib/ai/prompts.ts`, owned
  by the AI workstream). The generator keeps page text out of it, but the prompt should also fence
  merchant-configured knowledge as data. For AI proposals, keeping injected text out of knowledge
  relies on the model and the reviewer.
- **Merchant name, tagline and description** from the AI are shown and editable but not compared
  with the source automatically.
