# Media — replacing the demo imagery with a merchant's own

Every picture in the city is a plain URL in the data. Nothing in the engine or the UI knows where
an image is hosted; `src/lib/media` resolves URLs in one place (`resolveImage`), so moving to a
CDN or an image optimizer later is configuration, not code.

## Where images live in the data

| Field | Used for | Recommended |
|---|---|---|
| `merchant.logoUrl` | Signage (canvas texture), merchant sheet, cards | Square PNG/SVG with transparency, ≥ 512 px; dark-on-light or light-on-dark that reads on `brand.primary` |
| `merchant.heroImageUrl` | Interior back wall, merchant sheet, event fallbacks | 16:9, ≥ 1600 × 900 |
| `merchant.images[]` | Window displays, gallery | 4:3 or 1:1, ≥ 1024 px |
| `product.imageUrl` | Product sign, plinth cards, concierge cards, order snapshots | 4:3, ≥ 1200 × 900, product centred on a plain background |
| `product.images[]` | Further views in the product sign | same as above |
| `event.heroImageUrl` | Venue LED screen, event sheet, billboards | 16:9, ≥ 1920 × 1080, legible when darkened |
| `event.heroVideoUrl` | Looping clip on the venue screens while live | MP4 (H.264) ≤ 10 MB, muted, 16:9 |
| `event.livestreamUrl` | Stream surface placeholder (host badge; player integration later) | HLS/embed URL |
| `reward.previewImageUrl` | Entitlement cards | 1:1, ≥ 512 px |

The demo seed points at `https://loremflickr.com/...` keyword placeholders. Replacing them is a
data change: edit `src/data/seed/*.ts` (static mode) or update the `merchants`, `products`,
`events` and `digital_rewards` rows (Supabase) and reload. No component, template or texture code
changes. The merchant generator (`/admin/generate`) fills these fields from a store's own imagery.

## Resolution rules (`src/lib/media/images.ts`)

- Absolute URLs (`https://…`, `data:`, `blob:`, protocol-relative) pass through untouched.
- Relative paths (`merchants/kori/hero.jpg`) are prefixed with `NEXT_PUBLIC_IMAGE_CDN_BASE` when
  set, else served from `/public`.
- `NEXT_PUBLIC_IMAGE_OPTIMIZER_TEMPLATE` (e.g. `https://img.example.com/fetch?url={url}&w={width}&h={height}&q={quality}`)
  turns on `srcset` generation (`imageSrcSet`) and per-request sizing for textures; without it
  the original URL is used at its native size.
- `textureImageWidth(maxTextureSize)` picks the texture size by quality tier (512 / 1024 / 2048).

## Textures need CORS

Any image drawn into a 3D texture (signage logos, window displays, plinth cards, the venue screen,
the interior hero wall) is loaded with `crossOrigin = "anonymous"`. The host must send
`Access-Control-Allow-Origin: *` (or your origin); Shopify CDNs, Supabase Storage (public bucket),
Cloudinary, imgix and S3 with a CORS rule all do. Without the header the browser taints the
canvas and the texture is skipped: the template falls back to the brand-coloured monogram or a
flat panel, never a broken texture. `<img>` elements in the HUD/panels do not need CORS.

## Fallbacks

- `ProductImage` renders a brand-tinted monogram card when a URL is missing or fails to load.
- Signage falls back to the merchant name set in the brand palette; the venue screen falls back
  to a procedural brand visual; the interior hero wall to the brand colour.
- A failing optimizer template degrades to the raw URL.

## Checklist for a real merchant

1. Logo (transparent), hero (16:9), 1–3 storefront images, one 4:3 image per product.
2. Host them on a CORS-enabled origin (Supabase Storage public bucket is the default choice).
3. Put the URLs in the data; keep file sizes modest (≤ 300 KB per product image).
4. Open the store in the city: window displays, plinth cards and the back wall should show the
   real imagery within a second on Wi-Fi. If a texture is missing, check the CORS header first.
