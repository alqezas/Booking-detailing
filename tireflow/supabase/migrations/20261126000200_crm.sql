-- TireFlow · Customers, vehicles, corporate fleets, tags, consents

create table public.corporate_customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(name) between 1 and 200),
  tax_id text,
  contact_name text,
  contact_phone text,
  contact_email text,
  billing_address text,
  discount_bp int not null default 0 check (discount_bp between 0 and 10000),
  payment_terms_days int not null default 0 check (payment_terms_days between 0 and 180),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (business_id, id)
);
create trigger corporate_touch before update on public.corporate_customers
  for each row execute function private.touch_updated_at();

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  corporate_customer_id uuid,
  first_name text not null default '' check (length(first_name) <= 100),
  last_name text not null default '' check (length(last_name) <= 100),
  phone text check (phone is null or phone ~ '^\+?[0-9 ()-]{6,20}$'),
  -- digits only, for search and duplicate detection
  phone_normalized text generated always as (nullif(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), '')) stored,
  email extensions.citext check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  preferred_channel text not null default 'sms'
    check (preferred_channel in ('sms', 'email', 'whatsapp', 'telegram', 'phone', 'none')),
  locale public.app_locale not null default 'en',
  discount_bp int not null default 0 check (discount_bp between 0 and 10000),
  notes text,
  source text not null default 'manual' check (source in ('manual', 'online', 'import', 'walk_in', 'phone')),
  is_vip boolean not null default false,
  -- denormalised counters kept by triggers for fast segmentation
  visits_count int not null default 0,
  total_spent bigint not null default 0,
  last_visit_at timestamptz,
  merged_into uuid,
  anonymized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (business_id, id),
  foreign key (business_id, corporate_customer_id)
    references public.corporate_customers (business_id, id) on delete set null (corporate_customer_id),
  foreign key (business_id, merged_into)
    references public.customers (business_id, id) on delete set null (merged_into),
  check (first_name <> '' or last_name <> '' or phone is not null or corporate_customer_id is not null or anonymized_at is not null)
);
create index customers_business_idx on public.customers (business_id, created_at desc) where deleted_at is null;
create index customers_phone_idx on public.customers (business_id, phone_normalized);
create index customers_name_trgm on public.customers
  using gin ((first_name || ' ' || last_name) extensions.gin_trgm_ops);
create trigger customers_touch before update on public.customers
  for each row execute function private.touch_updated_at();
create trigger customers_audit after update or delete on public.customers
  for each row execute function private.audit_row();

create table public.customer_consents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  customer_id uuid not null,
  kind text not null check (kind in ('data_processing', 'marketing_email', 'marketing_sms', 'marketing_messenger')),
  granted boolean not null,
  source text not null default 'staff' check (source in ('staff', 'online_booking', 'import', 'unsubscribe_link')),
  recorded_by uuid references auth.users (id),
  recorded_at timestamptz not null default now(),
  foreign key (business_id, customer_id) references public.customers (business_id, id) on delete cascade
);
create index customer_consents_idx on public.customer_consents (business_id, customer_id, kind, recorded_at desc);

-- current consent = latest record per kind
create view public.customer_consent_state with (security_invoker = true) as
select distinct on (business_id, customer_id, kind)
  business_id, customer_id, kind, granted, recorded_at
from public.customer_consents
order by business_id, customer_id, kind, recorded_at desc;

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(name) between 1 and 40),
  color text not null default 'gray',
  unique (business_id, name),
  unique (business_id, id)
);

create table public.customer_tags (
  business_id uuid not null,
  customer_id uuid not null,
  tag_id uuid not null,
  primary key (customer_id, tag_id),
  foreign key (business_id, customer_id) references public.customers (business_id, id) on delete cascade,
  foreign key (business_id, tag_id) references public.tags (business_id, id) on delete cascade
);

create table public.vehicle_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  code text not null check (code ~ '^[a-z_]{2,30}$'),
  name text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  unique (business_id, code),
  unique (business_id, id)
);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  customer_id uuid,
  corporate_customer_id uuid,
  category_id uuid,
  make text not null check (length(make) between 1 and 60),
  model text not null default '' check (length(model) <= 80),
  year int check (year between 1950 and 2100),
  plate text check (plate is null or length(plate) between 2 and 16),
  -- uppercase without spaces/dashes for search
  plate_normalized text generated always as (nullif(upper(regexp_replace(coalesce(plate, ''), '[^A-Za-z0-9]', '', 'g')), '')) stored,
  vin text check (vin is null or vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  body_type text,
  rim_diameter int check (rim_diameter between 10 and 26),
  tire_size text,
  mileage_km int check (mileage_km >= 0),
  has_tpms boolean not null default false,
  has_runflat boolean not null default false,
  service_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (business_id, id),
  foreign key (business_id, customer_id) references public.customers (business_id, id) on delete set null (customer_id),
  foreign key (business_id, corporate_customer_id) references public.corporate_customers (business_id, id) on delete set null (corporate_customer_id),
  foreign key (business_id, category_id) references public.vehicle_categories (business_id, id) on delete set null (category_id)
);
create unique index vehicles_plate_uq on public.vehicles (business_id, plate_normalized)
  where deleted_at is null and plate_normalized is not null;
create index vehicles_customer_idx on public.vehicles (business_id, customer_id);
create trigger vehicles_touch before update on public.vehicles
  for each row execute function private.touch_updated_at();

-- ─────────────────────────────────────────── search across customers by name / phone / plate
create or replace function public.search_customers(p_business uuid, p_query text, p_limit int default 20)
returns table (id uuid, first_name text, last_name text, phone text, email text, plates text[], last_visit_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  with q as (
    select trim(p_query) as raw,
           nullif(regexp_replace(p_query, '[^0-9]', '', 'g'), '') as digits,
           nullif(upper(regexp_replace(p_query, '[^A-Za-z0-9]', '', 'g')), '') as plate
  )
  select c.id, c.first_name, c.last_name, c.phone, c.email::text,
         coalesce(array_agg(v.plate) filter (where v.plate is not null), '{}'),
         c.last_visit_at
  from public.customers c
  cross join q
  left join public.vehicles v on v.business_id = c.business_id and v.customer_id = c.id and v.deleted_at is null
  where c.business_id = p_business and c.deleted_at is null and c.merged_into is null
    and (
      (c.first_name || ' ' || c.last_name) ilike '%' || q.raw || '%'
      or (q.digits is not null and length(q.digits) >= 3 and c.phone_normalized like '%' || q.digits || '%')
      or (q.plate is not null and exists (
            select 1 from public.vehicles v2
            where v2.business_id = c.business_id and v2.customer_id = c.id
              and v2.plate_normalized like '%' || q.plate || '%'))
      or c.email::text ilike '%' || q.raw || '%'
    )
  group by c.id
  order by c.last_visit_at desc nulls last
  limit least(greatest(p_limit, 1), 100);
$$;
