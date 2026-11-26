-- TireFlow · Staff, workstations, services, pricing & duration rules

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  branch_id uuid,
  membership_id uuid,
  first_name text not null check (length(first_name) between 1 and 100),
  last_name text not null default '',
  phone text,
  email extensions.citext,
  position text,
  skills text[] not null default '{}',
  color text not null default '#64748b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  commission_bp int not null default 0 check (commission_bp between 0 and 10000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (business_id, id),
  unique (business_id, membership_id),
  foreign key (business_id, branch_id) references public.branches (business_id, id) on delete set null (branch_id),
  foreign key (business_id, membership_id) references public.memberships (business_id, id) on delete set null (membership_id)
);
create trigger employees_touch before update on public.employees
  for each row execute function private.touch_updated_at();

-- Recurring weekly shift. weekday: ISO 1 = Monday … 7 = Sunday.
create table public.employee_schedules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  weekday int not null check (weekday between 1 and 7),
  starts time not null,
  ends time not null,
  valid_from date not null default '2000-01-01',
  valid_to date,
  check (ends > starts),
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade
);

create table public.employee_absences (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  kind text not null check (kind in ('vacation', 'sick', 'day_off', 'training', 'other')),
  during tstzrange not null check (not isempty(during)),
  note text,
  created_at timestamptz not null default now(),
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade,
  exclude using gist (employee_id with =, during with &&)
);

create table public.workstations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  branch_id uuid not null,
  name text not null check (length(name) between 1 and 60),
  kind text not null default 'general' check (kind in ('general', 'truck', 'express', 'alignment', 'repair')),
  equipment text[] not null default '{}',
  max_vehicle_category_codes text[] not null default '{}', -- empty = all
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (business_id, id),
  foreign key (business_id, branch_id) references public.branches (business_id, id) on delete cascade
);

-- Optional override of branch hours per workstation and season
create table public.workstation_schedules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  workstation_id uuid not null,
  weekday int not null check (weekday between 1 and 7),
  starts time not null,
  ends time not null,
  valid_from date not null default '2000-01-01',
  valid_to date,
  check (ends > starts),
  foreign key (business_id, workstation_id) references public.workstations (business_id, id) on delete cascade
);

-- Holidays and whole-branch closures
create table public.branch_closures (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  branch_id uuid not null,
  day date not null,
  reason text,
  unique (branch_id, day),
  foreign key (business_id, branch_id) references public.branches (business_id, id) on delete cascade
);

-- ─────────────────────────────────────────── services
create table public.service_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  code text,
  sort_order int not null default 0,
  unique (business_id, id)
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  category_id uuid,
  name text not null check (length(name) between 1 and 120),
  description text,
  -- 'job' = once per order, 'wheel' = multiplied by wheel count
  unit text not null default 'job' check (unit in ('job', 'wheel', 'piece', 'hour')),
  base_price bigint not null check (base_price >= 0), -- minor units in business currency
  base_duration_min int not null check (base_duration_min between 0 and 600),
  tax_rate_bp int check (tax_rate_bp between 0 and 10000), -- null = business default
  required_equipment text[] not null default '{}',
  required_skills text[] not null default '{}',
  online_bookable boolean not null default true,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (business_id, id),
  foreign key (business_id, category_id) references public.service_categories (business_id, id) on delete set null (category_id)
);
create trigger services_touch before update on public.services
  for each row execute function private.touch_updated_at();
create trigger services_audit after update on public.services
  for each row execute function private.audit_row();

-- empty set = compatible with every workstation
create table public.service_workstations (
  business_id uuid not null,
  service_id uuid not null,
  workstation_id uuid not null,
  primary key (service_id, workstation_id),
  foreign key (business_id, service_id) references public.services (business_id, id) on delete cascade,
  foreign key (business_id, workstation_id) references public.workstations (business_id, id) on delete cascade
);

-- Visual rules: when every non-null condition matches, the adjustment applies.
-- Rules are applied in ascending priority. 'set' replaces, 'add' adds, 'percent' scales (bp).
create table public.pricing_rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  service_id uuid, -- null = applies to every service
  name text not null,
  priority int not null default 100,
  vehicle_category_id uuid,
  rim_min int check (rim_min between 10 and 26),
  rim_max int check (rim_max between 10 and 26),
  runflat boolean,
  tpms boolean,
  rim_type text check (rim_type in ('steel', 'alloy', 'any')),
  wheel_count_min int check (wheel_count_min between 1 and 10),
  adjustment text not null check (adjustment in ('set', 'add', 'percent')),
  amount bigint not null, -- minor units, or basis points for percent
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (rim_min is null or rim_max is null or rim_min <= rim_max),
  check (adjustment <> 'set' or amount >= 0),
  unique (business_id, id),
  foreign key (business_id, service_id) references public.services (business_id, id) on delete cascade,
  foreign key (business_id, vehicle_category_id) references public.vehicle_categories (business_id, id) on delete cascade
);
create index pricing_rules_service_idx on public.pricing_rules (business_id, service_id);
create trigger pricing_rules_audit after insert or update or delete on public.pricing_rules
  for each row execute function private.audit_row();

create table public.duration_rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  service_id uuid,
  name text not null,
  priority int not null default 100,
  vehicle_category_id uuid,
  rim_min int, rim_max int,
  runflat boolean, tpms boolean,
  rim_type text check (rim_type in ('steel', 'alloy', 'any')),
  wheel_count_min int,
  adjustment text not null check (adjustment in ('set', 'add', 'percent')),
  amount int not null, -- minutes, or basis points for percent
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, service_id) references public.services (business_id, id) on delete cascade,
  foreign key (business_id, vehicle_category_id) references public.vehicle_categories (business_id, id) on delete cascade
);

-- ─────────────────────────────────────────── quote engine
-- p_params: {"vehicle_category_id": uuid, "rim": 17, "runflat": bool, "tpms": bool,
--            "rim_type": "alloy", "wheel_count": 4}
-- Returns the price per unit, quantity, line total and duration for one service.
create or replace function public.quote_service(p_business uuid, p_service uuid, p_params jsonb)
returns table (service_id uuid, unit_price bigint, quantity numeric, line_total bigint, duration_min int, tax_rate_bp int)
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.services%rowtype;
  r record;
  v_price numeric;
  v_dur numeric;
  v_cat uuid := nullif(p_params ->> 'vehicle_category_id', '')::uuid;
  v_rim int := nullif(p_params ->> 'rim', '')::int;
  v_runflat boolean := coalesce((p_params ->> 'runflat')::boolean, false);
  v_tpms boolean := coalesce((p_params ->> 'tpms')::boolean, false);
  v_rim_type text := coalesce(p_params ->> 'rim_type', 'any');
  v_wheels int := greatest(1, least(10, coalesce((p_params ->> 'wheel_count')::int, 4)));
  v_qty numeric;
  v_tax int;
begin
  -- callable by members, and by the public booking RPCs (which run as definer themselves)
  -- public booking RPCs set tireflow.public_context for their own transaction
  if auth.role() = 'authenticated' and not public.is_member(p_business)
     and coalesce(current_setting('tireflow.public_context', true), '') <> 'on' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into s from public.services x
   where x.id = p_service and x.business_id = p_business and x.deleted_at is null and x.is_active;
  if not found then
    raise exception 'service_not_found' using errcode = 'P0002';
  end if;

  v_price := s.base_price;
  v_dur := s.base_duration_min;

  for r in
    select * from public.pricing_rules pr
     where pr.business_id = p_business and pr.is_active
       and (pr.service_id is null or pr.service_id = s.id)
       and (pr.vehicle_category_id is null or pr.vehicle_category_id = v_cat)
       and (pr.rim_min is null or v_rim >= pr.rim_min)
       and (pr.rim_max is null or v_rim <= pr.rim_max)
       and (pr.runflat is null or pr.runflat = v_runflat)
       and (pr.tpms is null or pr.tpms = v_tpms)
       and (pr.rim_type is null or pr.rim_type = 'any' or pr.rim_type = v_rim_type)
       and (pr.wheel_count_min is null or v_wheels >= pr.wheel_count_min)
     order by pr.priority, pr.created_at
  loop
    v_price := case r.adjustment
      when 'set' then r.amount
      when 'add' then v_price + r.amount
      else v_price * (10000 + r.amount) / 10000.0 end;
  end loop;

  for r in
    select * from public.duration_rules dr
     where dr.business_id = p_business and dr.is_active
       and (dr.service_id is null or dr.service_id = s.id)
       and (dr.vehicle_category_id is null or dr.vehicle_category_id = v_cat)
       and (dr.rim_min is null or v_rim >= dr.rim_min)
       and (dr.rim_max is null or v_rim <= dr.rim_max)
       and (dr.runflat is null or dr.runflat = v_runflat)
       and (dr.tpms is null or dr.tpms = v_tpms)
       and (dr.rim_type is null or dr.rim_type = 'any' or dr.rim_type = v_rim_type)
       and (dr.wheel_count_min is null or v_wheels >= dr.wheel_count_min)
     order by dr.priority, dr.created_at
  loop
    v_dur := case r.adjustment
      when 'set' then r.amount
      when 'add' then v_dur + r.amount
      else v_dur * (10000 + r.amount) / 10000.0 end;
  end loop;

  v_qty := case s.unit when 'wheel' then v_wheels else 1 end;
  select coalesce(s.tax_rate_bp, bs.default_tax_rate_bp) into v_tax
    from public.business_settings bs where bs.business_id = p_business;

  service_id := s.id;
  unit_price := greatest(0, round(v_price))::bigint; -- half away from zero, minor units
  quantity := v_qty;
  line_total := (unit_price * v_qty)::bigint;
  -- duration rules are per job; per-wheel services scale time by wheels / 4
  duration_min := greatest(0, ceil(case s.unit when 'wheel' then v_dur * v_wheels / 4.0 else v_dur end))::int;
  tax_rate_bp := coalesce(v_tax, 0);
  return next;
end $$;

-- Quote for a basket of services: totals and total duration.
create or replace function public.quote_services(p_business uuid, p_services uuid[], p_params jsonb)
returns jsonb language sql stable security definer set search_path = '' as $$
  with lines as (
    select q.* from unnest(p_services) sid
    cross join lateral public.quote_service(p_business, sid, p_params) q
  )
  select jsonb_build_object(
    'lines', coalesce(jsonb_agg(to_jsonb(lines)), '[]'::jsonb),
    'total', coalesce(sum(line_total), 0),
    'duration_min', coalesce(sum(duration_min), 0)
  ) from lines;
$$;
