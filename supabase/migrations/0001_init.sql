-- ============================================================================
-- 0001_init.sql — Chifir MVP schema
-- Conventions: uuid PKs, timestamptz, *_cents integers, text + CHECK instead of
-- enums, jsonb for nested configuration read as a whole. RLS on every table.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- helpers
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Citizen',
  avatar jsonb not null default '{"bodyColor":"#4F86F7","hairColor":"#2B2118","accessories":[]}'::jsonb,
  city_level integer not null default 1 check (city_level >= 1),
  xp integer not null default 0 check (xp >= 0),
  dietary_preferences text[] not null default '{}',
  default_address jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), split_part(coalesce(new.email, ''), '@', 1), 'Citizen')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- city
create table public.districts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  theme jsonb not null default '{}'::jsonb,
  bounds jsonb not null,
  spawn_point jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger districts_updated_at before update on public.districts
  for each row execute function public.set_updated_at();

create table public.merchants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  tagline text,
  description text not null default '',
  category text not null,
  merchant_type text not null check (merchant_type in ('restaurant','retail','service','venue','popup')),
  status text not null default 'draft' check (status in ('draft','published','paused')),
  tags text[] not null default '{}',
  price_level smallint check (price_level between 1 and 4),
  logo_url text,
  hero_image_url text,
  images text[] not null default '{}',
  brand jsonb not null default '{"primary":"#1a1d24","secondary":"#e9e6df","accent":"#ff5a36","onPrimary":"#e9e6df"}'::jsonb,
  website_url text,
  address jsonb,
  geo jsonb,
  opening_hours jsonb,
  storefront_template text not null default 'boutique'
    check (storefront_template in ('bistro','fast-casual','cafe','boutique','flagship','kiosk')),
  interior_template text not null default 'retail-racks'
    check (interior_template in ('restaurant-counter','restaurant-dining','retail-racks','retail-gallery')),
  storefront_config jsonb not null default '{"signStyle":"painted","facade":"plaster","awning":false,"floors":1,"windowDisplay":"products","accentLights":false}'::jsonb,
  fulfillment jsonb not null default '{"provider":"simulated"}'::jsonb,
  sponsored boolean not null default false,
  rating numeric(3,2) check (rating between 0 and 5),
  rating_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index merchants_status_idx on public.merchants (status);
create index merchants_category_idx on public.merchants (category);
create index merchants_type_idx on public.merchants (merchant_type);
create index merchants_tags_idx on public.merchants using gin (tags);
create trigger merchants_updated_at before update on public.merchants
  for each row execute function public.set_updated_at();

create table public.parcels (
  id uuid primary key default gen_random_uuid(),
  district_id uuid not null references public.districts(id) on delete cascade,
  slug text not null unique,
  position jsonb not null,
  rotation_y double precision not null default 0,
  size jsonb not null,
  tier text not null check (tier in ('standard','corner','flagship','kiosk','venue','billboard')),
  status text not null default 'available' check (status in ('available','occupied','reserved')),
  merchant_id uuid references public.merchants(id) on delete set null,
  -- Time-boxed tenancy for pop-ups and billboard campaigns; null = open-ended.
  occupied_from timestamptz,
  occupied_until timestamptz,
  sponsored boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (occupied_until is null or occupied_from is null or occupied_until > occupied_from)
);
create index parcels_district_idx on public.parcels (district_id);
-- A merchant may hold several parcels (store + billboard + pop-up).
create index parcels_merchant_idx on public.parcels (merchant_id) where merchant_id is not null;
create trigger parcels_updated_at before update on public.parcels
  for each row execute function public.set_updated_at();

create table public.ai_employees (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null unique references public.merchants(id) on delete cascade,
  name text not null,
  role text not null default 'host',
  avatar_url text,
  personality text not null default '',
  tone text not null default '',
  greeting text not null default '',
  knowledge text[] not null default '{}',
  upsell_rules text[] not null default '{}',
  prohibited_claims text[] not null default '{}',
  brand_language text[] not null default '{}',
  escalation jsonb not null default '{"enabled":false}'::jsonb,
  allowed_context text[] not null default '{cart,dietary,budget}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger ai_employees_updated_at before update on public.ai_employees
  for each row execute function public.set_updated_at();

create table public.digital_rewards (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  kind text not null check (kind in ('avatar_item','apartment_item','badge','vehicle','emote')),
  asset_url text,
  preview_image_url text,
  rarity text not null default 'common' check (rarity in ('common','rare','epic','legendary')),
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  slug text not null,
  title text not null,
  description text not null default '',
  category text not null default 'general',
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'USD' check (currency in ('USD','EUR','GBP')),
  compare_at_price_cents integer check (compare_at_price_cents >= 0),
  image_url text,
  images text[] not null default '{}',
  model_3d_url text,
  inventory_status text not null default 'in_stock'
    check (inventory_status in ('in_stock','low_stock','out_of_stock','preorder')),
  inventory_count integer check (inventory_count >= 0),
  variant_groups jsonb not null default '[]'::jsonb,
  attributes jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}',
  fulfillment_types text[] not null default '{delivery,pickup}',
  lead_time jsonb not null default '{}'::jsonb,
  digital_reward_id uuid references public.digital_rewards(id) on delete set null,
  featured boolean not null default false,
  sort_order integer not null default 0,
  active boolean not null default true,
  search_tsv tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_id, slug)
);
create index products_merchant_idx on public.products (merchant_id);
create index products_category_idx on public.products (category);
create index products_price_idx on public.products (price_cents);
create index products_active_idx on public.products (active);
create index products_tags_idx on public.products using gin (tags);
create index products_search_idx on public.products using gin (search_tsv);
create index products_attributes_idx on public.products using gin (attributes jsonb_path_ops);

create or replace function public.products_search_tsv_update()
returns trigger language plpgsql as $$
begin
  new.search_tsv :=
    setweight(to_tsvector('english', coalesce(new.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.category, '')), 'B') ||
    setweight(to_tsvector('english', array_to_string(coalesce(new.tags, '{}'), ' ')), 'B') ||
    setweight(to_tsvector('english', coalesce(new.description, '')), 'C');
  return new;
end $$;
create trigger products_search_tsv before insert or update on public.products
  for each row execute function public.products_search_tsv_update();
create trigger products_updated_at before update on public.products
  for each row execute function public.set_updated_at();

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  -- {"productIds":[],"categories":[],"tags":[]}; empty = all of the merchant's products
  scope jsonb not null default '{}'::jsonb,
  title text not null,
  description text not null default '',
  kind text not null check (kind in ('percent_off','amount_off','free_item','bundle')),
  value integer not null default 0 check (value >= 0),
  code text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  max_redemptions integer check (max_redemptions > 0),
  redemptions_count integer not null default 0 check (redemptions_count >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index offers_merchant_idx on public.offers (merchant_id);
create index offers_window_idx on public.offers (starts_at, ends_at) where active;

create table public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text not null default '',
  kind text not null check (kind in ('launch','live','promo','concert','opening','flash_deal')),
  status text not null default 'scheduled' check (status in ('scheduled','live','ended','cancelled')),
  merchant_id uuid references public.merchants(id) on delete set null,
  district_id uuid references public.districts(id) on delete set null,
  parcel_id uuid references public.parcels(id) on delete set null,
  offer_id uuid references public.offers(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  reward_id uuid references public.digital_rewards(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  hero_image_url text,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index events_window_idx on public.events (starts_at, ends_at);
create trigger events_updated_at before update on public.events
  for each row execute function public.set_updated_at();

-- Tickets point at the event they admit to (added after events exists: circular reference).
alter table public.products add column event_id uuid references public.events(id) on delete set null;
create index products_event_idx on public.products (event_id) where event_id is not null;

-- ---------------------------------------------------------------- commerce
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  status text not null default 'pending_payment'
    check (status in ('pending_payment','payment_failed','paid','in_fulfillment','completed','cancelled','refunded')),
  currency text not null default 'USD' check (currency in ('USD','EUR','GBP')),
  subtotal_cents integer not null check (subtotal_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  delivery_fee_cents integer not null default 0 check (delivery_fee_cents >= 0),
  tax_cents integer not null default 0 check (tax_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  -- The payer's default address; each fulfillment carries its own copy (group orders later).
  delivery_address jsonb,
  -- The payer.
  contact jsonb not null,
  promo_code text,
  -- sha256 hex of the guest access token issued once at checkout (never the token itself)
  access_token_hash text,
  -- funnel attribution copied from the analytics client at checkout
  session_id text,
  anonymous_id text,
  payment_provider text not null default 'stripe' check (payment_provider in ('stripe','demo')),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  placed_at timestamptz not null default now(),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_user_idx on public.orders (user_id, created_at desc);
create trigger orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  merchant_id uuid references public.merchants(id) on delete set null,
  merchant_name_snapshot text not null,
  title_snapshot text not null,
  image_url_snapshot text,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  offer_id uuid references public.offers(id) on delete set null,
  quantity integer not null check (quantity > 0),
  variant_selection jsonb not null default '{}'::jsonb,
  variant_label text,
  digital_reward_id uuid references public.digital_rewards(id) on delete set null
);
create index order_items_order_idx on public.order_items (order_id);

create table public.order_fulfillments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  merchant_id uuid references public.merchants(id) on delete set null,
  merchant_name_snapshot text not null,
  provider text not null default 'simulated'
    check (provider in ('simulated','merchant_self','doordash_drive','shippo')),
  type text not null
    check (type in ('delivery','pickup','shipping','booking','ticket','digital','lead')),
  status text not null default 'pending'
    check (status in ('pending','accepted','preparing','ready','out_for_delivery','shipped','delivered','cancelled','failed')),
  subtotal_cents integer not null default 0 check (subtotal_cents >= 0),
  fee_cents integer not null default 0 check (fee_cents >= 0),
  recipient jsonb,
  delivery_address jsonb,
  external_id text,
  eta_at timestamptz,
  tracking_url text,
  events jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, merchant_id)
);
create index order_fulfillments_order_idx on public.order_fulfillments (order_id);
create trigger order_fulfillments_updated_at before update on public.order_fulfillments
  for each row execute function public.set_updated_at();

create table public.user_rewards (
  user_id uuid not null references auth.users(id) on delete cascade,
  reward_id uuid not null references public.digital_rewards(id) on delete cascade,
  source_order_id uuid references public.orders(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, reward_id)
);

-- ---------------------------------------------------------------- ai + analytics
create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  scope text not null check (scope in ('concierge','employee')),
  merchant_id uuid references public.merchants(id) on delete set null,
  created_at timestamptz not null default now()
);
create index ai_conversations_user_idx on public.ai_conversations (user_id, created_at desc);

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','tool')),
  content text not null,
  tool_calls jsonb,
  created_at timestamptz not null default now()
);
create index ai_messages_conversation_idx on public.ai_messages (conversation_id, created_at);

create table public.analytics_events (
  id bigint generated always as identity primary key,
  name text not null,
  props jsonb not null default '{}'::jsonb,
  ts timestamptz not null,
  session_id text not null,
  anonymous_id text not null,
  user_id uuid,
  device jsonb,
  received_at timestamptz not null default now()
);
create index analytics_events_name_ts_idx on public.analytics_events (name, ts desc);
create index analytics_events_session_idx on public.analytics_events (session_id);

-- ---------------------------------------------------------------- search RPC
create or replace function public.search_products(
  p_query text default null,
  p_max_price_cents integer default null,
  p_min_price_cents integer default null,
  p_merchant_ids uuid[] default null,
  p_merchant_type text default null,
  p_dietary text[] default null,
  p_min_spice smallint default null,
  p_fulfillment_type text default null,
  p_tags text[] default null,
  p_category text default null,
  p_occasion text default null,
  p_in_stock_only boolean default true,
  p_limit integer default 20
)
returns setof public.products
language sql stable as $$
  select p.*
  from public.products p
  join public.merchants m on m.id = p.merchant_id
  where p.active
    and m.status = 'published'
    and (p_query is null or p_query = '' or p.search_tsv @@ websearch_to_tsquery('english', p_query)
         or p.title ilike '%' || p_query || '%')
    and (p_max_price_cents is null or p.price_cents <= p_max_price_cents)
    and (p_min_price_cents is null or p.price_cents >= p_min_price_cents)
    and (p_merchant_ids is null or p.merchant_id = any(p_merchant_ids))
    and (p_merchant_type is null or m.merchant_type = p_merchant_type)
    and (p_dietary is null or (
      select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(coalesce(p.attributes->'dietary', '[]'::jsonb)) x
    ) @> p_dietary)
    and (p_min_spice is null or coalesce((p.attributes->>'spiceLevel')::smallint, 0) >= p_min_spice)
    and (p_fulfillment_type is null or p_fulfillment_type = any(p.fulfillment_types))
    and (p_tags is null or p.tags && p_tags)
    and (p_category is null or p.category = p_category or m.category = p_category or m.category like p_category || '.%')
    and (p_occasion is null or p.attributes @> jsonb_build_object('occasion', jsonb_build_array(p_occasion)) or p_occasion = any(p.tags))
    and (not p_in_stock_only or p.inventory_status <> 'out_of_stock')
  order by
    case when p_query is null or p_query = '' then 0
         else ts_rank(p.search_tsv, websearch_to_tsquery('english', p_query)) end desc,
    p.featured desc,
    p.sort_order asc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

-- ---------------------------------------------------------------- XP ledger + RPC (atomic, idempotent)
create table public.xp_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null check (amount >= 0),
  reason text not null,
  source_order_id uuid references public.orders(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index xp_ledger_idempotent on public.xp_ledger (user_id, reason, source_order_id)
  where source_order_id is not null;
create index xp_ledger_user_idx on public.xp_ledger (user_id, created_at desc);

create or replace function public.add_xp(p_user_id uuid, p_amount integer, p_reason text, p_source_order_id uuid default null)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  result public.profiles;
  inserted integer;
begin
  insert into public.xp_ledger (user_id, amount, reason, source_order_id)
  values (p_user_id, greatest(0, p_amount), p_reason, p_source_order_id)
  on conflict do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then
    select * into result from public.profiles where id = p_user_id;
    return result;
  end if;
  update public.profiles
  set xp = xp + greatest(0, p_amount),
      city_level = greatest(1, 1 + floor(sqrt((xp + greatest(0, p_amount)) / 100.0))::integer)
  where id = p_user_id
  returning * into result;
  return result;
end $$;
revoke all on function public.add_xp(uuid, integer, text, uuid) from public, anon, authenticated;

-- Atomic pending_payment -> paid transition; returns the row only when this call transitioned it.
create or replace function public.mark_order_paid(p_order_id uuid, p_payment_intent_id text default null, p_paid_at timestamptz default now())
returns setof public.orders
language sql security definer set search_path = public as $$
  update public.orders
  set status = 'paid',
      paid_at = coalesce(p_paid_at, now()),
      stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id)
  where id = p_order_id and status = 'pending_payment'
  returning *;
$$;
revoke all on function public.mark_order_paid(uuid, text, timestamptz) from public, anon, authenticated;

-- Attaches a guest order to the calling user when the access token hash matches.
create or replace function public.claim_order(p_order_id uuid, p_token_hash text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  updated integer;
begin
  if auth.uid() is null then
    return false;
  end if;
  update public.orders
  set user_id = auth.uid()
  where id = p_order_id
    and user_id is null
    and access_token_hash is not null
    and access_token_hash = p_token_hash;
  get diagnostics updated = row_count;
  return updated > 0;
end $$;
grant execute on function public.claim_order(uuid, text) to authenticated;

-- Counts one redemption if the offer is live and under its cap. Returns true when counted.
create or replace function public.redeem_offer(p_offer_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  updated integer;
begin
  update public.offers
  set redemptions_count = redemptions_count + 1
  where id = p_offer_id
    and active
    and now() between starts_at and ends_at
    and (max_redemptions is null or redemptions_count < max_redemptions);
  get diagnostics updated = row_count;
  return updated > 0;
end $$;
revoke all on function public.redeem_offer(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- RLS
alter table public.profiles enable row level security;
alter table public.districts enable row level security;
alter table public.parcels enable row level security;
alter table public.merchants enable row level security;
alter table public.ai_employees enable row level security;
alter table public.digital_rewards enable row level security;
alter table public.products enable row level security;
alter table public.offers enable row level security;
alter table public.events enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_fulfillments enable row level security;
alter table public.user_rewards enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.analytics_events enable row level security;
alter table public.xp_ledger enable row level security;

-- profiles: owner read; owner may update only presentation/preference columns (XP is server-only)
create policy profiles_select_own on public.profiles for select using (auth.uid() = id);
create policy profiles_update_own on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
revoke update on public.profiles from anon, authenticated;
grant update (display_name, avatar, dietary_preferences, default_address) on public.profiles to authenticated;
create policy xp_ledger_select_own on public.xp_ledger for select using (auth.uid() = user_id);

-- public catalog: anyone can read published/active rows; writes are service role only
create policy districts_public_read on public.districts for select using (true);
create policy parcels_public_read on public.parcels for select using (true);
create policy merchants_public_read on public.merchants for select using (status = 'published');
create policy ai_employees_public_read on public.ai_employees for select
  using (exists (select 1 from public.merchants m where m.id = merchant_id and m.status = 'published'));
-- Only the public persona columns are readable by clients; rules/knowledge/escalation are server-only.
revoke select on public.ai_employees from anon, authenticated;
grant select (id, merchant_id, name, role, avatar_url, greeting) on public.ai_employees to anon, authenticated;
create policy digital_rewards_public_read on public.digital_rewards for select using (true);
create policy products_public_read on public.products for select
  using (active and exists (select 1 from public.merchants m where m.id = merchant_id and m.status = 'published'));
create policy offers_public_read on public.offers for select using (active);
create policy events_public_read on public.events for select using (status <> 'cancelled');

-- orders: owner read only (all writes via service role in route handlers)
create policy orders_select_own on public.orders for select using (auth.uid() = user_id);
create policy order_items_select_own on public.order_items for select
  using (exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()));
create policy order_fulfillments_select_own on public.order_fulfillments for select
  using (exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()));
create policy user_rewards_select_own on public.user_rewards for select using (auth.uid() = user_id);

-- ai history: owner read
create policy ai_conversations_select_own on public.ai_conversations for select using (auth.uid() = user_id);
create policy ai_messages_select_own on public.ai_messages for select
  using (exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.user_id = auth.uid()));

-- analytics: no client access at all (service role bypasses RLS)
