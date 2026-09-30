-- CITY ALIVE v0.2: drops, entitlements, merchant onboarding drafts.
-- Additive only; 0001 rows keep working unchanged.

-- ---------------------------------------------------------------- products: purchasability window
alter table public.products
  add column available_from timestamptz,
  add column available_until timestamptz,
  add constraint products_availability_window check (
    available_until is null or available_from is null or available_until > available_from
  );
create index products_available_from_idx on public.products (available_from) where available_from is not null;

-- ---------------------------------------------------------------- merchants: new template ids
alter table public.merchants drop constraint merchants_storefront_template_check;
alter table public.merchants drop constraint merchants_interior_template_check;
alter table public.merchants
  add constraint merchants_storefront_template_check
    check (storefront_template in ('bistro','fast-casual','cafe','boutique','flagship','kiosk','popup')),
  add constraint merchants_interior_template_check
    check (interior_template in ('restaurant-counter','restaurant-dining','retail-racks','retail-gallery','popup-gallery'));

-- ---------------------------------------------------------------- parcels: per-lot structure overrides (pop-ups)
alter table public.parcels
  add column storefront_template text check (storefront_template is null or storefront_template in ('bistro','fast-casual','cafe','boutique','flagship','kiosk','popup')),
  add column interior_template text check (interior_template is null or interior_template in ('restaurant-counter','restaurant-dining','retail-racks','retail-gallery','popup-gallery'));

-- ---------------------------------------------------------------- events: collections, media, capacity
alter table public.events
  add column product_ids uuid[] not null default '{}',
  add column capacity integer check (capacity is null or capacity > 0),
  add column hero_video_url text,
  add column livestream_url text;

-- ---------------------------------------------------------------- rewards: generic entitlements
alter table public.digital_rewards drop constraint digital_rewards_kind_check;
alter table public.digital_rewards
  add constraint digital_rewards_kind_check check (
    kind in ('avatar_item','apartment_item','food_prop','vehicle','badge','emote','access_pass')
  ),
  add column avatar_slot text check (avatar_slot is null or avatar_slot in ('outfit','headwear','footwear','accessory')),
  add column appearance jsonb;

-- ---------------------------------------------------------------- orders: drop attribution
alter table public.order_items add column event_id uuid references public.events(id) on delete set null;
create index order_items_event_idx on public.order_items (event_id) where event_id is not null;

-- ---------------------------------------------------------------- merchant onboarding drafts (admin only)
create table public.merchant_drafts (
  id uuid primary key default gen_random_uuid(),
  source_url text not null,
  status text not null default 'extracted'
    check (status in ('extracted','in_review','approved','published','rejected')),
  extraction jsonb not null default '{}'::jsonb,
  proposal jsonb not null,
  placement jsonb,
  reviewer_notes text,
  published_merchant_id uuid references public.merchants(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index merchant_drafts_status_idx on public.merchant_drafts (status, updated_at desc);
create trigger merchant_drafts_updated_at before update on public.merchant_drafts
  for each row execute function public.set_updated_at();

-- No client policies on purpose: drafts are read and written by the service role only, behind
-- the admin route handlers. The human approval step lives in application code and is re-checked
-- at publish time (`draftPublishProblem`).
alter table public.merchant_drafts enable row level security;
