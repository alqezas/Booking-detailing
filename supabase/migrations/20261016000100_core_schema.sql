-- Core multi-tenant schema.
--
-- Invariants enforced here:
--  * every dependent row carries tenant_id and references its parent through a
--    composite (tenant_id, id) foreign key, so a row can never point at another
--    tenant's service, bay or booking;
--  * bookings and bay blocks share resource_occupancies, and a GiST EXCLUDE
--    constraint makes two overlapping occupancies of one bay impossible;
--  * the client never sends price, duration or tenant: bookings snapshot them
--    from the service row inside the booking functions (see 0300).

create extension if not exists btree_gist with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;

-- Supabase grants anon/authenticated everything on new objects by default.
-- This project grants explicitly instead.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;

create type public.tenant_status as enum ('preview', 'live', 'suspended');
create type public.booking_status as enum ('confirmed', 'arrived', 'ready', 'cancelled', 'no_show');
create type public.occupancy_kind as enum ('booking', 'block');
create type public.payment_kind as enum ('payment', 'refund');
create type public.payment_method as enum ('cash', 'card', 'transfer', 'other');
create type public.notification_status as enum ('pending', 'processing', 'sent', 'failed', 'cancelled', 'skipped');
create type public.content_source as enum ('config', 'owner');

create or replace function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function private.is_valid_timezone(tz text) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = tz);
$$;

-- ---------------------------------------------------------------------------
-- Tenants and membership
-- ---------------------------------------------------------------------------
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$'),
  status public.tenant_status not null default 'preview',
  kind text not null check (kind in ('detailing', 'autoservice')),
  name text not null check (char_length(name) between 2 and 60),
  short_name text check (short_name is null or char_length(short_name) between 1 and 14),
  tagline text not null default '' check (char_length(tagline) <= 90),
  description text not null default '' check (char_length(description) <= 600),
  timezone text not null,
  currency text not null default 'RUB' check (currency in ('RUB', 'KZT', 'BYN', 'EUR', 'USD')),
  locale text not null default 'ru-RU',
  accent_color text not null check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  phone text not null check (phone ~ '^\+\d{10,15}$'),
  address text not null check (char_length(address) between 5 and 200),
  map_url text check (map_url is null or map_url ~ '^https://'),
  lat double precision check (lat is null or lat between -90 and 90),
  lng double precision check (lng is null or lng between -180 and 180),
  telegram text check (telegram is null or char_length(telegram) <= 64),
  whatsapp text check (whatsapp is null or char_length(whatsapp) <= 32),
  email text check (email is null or char_length(email) <= 254),
  logo_path text,
  hero_path text,
  slot_step_minutes int not null default 30 check (slot_step_minutes in (15, 30, 60)),
  min_lead_minutes int not null default 60 check (min_lead_minutes between 0 and 10080),
  horizon_days int not null default 30 check (horizon_days between 1 and 120),
  cancel_cutoff_hours int not null default 12 check (cancel_cutoff_hours between 0 and 336),
  default_buffer_minutes int not null default 30 check (default_buffer_minutes between 0 and 240),
  assistant_enabled boolean not null default true,
  config_hash text,
  published_at timestamptz,
  activated_at timestamptz,
  owner_edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenants_timezone_valid check (private.is_valid_timezone(timezone))
);
create trigger tenants_touch before update on public.tenants
  for each row execute function private.touch_updated_at();

create table public.tenant_members (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index tenant_members_user_idx on public.tenant_members (user_id);

-- ---------------------------------------------------------------------------
-- Catalogue: bays (resources), services and which bays fit which service
-- ---------------------------------------------------------------------------
create table public.resources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  name text not null check (char_length(name) between 1 and 40),
  is_active boolean not null default true,
  sort int not null default 0,
  source public.content_source not null default 'owner',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, key),
  unique (tenant_id, id)
);
create trigger resources_touch before update on public.resources
  for each row execute function private.touch_updated_at();

create table public.services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  name text not null check (char_length(name) between 2 and 80),
  description text not null default '' check (char_length(description) <= 400),
  category text not null default 'Услуги' check (char_length(category) <= 40),
  price int not null check (price between 0 and 10000000),
  price_from boolean not null default false,
  duration_minutes int not null check (duration_minutes between 15 and 20160),
  buffer_minutes int check (buffer_minutes is null or buffer_minutes between 0 and 1440),
  is_active boolean not null default true,
  sort int not null default 0,
  source public.content_source not null default 'owner',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, key),
  unique (tenant_id, id)
);
create trigger services_touch before update on public.services
  for each row execute function private.touch_updated_at();

create table public.service_resources (
  tenant_id uuid not null,
  service_id uuid not null,
  resource_id uuid not null,
  primary key (service_id, resource_id),
  foreign key (tenant_id, service_id) references public.services (tenant_id, id) on delete cascade,
  foreign key (tenant_id, resource_id) references public.resources (tenant_id, id) on delete cascade
);
create index service_resources_tenant_idx on public.service_resources (tenant_id);

-- ---------------------------------------------------------------------------
-- Schedule: weekly hours and dated exceptions (days off / special hours)
-- ---------------------------------------------------------------------------
create table public.working_hours (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7), -- ISO: 1 = Monday
  opens time not null,
  closes time not null,
  check (opens < closes)
);
create index working_hours_tenant_idx on public.working_hours (tenant_id, weekday);

create table public.schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  day date not null,
  is_closed boolean not null default true,
  opens time,
  closes time,
  note text check (note is null or char_length(note) <= 120),
  source public.content_source not null default 'owner',
  unique (tenant_id, day),
  check (is_closed or (opens is not null and closes is not null and opens < closes))
);

-- ---------------------------------------------------------------------------
-- Bookings and the shared occupancy table
-- ---------------------------------------------------------------------------
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  service_id uuid not null,
  resource_id uuid not null,
  status public.booking_status not null default 'confirmed',
  start_at timestamptz not null,
  end_at timestamptz not null,
  occupancy_end_at timestamptz not null,
  -- Snapshots: the price and duration the customer agreed to, immune to later edits.
  service_name text not null,
  price int not null check (price >= 0),
  price_from boolean not null default false,
  duration_minutes int not null,
  buffer_minutes int not null,
  customer_name text not null check (char_length(customer_name) between 2 and 80),
  customer_phone text not null check (customer_phone ~ '^\+\d{10,15}$'),
  car text not null check (char_length(car) between 2 and 80),
  comment text not null default '' check (char_length(comment) <= 500),
  source text not null check (source in ('client', 'owner', 'demo')),
  is_demo boolean not null default false,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9_-]{16,80}$'),
  request_fingerprint text not null,
  arrived_at timestamptz,
  ready_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by text check (cancelled_by is null or cancelled_by in ('client', 'owner')),
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 300),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, service_id) references public.services (tenant_id, id) on delete restrict,
  foreign key (tenant_id, resource_id) references public.resources (tenant_id, id) on delete restrict,
  check (start_at < end_at and end_at <= occupancy_end_at)
);
create index bookings_tenant_start_idx on public.bookings (tenant_id, start_at);
create trigger bookings_touch before update on public.bookings
  for each row execute function private.touch_updated_at();

create table public.resource_occupancies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  resource_id uuid not null,
  booking_id uuid unique,
  kind public.occupancy_kind not null,
  period tstzrange not null,
  note text check (note is null or char_length(note) <= 200),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, resource_id) references public.resources (tenant_id, id) on delete restrict,
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade,
  check ((kind = 'booking') = (booking_id is not null)),
  check (not isempty(period) and lower_inc(period) and not upper_inc(period)
         and not lower_inf(period) and not upper_inf(period)),
  constraint resource_occupancies_no_overlap
    exclude using gist (tenant_id with =, resource_id with =, period with &&)
);
create index resource_occupancies_tenant_idx on public.resource_occupancies using gist (tenant_id, period);

-- Access to one booking for a customer without an account: only a hash of the
-- capability token is stored.
create table public.booking_access (
  booking_id uuid primary key,
  tenant_id uuid not null,
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  booking_id uuid not null,
  kind public.payment_kind not null,
  amount int not null check (amount > 0 and amount <= 10000000),
  method public.payment_method not null default 'cash',
  paid_at timestamptz not null default now(),
  note text not null default '' check (char_length(note) <= 200),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9_-]{16,80}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade
);
create index payments_tenant_paid_idx on public.payments (tenant_id, paid_at);

-- ---------------------------------------------------------------------------
-- Public page content
-- ---------------------------------------------------------------------------
create table public.gallery_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  image_path text not null check (char_length(image_path) between 1 and 500),
  caption text not null default '' check (char_length(caption) <= 120),
  sort int not null default 0,
  source public.content_source not null default 'owner',
  config_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, config_key)
);
create index gallery_items_tenant_idx on public.gallery_items (tenant_id, sort);
create trigger gallery_items_touch before update on public.gallery_items
  for each row execute function private.touch_updated_at();

create table public.info_cards (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  position smallint not null check (position between 1 and 3),
  icon text not null check (icon in ('shield', 'sparkle', 'clock', 'drop', 'car', 'wrench', 'medal', 'sun', 'coffee', 'credit-card')),
  title text not null check (char_length(title) between 2 and 40),
  text text not null check (char_length(text) between 2 and 160),
  source public.content_source not null default 'owner',
  primary key (tenant_id, position)
);

-- ---------------------------------------------------------------------------
-- Notifications: Web Push subscriptions and the outbox
-- ---------------------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  booking_id uuid not null,
  endpoint text not null check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  created_at timestamptz not null default now(),
  unique (booking_id, endpoint),
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade
);

create table public.notification_jobs (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  booking_id uuid not null,
  kind text not null check (kind in ('reminder_24h')),
  run_at timestamptz not null,
  status public.notification_status not null default 'pending',
  attempts int not null default 0,
  max_attempts int not null default 5,
  lease_until timestamptz,
  locked_by text,
  dedupe_key text not null unique,
  booking_start_at timestamptz not null,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade
);
create index notification_jobs_due_idx on public.notification_jobs (run_at) where status in ('pending', 'processing');
create trigger notification_jobs_touch before update on public.notification_jobs
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Private: secrets, counters, budgets
-- ---------------------------------------------------------------------------
create table private.app_secrets (
  name text primary key,
  value text not null
);
insert into private.app_secrets (name, value)
values ('booking_token_hmac', encode(extensions.gen_random_bytes(32), 'hex')),
       ('cron_secret', encode(extensions.gen_random_bytes(24), 'hex'));

create table private.app_config (
  name text primary key,
  value text not null
);
-- Overridden per environment, see SETUP.md (cron section).
insert into private.app_config (name, value)
values ('functions_url', 'http://kong:8000/functions/v1');

create table private.rate_counters (
  key text not null,
  window_start timestamptz not null,
  hits int not null,
  primary key (key, window_start)
);

create table private.llm_usage (
  scope text not null,
  day date not null,
  requests int not null default 0,
  tokens bigint not null default 0,
  primary key (scope, day)
);

-- ---------------------------------------------------------------------------
-- Row level security: on for every table; policies live in 0200.
-- ---------------------------------------------------------------------------
alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;
alter table public.resources enable row level security;
alter table public.services enable row level security;
alter table public.service_resources enable row level security;
alter table public.working_hours enable row level security;
alter table public.schedule_exceptions enable row level security;
alter table public.bookings enable row level security;
alter table public.resource_occupancies enable row level security;
alter table public.booking_access enable row level security;
alter table public.payments enable row level security;
alter table public.gallery_items enable row level security;
alter table public.info_cards enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_jobs enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
