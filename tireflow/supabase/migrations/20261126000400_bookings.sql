-- TireFlow · Calendar: bookings, resource occupancy (no double booking), waiting list

create type public.booking_status as enum
  ('pending', 'confirmed', 'arrived', 'in_progress', 'completed', 'cancelled', 'no_show');

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  branch_id uuid not null,
  customer_id uuid,
  vehicle_id uuid,
  workstation_id uuid not null,
  employee_id uuid,
  status public.booking_status not null default 'confirmed',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  during tstzrange generated always as (tstzrange(starts_at, ends_at, '[)')) stored,
  source text not null default 'staff' check (source in ('staff', 'online', 'walk_in', 'phone', 'waitlist', 'corporate')),
  -- snapshot of what was asked for, so the price shown at booking never changes silently
  vehicle_params jsonb not null default '{}'::jsonb,
  quoted_total bigint not null default 0 check (quoted_total >= 0),
  -- public visitors (no account) see a plate and name typed at booking time
  contact_name text,
  contact_phone text,
  contact_email text,
  plate_text text,
  customer_note text,
  internal_note text,
  manage_token_hash bytea unique,
  cancelled_reason text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at and ends_at <= starts_at + interval '12 hours'),
  unique (business_id, id),
  foreign key (business_id, branch_id) references public.branches (business_id, id),
  foreign key (business_id, customer_id) references public.customers (business_id, id) on delete set null (customer_id),
  foreign key (business_id, vehicle_id) references public.vehicles (business_id, id) on delete set null (vehicle_id),
  foreign key (business_id, workstation_id) references public.workstations (business_id, id),
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete set null (employee_id)
);
create index bookings_range_idx on public.bookings using gist (business_id, branch_id, during);
create index bookings_customer_idx on public.bookings (business_id, customer_id, starts_at desc);
create index bookings_starts_idx on public.bookings (business_id, starts_at);
create trigger bookings_touch before update on public.bookings
  for each row execute function private.touch_updated_at();
create trigger bookings_audit after insert or update on public.bookings
  for each row execute function private.audit_row();

create table public.booking_services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  booking_id uuid not null,
  service_id uuid not null,
  quantity numeric(10, 2) not null default 1 check (quantity > 0),
  unit_price bigint not null check (unit_price >= 0),
  duration_min int not null check (duration_min >= 0),
  foreign key (business_id, booking_id) references public.bookings (business_id, id) on delete cascade,
  foreign key (business_id, service_id) references public.services (business_id, id)
);
create index booking_services_booking_idx on public.booking_services (booking_id);

-- One row per resource per busy interval. The exclusion constraint is the
-- single source of truth against double booking of a post or a mechanic,
-- including races between two concurrent transactions.
create table public.resource_occupancies (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  branch_id uuid not null,
  resource_kind text not null check (resource_kind in ('workstation', 'employee')),
  resource_id uuid not null,
  during tstzrange not null check (not isempty(during)),
  booking_id uuid,
  block_reason text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  check ((booking_id is null) <> (block_reason is null)),
  foreign key (business_id, booking_id) references public.bookings (business_id, id) on delete cascade,
  foreign key (business_id, branch_id) references public.branches (business_id, id) on delete cascade,
  constraint no_double_booking exclude using gist (
    resource_kind with =, resource_id with =, during with &&
  )
);
create index resource_occupancies_lookup on public.resource_occupancies using gist (business_id, branch_id, during);
create index resource_occupancies_booking on public.resource_occupancies (booking_id);

-- Keep occupancies in lock-step with the booking inside the same transaction.
create or replace function private.sync_booking_occupancy() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
     and old.during = new.during and old.workstation_id = new.workstation_id
     and old.employee_id is not distinct from new.employee_id
     and (old.status in ('cancelled', 'no_show')) = (new.status in ('cancelled', 'no_show')) then
    return new;
  end if;

  delete from public.resource_occupancies where booking_id = new.id;
  if new.status not in ('cancelled', 'no_show') then
    insert into public.resource_occupancies (business_id, branch_id, resource_kind, resource_id, during, booking_id)
    values (new.business_id, new.branch_id, 'workstation', new.workstation_id, new.during, new.id);
    if new.employee_id is not null then
      insert into public.resource_occupancies (business_id, branch_id, resource_kind, resource_id, during, booking_id)
      values (new.business_id, new.branch_id, 'employee', new.employee_id, new.during, new.id);
    end if;
  end if;
  return new;
end $$;

create trigger bookings_occupancy after insert or update on public.bookings
  for each row execute function private.sync_booking_occupancy();

create table public.waiting_list (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  branch_id uuid not null,
  customer_id uuid,
  contact_name text,
  contact_phone text,
  service_ids uuid[] not null default '{}',
  vehicle_params jsonb not null default '{}'::jsonb,
  earliest date not null,
  latest date not null,
  status text not null default 'waiting' check (status in ('waiting', 'offered', 'booked', 'expired', 'removed')),
  offered_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  check (latest >= earliest),
  check (customer_id is not null or contact_phone is not null),
  unique (business_id, id),
  foreign key (business_id, branch_id) references public.branches (business_id, id) on delete cascade,
  foreign key (business_id, customer_id) references public.customers (business_id, id) on delete cascade
);
create index waiting_list_open_idx on public.waiting_list (business_id, branch_id, earliest) where status = 'waiting';

-- ─────────────────────────────────────────── opening hours helpers
-- Intervals (in business tz) during which a workstation can take work on a given day.
create or replace function private.workstation_windows(p_workstation uuid, p_day date)
returns table (starts timestamptz, ends timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  w public.workstations%rowtype;
  v_tz text;
  v_dow int := extract(isodow from p_day)::int;
  v_hours jsonb;
  v_has_override boolean;
begin
  select * into w from public.workstations where id = p_workstation and is_active and deleted_at is null;
  if not found then return; end if;
  select bs.timezone into v_tz from public.business_settings bs where bs.business_id = w.business_id;
  if exists (select 1 from public.branch_closures c where c.branch_id = w.branch_id and c.day = p_day) then
    return;
  end if;

  select exists (
    select 1 from public.workstation_schedules s
     where s.workstation_id = w.id and s.weekday = v_dow
       and p_day between s.valid_from and coalesce(s.valid_to, 'infinity'::date)
  ) into v_has_override;

  if v_has_override then
    return query
      select (p_day + s.starts) at time zone v_tz, (p_day + s.ends) at time zone v_tz
        from public.workstation_schedules s
       where s.workstation_id = w.id and s.weekday = v_dow
         and p_day between s.valid_from and coalesce(s.valid_to, 'infinity'::date)
       order by s.starts;
  else
    select b.opening_hours -> v_dow::text into v_hours from public.branches b where b.id = w.branch_id;
    return query
      select (p_day + (iv ->> 0)::time) at time zone v_tz, (p_day + (iv ->> 1)::time) at time zone v_tz
        from jsonb_array_elements(coalesce(v_hours, '[]'::jsonb)) iv
       where (iv ->> 1)::time > (iv ->> 0)::time;
  end if;
end $$;

-- Is [p_start, p_end) entirely inside the opening windows of the workstation?
create or replace function private.within_hours(p_workstation uuid, p_start timestamptz, p_end timestamptz, p_tz text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.workstation_windows(p_workstation, (p_start at time zone p_tz)::date) w
     where p_start >= w.starts and p_end <= w.ends
  );
$$;

-- Workstations able to perform all requested services for that vehicle category.
create or replace function private.compatible_workstations(p_business uuid, p_branch uuid, p_services uuid[], p_category uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select w.id from public.workstations w
   where w.business_id = p_business and w.branch_id = p_branch and w.is_active and w.deleted_at is null
     and (cardinality(w.max_vehicle_category_codes) = 0 or p_category is null or exists (
           select 1 from public.vehicle_categories vc
            where vc.id = p_category and vc.code = any (w.max_vehicle_category_codes)))
     and not exists (
       select 1 from public.services s
        where s.id = any (p_services)
          and (
            not (s.required_equipment <@ w.equipment)
            or (exists (select 1 from public.service_workstations sw where sw.service_id = s.id)
                and not exists (select 1 from public.service_workstations sw
                                 where sw.service_id = s.id and sw.workstation_id = w.id))
          ))
   order by w.sort_order, w.name;
$$;

-- Free start times for one day. Used by the public page and the staff "find slot" button.
create or replace function private.available_slots(
  p_business uuid, p_branch uuid, p_day date, p_duration_min int, p_services uuid[], p_category uuid
) returns table (starts_at timestamptz, workstation_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  st public.business_settings%rowtype;
  v_ws uuid;
  win record;
  t timestamptz;
  v_earliest timestamptz;
begin
  select * into st from public.business_settings where business_id = p_business;
  v_earliest := now() + make_interval(mins => st.booking_lead_minutes);
  if p_duration_min <= 0 then p_duration_min := st.slot_step_minutes; end if;

  for v_ws in select * from private.compatible_workstations(p_business, p_branch, p_services, p_category) loop
    for win in select * from private.workstation_windows(v_ws, p_day) loop
      t := win.starts;
      while t + make_interval(mins => p_duration_min) <= win.ends loop
        if t >= v_earliest and not exists (
          select 1 from public.resource_occupancies o
           where o.resource_kind = 'workstation' and o.resource_id = v_ws
             and o.during && tstzrange(t, t + make_interval(mins => p_duration_min), '[)')
        ) then
          starts_at := t; workstation_id := v_ws; return next;
        end if;
        t := t + make_interval(mins => st.slot_step_minutes);
      end loop;
    end loop;
  end loop;
end $$;

-- Staff variant with permission check
create or replace function public.find_slots(
  p_business uuid, p_branch uuid, p_day date, p_services uuid[], p_params jsonb default '{}'::jsonb
) returns table (starts_at timestamptz, workstation_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare v_dur int;
begin
  perform private.require_perm(p_business, 'calendar.view');
  v_dur := (public.quote_services(p_business, p_services, p_params) ->> 'duration_min')::int;
  return query select * from private.available_slots(
    p_business, p_branch, p_day, v_dur, p_services, nullif(p_params ->> 'vehicle_category_id', '')::uuid);
end $$;

-- ─────────────────────────────────────────── booking RPCs (atomic)
-- Core insert, shared by staff and public flows. Caller has already authorized.
create or replace function private.insert_booking(p_business uuid, p jsonb, p_source text, p_actor uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  st public.business_settings%rowtype;
  v_services uuid[] := coalesce(array(select jsonb_array_elements_text(p -> 'service_ids')::uuid), '{}');
  v_params jsonb := coalesce(p -> 'vehicle_params', '{}'::jsonb);
  v_quote jsonb;
  v_start timestamptz := (p ->> 'starts_at')::timestamptz;
  v_dur int;
  v_ws uuid := nullif(p ->> 'workstation_id', '')::uuid;
  v_emp uuid := nullif(p ->> 'employee_id', '')::uuid;
  v_branch uuid := (p ->> 'branch_id')::uuid;
  v_id uuid;
  v_line jsonb;
  v_status public.booking_status;
begin
  select * into st from public.business_settings where business_id = p_business;
  if cardinality(v_services) = 0 then
    raise exception 'no_services' using errcode = '22023';
  end if;
  if v_start is null then
    raise exception 'starts_at_required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.branches b where b.id = v_branch and b.business_id = p_business and b.is_active) then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;

  v_quote := public.quote_services(p_business, v_services, v_params);
  v_dur := coalesce(nullif(p ->> 'duration_min', '')::int, (v_quote ->> 'duration_min')::int);
  if v_dur < st.slot_step_minutes then v_dur := st.slot_step_minutes; end if;

  if v_ws is null then
    -- pick the first compatible free post
    select w into v_ws from private.compatible_workstations(
        p_business, v_branch, v_services, nullif(v_params ->> 'vehicle_category_id', '')::uuid) w
     where not exists (select 1 from public.resource_occupancies o
                        where o.resource_kind = 'workstation' and o.resource_id = w
                          and o.during && tstzrange(v_start, v_start + make_interval(mins => v_dur), '[)'))
       and (p_source = 'staff' or private.within_hours(w, v_start, v_start + make_interval(mins => v_dur), st.timezone))
     limit 1;
    if v_ws is null then
      raise exception 'slot_taken' using errcode = '23P01';
    end if;
  elsif not exists (select 1 from private.compatible_workstations(
        p_business, v_branch, v_services, nullif(v_params ->> 'vehicle_category_id', '')::uuid) w where w = v_ws) then
    raise exception 'workstation_incompatible' using errcode = '22023';
  end if;

  if p_source = 'online'
     and not private.within_hours(v_ws, v_start, v_start + make_interval(mins => v_dur), st.timezone) then
    raise exception 'outside_hours' using errcode = '22023';
  end if;

  if v_emp is not null and exists (
      select 1 from public.employee_absences a
       where a.employee_id = v_emp and a.during && tstzrange(v_start, v_start + make_interval(mins => v_dur), '[)')) then
    raise exception 'employee_absent' using errcode = '22023';
  end if;

  v_status := case
    when p ? 'status' then (p ->> 'status')::public.booking_status
    when p_source = 'online' and st.booking_requires_confirmation then 'pending'
    when p_source = 'walk_in' then 'arrived'
    else 'confirmed' end;

  insert into public.bookings (
    business_id, branch_id, customer_id, vehicle_id, workstation_id, employee_id, status,
    starts_at, ends_at, source, vehicle_params, quoted_total,
    contact_name, contact_phone, contact_email, plate_text, customer_note, internal_note, created_by)
  values (
    p_business, v_branch, nullif(p ->> 'customer_id', '')::uuid, nullif(p ->> 'vehicle_id', '')::uuid,
    v_ws, v_emp, v_status, v_start, v_start + make_interval(mins => v_dur), p_source, v_params,
    (v_quote ->> 'total')::bigint,
    p ->> 'contact_name', p ->> 'contact_phone', p ->> 'contact_email', upper(p ->> 'plate'),
    p ->> 'customer_note', p ->> 'internal_note', p_actor)
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(v_quote -> 'lines') loop
    insert into public.booking_services (business_id, booking_id, service_id, quantity, unit_price, duration_min)
    values (p_business, v_id, (v_line ->> 'service_id')::uuid, (v_line ->> 'quantity')::numeric,
            (v_line ->> 'unit_price')::bigint, (v_line ->> 'duration_min')::int);
  end loop;
  if v_status = 'confirmed' then
    perform private.enqueue_booking_event(p_business, v_id, 'booking_confirmed');
  end if;
  return v_id;
exception
  when exclusion_violation then
    raise exception 'slot_taken' using errcode = '23P01';
end $$;

create or replace function public.create_booking(p_business uuid, p jsonb, p_idempotency_key text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_existing jsonb;
  v_source text := coalesce(p ->> 'source', 'staff');
begin
  perform private.require_perm(p_business, 'calendar.manage');
  if v_source not in ('staff', 'walk_in', 'phone', 'waitlist', 'corporate') then
    raise exception 'invalid_source' using errcode = '22023';
  end if;
  if p_idempotency_key is not null then
    select result into v_existing from public.idempotency_keys
     where business_id = p_business and operation = 'create_booking' and key = p_idempotency_key;
    if found then return (v_existing ->> 'id')::uuid; end if;
  end if;

  if nullif(p ->> 'customer_id', '') is not null and not exists (
      select 1 from public.customers where id = (p ->> 'customer_id')::uuid and business_id = p_business) then
    raise exception 'customer_not_found' using errcode = 'P0002';
  end if;

  v_id := private.insert_booking(p_business, p, case when v_source = 'staff' then 'staff' else v_source end, auth.uid());

  if p_idempotency_key is not null then
    insert into public.idempotency_keys (business_id, key, operation, result)
    values (p_business, p_idempotency_key, 'create_booking', jsonb_build_object('id', v_id));
  end if;
  return v_id;
end $$;

create or replace function public.reschedule_booking(
  p_business uuid, p_booking uuid, p_starts_at timestamptz,
  p_workstation uuid default null, p_employee uuid default null, p_duration_min int default null,
  p_clear_employee boolean default false
) returns void language plpgsql security definer set search_path = '' as $$
declare b public.bookings%rowtype; v_dur int;
begin
  perform private.require_perm(p_business, 'calendar.manage');
  select * into b from public.bookings where id = p_booking and business_id = p_business for update;
  if not found then raise exception 'booking_not_found' using errcode = 'P0002'; end if;
  if b.status in ('completed', 'cancelled', 'no_show') then
    raise exception 'booking_closed' using errcode = '22023';
  end if;
  v_dur := coalesce(p_duration_min, (extract(epoch from b.ends_at - b.starts_at) / 60)::int);
  if v_dur < 5 or v_dur > 720 then raise exception 'invalid_duration' using errcode = '22023'; end if;
  if p_workstation is not null and not exists (
      select 1 from public.workstations w where w.id = p_workstation and w.business_id = p_business and w.branch_id = b.branch_id) then
    raise exception 'workstation_not_found' using errcode = 'P0002';
  end if;

  update public.bookings set
    starts_at = p_starts_at,
    ends_at = p_starts_at + make_interval(mins => v_dur),
    workstation_id = coalesce(p_workstation, workstation_id),
    employee_id = case when p_clear_employee then null else coalesce(p_employee, employee_id) end
  where id = p_booking;
  perform private.enqueue_booking_event(p_business, p_booking, 'booking_rescheduled');
exception
  when exclusion_violation then raise exception 'slot_taken' using errcode = '23P01';
end $$;

create or replace function public.set_booking_status(
  p_business uuid, p_booking uuid, p_status public.booking_status, p_reason text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare b public.bookings%rowtype;
begin
  if p_status in ('arrived', 'in_progress', 'completed') then
    if not (public.has_perm(p_business, 'calendar.manage') or public.has_perm(p_business, 'orders.work')) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  else
    perform private.require_perm(p_business, 'calendar.manage');
  end if;
  select * into b from public.bookings where id = p_booking and business_id = p_business for update;
  if not found then raise exception 'booking_not_found' using errcode = 'P0002'; end if;
  if b.status in ('cancelled', 'no_show', 'completed') and p_status <> b.status then
    raise exception 'booking_closed' using errcode = '22023';
  end if;
  update public.bookings set status = p_status,
    cancelled_reason = case when p_status = 'cancelled' then p_reason else cancelled_reason end
   where id = p_booking;
  if p_status = 'cancelled' then
    perform private.enqueue_booking_event(p_business, p_booking, 'booking_cancelled');
    perform private.offer_freed_slot(p_business, b.branch_id, (b.starts_at)::date);
  end if;
end $$;

create or replace function public.block_time(
  p_business uuid, p_branch uuid, p_kind text, p_resource uuid, p_from timestamptz, p_to timestamptz, p_reason text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.require_perm(p_business, 'calendar.manage');
  if p_kind = 'workstation' and not exists (select 1 from public.workstations where id = p_resource and business_id = p_business)
     or p_kind = 'employee' and not exists (select 1 from public.employees where id = p_resource and business_id = p_business) then
    raise exception 'resource_not_found' using errcode = 'P0002';
  end if;
  insert into public.resource_occupancies (business_id, branch_id, resource_kind, resource_id, during, block_reason, created_by)
  values (p_business, p_branch, p_kind, p_resource, tstzrange(p_from, p_to, '[)'), coalesce(nullif(trim(p_reason), ''), 'blocked'), auth.uid())
  returning id into v_id;
  return v_id;
exception
  when exclusion_violation then raise exception 'slot_taken' using errcode = '23P01';
end $$;
