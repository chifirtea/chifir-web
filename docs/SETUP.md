# Setup

Three ways to run Chifir, from nothing to production. Each step is optional and additive: the
app degrades to the previous mode when a service is not configured (`src/lib/env.server.ts`).

## 1. Local, zero infrastructure

```sh
pnpm install
cp .env.example .env.local   # everything blank is fine
pnpm dev                     # http://localhost:3000
```

With no Supabase variables the app uses `StaticDataSource` (ADR-002): the full city, stores,
cart and the demo payment path (`COMMERCE_MODE=demo`, never in production) all work from the seed
data in `src/data/seed`. Accounts are off: `/auth/login` explains this, `/account` redirects there,
and the HUD hides the account menu. Orders live in process memory and vanish on restart.

Checks: `pnpm check` (typecheck + lint + tests). Never commit `.env.local`.

## 2. Supabase (data + accounts)

1. Create a project at [supabase.com](https://supabase.com). Note the project URL, the `anon`
   key and the `service_role` key (Project settings → API).
2. Apply the schema. Either paste `supabase/migrations/0001_init.sql` into the SQL editor and
   run it, or link the CLI and push:
   ```sh
   supabase link --project-ref <ref>
   supabase db push
   ```
   The migration creates every table with RLS, the `search_products` / `add_xp` /
   `mark_order_paid` / `claim_order` / `redeem_offer` functions, and a trigger on `auth.users`
   that inserts a `profiles` row for every new user (display name from the `display_name`
   metadata the sign-up form sends, or the email's local part).
3. Set the environment:
   ```sh
   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
   SUPABASE_SERVICE_ROLE_KEY=<service role key>   # server-only, never NEXT_PUBLIC_
   ```
   The app switches to `SupabaseDataSource` only when all three are set.
4. Seed the catalog (idempotent, safe to re-run; upserts by id in dependency order):
   ```sh
   pnpm db:seed
   ```
   It reads `.env.local` then `.env`, needs `NEXT_PUBLIC_SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY`, prints a table of row counts and exits non-zero on any error.
   Offers and events are time-relative ("this Friday"), so re-seed occasionally for demos.
5. Enable email auth (Authentication → Providers → Email). Magic links and email confirmation
   redirect to `/auth/callback`, so add your origins to Authentication → URL configuration →
   Redirect URLs, e.g. `http://localhost:3000/**` and `https://<your-domain>/**`. Turning off
   "Confirm email" makes password sign-up land in the city immediately; with it on, the user gets
   a confirmation link first.

What the schema enforces (worth knowing before you change it):

- Clients hold the anon key; RLS restricts them to published catalog rows and their own
  profile, orders, rewards and AI history. All writes go through the service role in route
  handlers and server actions.
- Column grants narrow this further: `authenticated` may update only
  `display_name`, `avatar`, `dietary_preferences` and `default_address` on `profiles` (XP and level
  are server-only via `add_xp`), and may read only the public persona columns of `ai_employees`
  (`id`, `merchant_id`, `name`, `role`, `avatar_url`, `greeting`). Rules, knowledge and escalation
  never leave the server.
- `analytics_events` has no client policy at all; `/api/analytics` writes it with the service role.

Session handling: `src/proxy.ts` refreshes the Supabase session cookie on every page request and
redirects signed-out visitors from `/account` to `/auth/login?next=/account`. Stripe webhooks
and static assets are excluded from the proxy.

## 3. Stripe (test mode)

1. Get test keys from the Stripe dashboard (Developers → API keys) and set:
   ```sh
   STRIPE_SECRET_KEY=sk_test_...
   ```
   Stripe requires Supabase: orders need durable storage, and boot fails in production if
   `STRIPE_SECRET_KEY` is set without it.
2. Forward webhooks to your dev server and copy the signing secret it prints:
   ```sh
   stripe login
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   # > Ready! Your webhook signing secret is whsec_...
   ```
   ```sh
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```
   `checkout.session.completed` marks the order paid, counts offer redemptions, starts
   fulfillment, grants digital rewards and adds XP. Processing is idempotent per Checkout Session.
3. Pay with a test card (`4242 4242 4242 4242`, any future date, any CVC).

Without a Stripe key, development uses the demo payment path at `/api/checkout/demo`, which
refuses to run when `NODE_ENV=production` or `COMMERCE_MODE=live`.

## 4. AI (concierge + merchant employees)

```sh
ANTHROPIC_API_KEY=sk-ant-...
AI_MODEL=claude-opus-5-5   # default; any model id the key can use
```

Without a key the chat surfaces explain that the concierge is off. Every fact the model states
comes from a tool call over the same `DataSource` the UI uses; the key never reaches the browser.

## 4b. Rehearsing the drop, admin surfaces, presence (v0.2)

- **City clock.** Every countdown, pop-up tenancy and product availability window reads one clock.
  Outside production (or with `ALLOW_CLOCK_OVERRIDE=1` on a staging deployment) you can shift it:
  `/city?clock=2026-10-01T19:59:30` (local wall time), `/city?clock=+900` (seconds from now) or an
  epoch in ms. The offset sticks for the tab (checkout and the order page use it too), so a drop can
  be rehearsed at any time of day. Production ignores the override unless explicitly enabled.
- **Merchant generator.** `/admin/generate` is open on localhost and needs
  `ADMIN_ACCESS_TOKEN` (≥16 chars, sent as a bearer token or stored in a cookie by
  `POST /api/admin/session`) anywhere `NODE_ENV=production`. See docs/MERCHANT-GENERATOR.md.
- **Presence.** With the public Supabase variables set, players in the same district or room see
  each other through Supabase Realtime; without them, tabs of one browser see each other (local
  development, static preview, tests). Nothing else to configure. `PRESENCE_ROOM_PREFIX` namespaces
  rooms when several deployments share one project.
- **Performance HUD.** `/city?perf=1` shows FPS, frame-time percentiles, TTI, 3D chunk load time,
  memory (where the browser exposes it) and device/GPU info in any build. See docs/PERFORMANCE.md.

## 5. Deploying to Vercel

- Import the repo; framework preset Next.js; build `pnpm build`.
- Environment variables (Production and Preview):
  `NEXT_PUBLIC_APP_URL` (your https origin), the three Supabase variables, `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `AI_MODEL`, `COMMERCE_MODE`, and for v0.2
  `ADMIN_ACCESS_TOKEN` (Production) and `ALLOW_CLOCK_OVERRIDE=1` (Preview only, to rehearse drops).
- Apply both migrations (`supabase/migrations/0001_init.sql`, `0002_city_alive.sql`) in order.
- Create a Stripe webhook endpoint (Developers → Webhooks) pointing at
  `https://<domain>/api/webhooks/stripe` for `checkout.session.completed`, and use its signing
  secret as `STRIPE_WEBHOOK_SECRET` (the CLI secret is for local forwarding only).
- Add `https://<domain>/**` to the Supabase redirect URL allowlist.
- `COMMERCE_MODE=live` with an `sk_live_` key **only in Production** with `NODE_ENV=production`
  (Vercel sets it). A live key in any other combination fails at boot on purpose. Keep Preview on
  `COMMERCE_MODE=demo` with `sk_test_` keys or no Stripe key.
- Run `pnpm db:seed` once against the production project from your machine (it only needs the
  two Supabase variables in your local `.env.local`).
