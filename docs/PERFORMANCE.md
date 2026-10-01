# Performance — budget, measurement, protocol

**Sandbox numbers are not measurements.** The development container renders with SwiftShader
(software WebGL); its frame rate says nothing about a phone. Every conclusion about performance
comes from a real device running the HUD below, or from `perf_sample` analytics across the fleet.

## Mobile budget (target: iPhone 12-class, Pixel 6a-class, 4G)

| Metric | Budget | Where it is measured |
|---|---|---|
| Sustained frame rate on the street and indoors | ≥ 30 fps (10 s average) | HUD `fps` (10 s), `perf_sample.fps` |
| Frame time p95 | ≤ 33 ms (≤ 50 ms acceptable on the `low` tier) | HUD `p95`, `perf_sample.frameP95Ms` |
| Long frames (> 50 ms) per 10 s | ≤ 3 | HUD `long` |
| Time to interactive (first interactive 3D frame) | ≤ 4 s on 4G | HUD `tti`, `perf_sample.ttiMs`, `city_interactive.ms` |
| 3D chunk download + evaluate | ≤ 2.5 s on 4G | HUD `chunk`, `perf_sample.chunkMs` |
| First-load JS before the 3D chunk | ≤ 600 KB gzipped | `pnpm size` after `pnpm build` |
| 3D chunk | ≤ 900 KB gzipped | `pnpm size` |
| JS heap (Chromium) | ≤ 300 MB | HUD `mem`, `perf_sample.memoryMb` |
| Draw calls on the street (medium tier) | ≤ 400 | HUD `draw` |

Tiers (`low | medium | high`) are chosen at start from cores, memory and the GPU string and step
down automatically on sustained drops (drei `PerformanceMonitor`). What each tier changes:

| Setting | low | medium | high |
|---|---|---|---|
| DPR clamp | 1.0 | 1.5 | 2.0 |
| Shadows | off | on, small map | on, large map |
| Prop / NPC density | sparse | normal | full |
| Signage glow, particles, animated stage lights | off | reduced | on |
| Texture size | 512 | 1024 | 2048 |

Force a tier with `?quality=low|medium|high` (remembered in `localStorage.chifir.quality`).

## The performance HUD

Open `/city?perf=1` in any build (production included); the flag is remembered for the tab, and
`?perf=0` turns it off. The card sits under the location badge and shows:

- **fps** over the last second and the last 10 seconds, coloured against the 30 fps budget.
- **frame** p50 / p95 / p99 in ms over the last ~600 frames, and the count of long frames.
- **load** `tti` (first interactive frame since navigation start), `chunk` (3D bundle download +
  evaluation), `1st frame`, `html` (response end). These are User Timing marks
  (`city:page-js`, `city:3d-chunk-start/loaded`, `city:first-frame`, `city:interactive`), so
  they also appear in DevTools › Performance and in WebPageTest.
- **draw** calls, triangles, textures and shader programs for the last rendered frame.
- **mem** JS heap in MB (Chromium only; Safari does not expose it).
- **tier / dpr / viewport / location** and **gpu / dev** (GPU name from the renderer string, cores,
  memory, effective connection type).
- **Copy report** puts the full JSON (everything above plus the user agent and URL) on the
  clipboard; **Share** opens the phone's share sheet. `window.__chifirPerf.report()` returns the
  same object from the console.

## On-device protocol (do this on every milestone)

1. Deploy a preview (Vercel) with `COMMERCE_MODE=demo` and `ALLOW_CLOCK_OVERRIDE=1`.
2. On the phone, open `/city?perf=1`, wait on the plaza for 30 s, copy the report → "plaza".
3. Walk the length of Food Street, copy → "food street".
4. Enter a restaurant, look at a product, copy → "interior".
5. Open the concierge, ask for something, close it, copy → "concierge".
6. Open `/city?perf=1&to=district:event-square&clock=<tonight 19:58 local>` and stay through
   the drop (pop-up opens, crowd gathers), copy → "event square live".
7. Paste the five reports in the milestone issue with the device model and OS version. Compare
   `fps` (10 s), `p95`, `long`, `tti`, `chunk`, `mem` against the budget table.

Fleet-wide: `perf_sample` is sent 30 s after the city is interactive and then every 30 s while
the tab is visible (`fps`, `frameP50Ms`, `frameP95Ms`, `ttiMs`, `chunkMs`, `memoryMb`,
`drawCalls`, `tier`, `dpr`, `location`), with the device context attached once per session.
Group by `device.tier` and `device.gpu` to find the models that miss the budget.

## Load path and what is lazy

- `/city` HTML + the framework + the small page JS; the city snapshot ships in the HTML payload.
- The 3D chunk (`CityApp`: three.js, R3F, drei, the engine) loads through `next/dynamic` with
  `ssr: false`; the loading screen stays until the first frame.
- Panels and drawers (product, merchant, cart, concierge, employee, places, event) load on first
  open; the Supabase browser client loads only when accounts are configured.
- Procedural geometry and canvas-rendered signage: no asset downloads for the first frame; merchant
  imagery streams in afterwards through `lib/media` at the tier's texture size.

Bundle sizes are checked in CI by `scripts/check-bundle-size.mjs` (`pnpm size` after a build):
it sums the gzipped chunks of the `/city` route and the lazy `CityApp` chunk and fails over
budget.

## Findings log

- 2026-10 (v0.2): instrumentation added; no on-device numbers yet (no device in the sandbox). The
  v0.1 build measured 665 KB gz first-load JS for `/city` (over the 600 KB budget) with the lazy
  3D chunk not yet separated in the size script; the panels/drawers are now lazy. Re-measure after
  the v0.2 build and record the numbers here.
