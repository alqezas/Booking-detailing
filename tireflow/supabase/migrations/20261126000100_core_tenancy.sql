-- TireFlow · Phase 1 · Core multi-tenancy, RBAC, audit
-- Every tenant-scoped table carries business_id and exposes UNIQUE (business_id, id)
-- so that children reference parents through composite foreign keys. A row of
-- business A can therefore never point at a row of business B, even via the API.

create extension if not exists btree_gist with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ─────────────────────────────────────────── enums
create type public.app_role as enum ('owner', 'manager', 'mechanic', 'accountant');
create type public.currency_code as enum ('CZK', 'EUR', 'PLN', 'UAH');
create type public.app_locale as enum ('cs', 'pl', 'uk', 'sk', 'de', 'en', 'ru');
create type public.module_key as enum (
  'calendar', 'orders', 'customers', 'vehicles', 'tire_hotel', 'inventory',
  'services', 'employees', 'finance', 'analytics', 'notifications',
  'corporate', 'online_booking', 'ai_assistant'
);

-- ─────────────────────────────────────────── generic helpers
create or replace function private.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ─────────────────────────────────────────── platform
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (length(full_name) <= 200),
  locale public.app_locale not null default 'en',
  last_business_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();

-- Super admins of the platform. They manage businesses, not tenant data.
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$'),
  name text not null check (length(name) between 2 and 120),
  legal_name text,
  is_active boolean not null default true,
  is_demo boolean not null default false,
  -- licensing is modelled, not hard-wired to a monthly subscription
  license_kind text not null default 'trial'
    check (license_kind in ('trial', 'subscription', 'perpetual', 'partner', 'internal')),
  license_valid_until date,
  max_branches int not null default 3 check (max_branches > 0),
  max_users int not null default 25 check (max_users > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger businesses_touch before update on public.businesses
  for each row execute function private.touch_updated_at();

create table public.business_settings (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  logo_path text,
  brand_color text not null default '#0f766e' check (brand_color ~ '^#[0-9a-fA-F]{6}$'),
  accent_color text not null default '#f59e0b' check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  email text,
  phone text,
  website text,
  currency public.currency_code not null default 'EUR',
  crm_locale public.app_locale not null default 'en',
  public_locale public.app_locale not null default 'en',
  timezone text not null default 'Europe/Prague',
  -- tax in basis points: 2100 = 21.00 %
  default_tax_rate_bp int not null default 2100 check (default_tax_rate_bp between 0 and 10000),
  prices_include_tax boolean not null default true,
  tax_id text,
  slot_step_minutes int not null default 15 check (slot_step_minutes in (5, 10, 15, 20, 30, 60)),
  booking_lead_minutes int not null default 60 check (booking_lead_minutes >= 0),
  booking_horizon_days int not null default 60 check (booking_horizon_days between 1 and 365),
  booking_cancel_until_minutes int not null default 120 check (booking_cancel_until_minutes >= 0),
  booking_requires_confirmation boolean not null default false,
  seasonal_mode boolean not null default false,
  order_number_prefix text not null default 'WO' check (length(order_number_prefix) <= 8),
  storage_price_per_season bigint not null default 0 check (storage_price_per_season >= 0),
  updated_at timestamptz not null default now(),
  check (timezone ~ '^[A-Za-z_]+(/[A-Za-z_+-]+)*$')
);
create trigger business_settings_touch before update on public.business_settings
  for each row execute function private.touch_updated_at();

create table public.business_modules (
  business_id uuid not null references public.businesses (id) on delete cascade,
  module public.module_key not null,
  enabled boolean not null default true,
  primary key (business_id, module)
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  address_line text,
  city text,
  postal_code text,
  country text not null default 'CZ' check (country ~ '^[A-Z]{2}$'),
  phone text,
  email text,
  -- weekly hours: {"1":[["08:00","18:00"]], ... "7":[]}, ISO weekday keys
  opening_hours jsonb not null default '{"1":[["08:00","18:00"]],"2":[["08:00","18:00"]],"3":[["08:00","18:00"]],"4":[["08:00","18:00"]],"5":[["08:00","18:00"]],"6":[["09:00","14:00"]],"7":[]}'::jsonb,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (business_id, id)
);
create index branches_business_idx on public.branches (business_id);
create trigger branches_touch before update on public.branches
  for each row execute function private.touch_updated_at();

-- ─────────────────────────────────────────── RBAC
create table public.permissions (
  code text primary key check (code ~ '^[a-z_]+\.[a-z_]+$'),
  description text not null
);

create table public.role_permissions (
  role public.app_role not null,
  permission text not null references public.permissions (code) on delete cascade,
  primary key (role, permission)
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  -- per-member overrides on top of role defaults
  granted_permissions text[] not null default '{}',
  revoked_permissions text[] not null default '{}',
  branch_ids uuid[] not null default '{}', -- empty = all branches
  is_active boolean not null default true,
  invited_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, user_id),
  unique (business_id, id)
);
create index memberships_user_idx on public.memberships (user_id) where is_active;
create trigger memberships_touch before update on public.memberships
  for each row execute function private.touch_updated_at();

insert into public.permissions (code, description) values
  ('business.manage', 'Edit business profile, branches, modules'),
  ('members.manage', 'Invite staff and change roles'),
  ('calendar.view', 'See the calendar'),
  ('calendar.manage', 'Create, move and cancel bookings'),
  ('customers.view', 'See customers and vehicles'),
  ('customers.manage', 'Create and edit customers and vehicles'),
  ('customers.export', 'Export customer data'),
  ('orders.view_all', 'See all work orders'),
  ('orders.view_assigned', 'See work orders assigned to me'),
  ('orders.manage', 'Create and edit work orders'),
  ('orders.work', 'Update status and add notes on assigned work'),
  ('services.manage', 'Edit services, prices and rules'),
  ('tire_hotel.view', 'See stored tire sets'),
  ('tire_hotel.manage', 'Check tires in and out'),
  ('inventory.view', 'See stock'),
  ('inventory.manage', 'Receive, issue and count stock'),
  ('employees.view', 'See staff and schedules'),
  ('employees.manage', 'Edit staff, shifts and absences'),
  ('finance.view', 'See payments, revenue and expenses'),
  ('finance.manage', 'Record payments, refunds and expenses'),
  ('finance.export', 'Export financial data'),
  ('analytics.view', 'See analytics'),
  ('notifications.manage', 'Edit templates and campaigns'),
  ('audit.view', 'Read the audit log');

insert into public.role_permissions (role, permission)
select 'owner', code from public.permissions;

insert into public.role_permissions (role, permission) values
  ('manager', 'calendar.view'), ('manager', 'calendar.manage'),
  ('manager', 'customers.view'), ('manager', 'customers.manage'),
  ('manager', 'orders.view_all'), ('manager', 'orders.view_assigned'),
  ('manager', 'orders.manage'), ('manager', 'orders.work'),
  ('manager', 'tire_hotel.view'), ('manager', 'tire_hotel.manage'),
  ('manager', 'inventory.view'), ('manager', 'inventory.manage'),
  ('manager', 'employees.view'), ('manager', 'finance.manage'),
  ('mechanic', 'calendar.view'), ('mechanic', 'customers.view'),
  ('mechanic', 'orders.view_assigned'), ('mechanic', 'orders.work'),
  ('mechanic', 'tire_hotel.view'), ('mechanic', 'inventory.view'),
  ('accountant', 'finance.view'), ('accountant', 'finance.manage'),
  ('accountant', 'finance.export'), ('accountant', 'analytics.view'),
  ('accountant', 'orders.view_all'), ('accountant', 'customers.view');

-- ─────────────────────────────────────────── authorization helpers
-- SECURITY DEFINER so RLS policies can call them without recursive RLS on memberships.
create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

create or replace function public.is_member(p_business uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    join public.businesses b on b.id = m.business_id
    where m.business_id = p_business and m.user_id = auth.uid()
      and m.is_active and b.is_active and b.deleted_at is null
  );
$$;

create or replace function public.has_perm(p_business uuid, p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    join public.businesses b on b.id = m.business_id
    where m.business_id = p_business and m.user_id = auth.uid()
      and m.is_active and b.is_active and b.deleted_at is null
      and not (p_perm = any (m.revoked_permissions))
      and (
        p_perm = any (m.granted_permissions)
        or exists (select 1 from public.role_permissions rp
                   where rp.role = m.role and rp.permission = p_perm)
      )
  );
$$;

create or replace function public.module_enabled(p_business uuid, p_module public.module_key) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select enabled from public.business_modules where business_id = p_business and module = p_module),
    false);
$$;

-- Raises unless the caller holds the permission. Used at the top of every RPC.
create or replace function private.require_perm(p_business uuid, p_perm text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.has_perm(p_business, p_perm) then
    raise exception 'forbidden: %', p_perm using errcode = '42501';
  end if;
end $$;

-- Permissions of the current user in one business, for the UI.
create or replace function public.my_permissions(p_business uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct p order by p), '{}') from (
    select rp.permission as p
    from public.memberships m
    join public.role_permissions rp on rp.role = m.role
    where m.business_id = p_business and m.user_id = auth.uid() and m.is_active
    union
    select unnest(m.granted_permissions)
    from public.memberships m
    where m.business_id = p_business and m.user_id = auth.uid() and m.is_active
  ) s
  where p <> all (coalesce((select revoked_permissions from public.memberships
                            where business_id = p_business and user_id = auth.uid()), '{}'));
$$;

-- ─────────────────────────────────────────── audit log
create table public.audit_logs (
  id bigint generated always as identity primary key,
  business_id uuid references public.businesses (id) on delete cascade,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  diff jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_business_idx on public.audit_logs (business_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity, entity_id);

-- Generic row audit: stores changed columns only. Attach to important tables.
create or replace function private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_diff jsonb;
  v_row jsonb := coalesce(v_new, v_old);
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(key, jsonb_build_object('from', v_old -> key, 'to', value))
      into v_diff
      from jsonb_each(v_new)
      where v_old -> key is distinct from value and key not in ('updated_at');
    if v_diff is null then return new; end if;
  else
    v_diff := v_row;
  end if;
  insert into public.audit_logs (business_id, actor_id, action, entity, entity_id, diff)
  values (
    case when tg_table_name = 'businesses' then (v_row ->> 'id')::uuid
         else (v_row ->> 'business_id')::uuid end,
    auth.uid(), lower(tg_op), tg_table_name, (v_row ->> 'id')::uuid, v_diff);
  return coalesce(new, old);
end $$;

create trigger businesses_audit after insert or update or delete on public.businesses
  for each row execute function private.audit_row();
create trigger memberships_audit after insert or update or delete on public.memberships
  for each row execute function private.audit_row();
create trigger business_settings_audit after update on public.business_settings
  for each row execute function private.audit_row();

-- Explicit audit entry from RPCs.
create or replace function private.audit(p_business uuid, p_action text, p_entity text, p_id uuid, p_data jsonb default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (business_id, actor_id, action, entity, entity_id, diff)
  values (p_business, auth.uid(), p_action, p_entity, p_id, p_data);
$$;

-- ─────────────────────────────────────────── idempotency
create table public.idempotency_keys (
  business_id uuid not null references public.businesses (id) on delete cascade,
  key text not null check (length(key) between 8 and 128),
  operation text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (business_id, operation, key)
);

-- ─────────────────────────────────────────── restricted, logged support access
-- A super admin never reads tenant data through RLS. When support needs it the owner
-- grants a time-boxed window; every grant is audited.
create table public.support_access_grants (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  admin_user_id uuid not null references auth.users (id) on delete cascade,
  granted_by uuid not null references auth.users (id),
  reason text not null check (length(reason) between 5 and 500),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (expires_at > created_at and expires_at <= created_at + interval '72 hours')
);
create trigger support_access_audit after insert or update or delete on public.support_access_grants
  for each row execute function private.audit_row();

-- ─────────────────────────────────────────── new auth user → profile
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, locale)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when new.raw_user_meta_data ->> 'locale' in ('cs', 'pl', 'uk', 'sk', 'de', 'en', 'ru')
         then (new.raw_user_meta_data ->> 'locale')::public.app_locale else 'en' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();
