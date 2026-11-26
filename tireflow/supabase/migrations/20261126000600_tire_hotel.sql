-- TireFlow · Tire hotel: storage locations, sets, contracts, movements

-- Branch → Warehouse(purpose=tire_hotel) → Zone → Rack → Shelf → Cell ("A-03-02-05")
create table public.storage_locations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  warehouse_id uuid not null,
  zone text not null check (zone ~ '^[A-Z0-9]{1,4}$'),
  rack int not null check (rack between 1 and 999),
  shelf int not null check (shelf between 1 and 99),
  cell int not null check (cell between 1 and 999),
  code text generated always as (zone || '-' || lpad(rack::text, 2, '0') || '-' || lpad(shelf::text, 2, '0') || '-' || lpad(cell::text, 2, '0')) stored,
  capacity_sets int not null default 1 check (capacity_sets between 1 and 20),
  occupied_sets int not null default 0,
  is_active boolean not null default true,
  unique (warehouse_id, zone, rack, shelf, cell),
  unique (business_id, id),
  -- never over capacity, enforced at the row itself
  check (occupied_sets between 0 and capacity_sets),
  foreign key (business_id, warehouse_id) references public.warehouses (business_id, id) on delete cascade
);
create index storage_locations_free_idx on public.storage_locations (business_id, warehouse_id) where occupied_sets < capacity_sets;

create table public.tire_sets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  -- short human code printed on the label and encoded in the QR
  code text not null,
  customer_id uuid not null,
  vehicle_id uuid,
  corporate_customer_id uuid,
  quantity int not null default 4 check (quantity between 1 and 10),
  manufacturer text,
  model text,
  season text not null check (season in ('summer', 'winter', 'all_season')),
  width int check (width between 125 and 395),
  profile int check (profile between 20 and 90),
  diameter int check (diameter between 10 and 26),
  load_index text,
  speed_index text,
  with_rims boolean not null default false,
  rim_type text check (rim_type in ('steel', 'alloy')),
  condition text not null default 'good' check (condition in ('new', 'good', 'fair', 'worn', 'unsafe')),
  notes text,
  status text not null default 'stored' check (status in ('stored', 'released', 'disposed')),
  location_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, code),
  unique (business_id, id),
  check (status <> 'stored' or location_id is not null),
  foreign key (business_id, customer_id) references public.customers (business_id, id),
  foreign key (business_id, vehicle_id) references public.vehicles (business_id, id) on delete set null (vehicle_id),
  foreign key (business_id, corporate_customer_id) references public.corporate_customers (business_id, id) on delete set null (corporate_customer_id),
  foreign key (business_id, location_id) references public.storage_locations (business_id, id)
);
create index tire_sets_customer_idx on public.tire_sets (business_id, customer_id);
create index tire_sets_status_idx on public.tire_sets (business_id, status);
create trigger tire_sets_touch before update on public.tire_sets
  for each row execute function private.touch_updated_at();

create table public.tire_set_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  tire_set_id uuid not null,
  position text not null check (position in ('FL', 'FR', 'RL', 'RR', 'SPARE', 'X1', 'X2')),
  dot text check (dot is null or dot ~ '^[0-9]{4}$'),
  tread_mm numeric(3, 1) check (tread_mm between 0 and 20),
  damage text,
  photo_paths text[] not null default '{}',
  unique (tire_set_id, position),
  foreign key (business_id, tire_set_id) references public.tire_sets (business_id, id) on delete cascade
);

create table public.tire_storage_contracts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  tire_set_id uuid not null,
  number text not null,
  starts_on date not null,
  ends_on date not null,
  price bigint not null check (price >= 0),
  currency public.currency_code not null,
  paid_total bigint not null default 0,
  status text not null default 'active' check (status in ('active', 'closed', 'extended', 'cancelled')),
  extended_from uuid,
  closed_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  check (ends_on > starts_on),
  unique (business_id, number),
  unique (business_id, id),
  foreign key (business_id, tire_set_id) references public.tire_sets (business_id, id) on delete cascade,
  foreign key (business_id, extended_from) references public.tire_storage_contracts (business_id, id)
);
create unique index tire_contracts_one_active on public.tire_storage_contracts (tire_set_id) where status = 'active';
create index tire_contracts_ending_idx on public.tire_storage_contracts (business_id, ends_on) where status = 'active';

alter table public.payments
  add foreign key (business_id, storage_contract_id) references public.tire_storage_contracts (business_id, id);

create table public.tire_storage_movements (
  id bigint generated always as identity primary key,
  business_id uuid not null,
  tire_set_id uuid not null,
  kind text not null check (kind in ('check_in', 'move', 'check_out', 'dispose')),
  from_location_id uuid,
  to_location_id uuid,
  note text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  foreign key (business_id, tire_set_id) references public.tire_sets (business_id, id) on delete cascade,
  foreign key (business_id, from_location_id) references public.storage_locations (business_id, id),
  foreign key (business_id, to_location_id) references public.storage_locations (business_id, id)
);
create trigger tire_storage_movements_immutable before update or delete on public.tire_storage_movements
  for each row execute function private.forbid_change();

-- Occupancy counters follow tire_sets.location_id / status. Row lock on the cell
-- plus the CHECK constraint makes over-filling impossible even under concurrency.
create or replace function private.sync_cell_occupancy() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_old uuid; v_new uuid;
begin
  v_old := case when tg_op = 'UPDATE' and old.status = 'stored' then old.location_id end;
  v_new := case when new.status = 'stored' then new.location_id end;
  if v_old is not distinct from v_new then return new; end if;
  if v_old is not null then
    update public.storage_locations set occupied_sets = occupied_sets - 1 where id = v_old;
  end if;
  if v_new is not null then
    update public.storage_locations set occupied_sets = occupied_sets + 1 where id = v_new and is_active;
    if not found then raise exception 'location_inactive' using errcode = '22023'; end if;
  end if;
  return new;
exception
  when check_violation then raise exception 'location_full' using errcode = '23514';
end $$;
create trigger tire_sets_occupancy after insert or update of location_id, status on public.tire_sets
  for each row execute function private.sync_cell_occupancy();

create or replace function private.next_tire_code(p_business uuid, p_prefix text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  loop
    v_code := p_prefix || '-' || upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 6));
    exit when not exists (select 1 from public.tire_sets where business_id = p_business and code = v_code)
          and not exists (select 1 from public.tire_storage_contracts where business_id = p_business and number = v_code);
  end loop;
  return v_code;
end $$;

-- Check-in in one transaction: set + per-tire condition + cell + contract (+ optional payment).
-- p: {customer_id, vehicle_id, quantity, manufacturer, model, season, width, profile, diameter,
--     load_index, speed_index, with_rims, rim_type, condition, notes,
--     items: [{position, dot, tread_mm, damage}], location_id | warehouse_id,
--     starts_on, ends_on, price, payment: {amount, method_id}}
create or replace function public.check_in_tire_set(p_business uuid, p jsonb, p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  st public.business_settings%rowtype;
  v_set uuid;
  v_loc uuid := nullif(p ->> 'location_id', '')::uuid;
  v_contract uuid;
  v_code text;
  v_item jsonb;
  v_existing jsonb;
  v_price bigint;
  v_result jsonb;
begin
  perform private.require_perm(p_business, 'tire_hotel.manage');
  if not public.module_enabled(p_business, 'tire_hotel') then
    raise exception 'module_disabled' using errcode = '42501';
  end if;
  if p_idempotency_key is not null then
    select result into v_existing from public.idempotency_keys
     where business_id = p_business and operation = 'check_in_tire_set' and key = p_idempotency_key;
    if found then return v_existing; end if;
  end if;
  select * into st from public.business_settings where business_id = p_business;

  if v_loc is null then
    -- first free cell in the chosen hotel warehouse
    select l.id into v_loc from public.storage_locations l
     where l.business_id = p_business and l.warehouse_id = (p ->> 'warehouse_id')::uuid
       and l.is_active and l.occupied_sets < l.capacity_sets
     order by l.zone, l.rack, l.shelf, l.cell
     limit 1 for update skip locked;
    if v_loc is null then raise exception 'warehouse_full' using errcode = '23514'; end if;
  elsif not exists (select 1 from public.storage_locations where id = v_loc and business_id = p_business) then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;

  v_code := private.next_tire_code(p_business, 'TS');
  insert into public.tire_sets (business_id, code, customer_id, vehicle_id, quantity, manufacturer, model, season,
      width, profile, diameter, load_index, speed_index, with_rims, rim_type, condition, notes, location_id)
  values (p_business, v_code, (p ->> 'customer_id')::uuid, nullif(p ->> 'vehicle_id', '')::uuid,
      coalesce((p ->> 'quantity')::int, 4), p ->> 'manufacturer', p ->> 'model', coalesce(p ->> 'season', 'winter'),
      nullif(p ->> 'width', '')::int, nullif(p ->> 'profile', '')::int, nullif(p ->> 'diameter', '')::int,
      p ->> 'load_index', p ->> 'speed_index', coalesce((p ->> 'with_rims')::boolean, false),
      nullif(p ->> 'rim_type', ''), coalesce(p ->> 'condition', 'good'), p ->> 'notes', v_loc)
  returning id into v_set;

  for v_item in select * from jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb)) loop
    insert into public.tire_set_items (business_id, tire_set_id, position, dot, tread_mm, damage)
    values (p_business, v_set, v_item ->> 'position', nullif(v_item ->> 'dot', ''),
            nullif(v_item ->> 'tread_mm', '')::numeric, nullif(v_item ->> 'damage', ''));
  end loop;

  insert into public.tire_storage_movements (business_id, tire_set_id, kind, to_location_id, created_by)
  values (p_business, v_set, 'check_in', v_loc, auth.uid());

  v_price := coalesce(nullif(p ->> 'price', '')::bigint, st.storage_price_per_season);
  insert into public.tire_storage_contracts (business_id, tire_set_id, number, starts_on, ends_on, price, currency, created_by)
  values (p_business, v_set, private.next_tire_code(p_business, 'SC'),
          coalesce((p ->> 'starts_on')::date, current_date),
          coalesce((p ->> 'ends_on')::date, current_date + 183),
          v_price, st.currency, auth.uid())
  returning id into v_contract;

  if (p -> 'payment' ->> 'amount') is not null and (p -> 'payment' ->> 'amount')::bigint > 0 then
    perform private.require_perm(p_business, 'finance.manage');
    insert into public.payments (business_id, storage_contract_id, customer_id, kind, amount, currency, method_id, received_by)
    values (p_business, v_contract, (p ->> 'customer_id')::uuid, 'payment', (p -> 'payment' ->> 'amount')::bigint,
            st.currency, (p -> 'payment' ->> 'method_id')::uuid, auth.uid());
    update public.tire_storage_contracts set paid_total = (p -> 'payment' ->> 'amount')::bigint where id = v_contract;
  end if;

  v_result := jsonb_build_object('tire_set_id', v_set, 'code', v_code, 'contract_id', v_contract,
    'location_code', (select code from public.storage_locations where id = v_loc));
  if p_idempotency_key is not null then
    insert into public.idempotency_keys (business_id, key, operation, result)
    values (p_business, p_idempotency_key, 'check_in_tire_set', v_result);
  end if;
  return v_result;
end $$;

create or replace function public.move_tire_set(p_business uuid, p_set uuid, p_location uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.tire_sets%rowtype;
begin
  perform private.require_perm(p_business, 'tire_hotel.manage');
  select * into s from public.tire_sets where id = p_set and business_id = p_business and status = 'stored' for update;
  if not found then raise exception 'set_not_stored' using errcode = 'P0002'; end if;
  if s.location_id = p_location then return; end if;
  update public.tire_sets set location_id = p_location where id = p_set;
  insert into public.tire_storage_movements (business_id, tire_set_id, kind, from_location_id, to_location_id, note, created_by)
  values (p_business, p_set, 'move', s.location_id, p_location, p_note, auth.uid());
end $$;

-- Check-out: frees the cell and closes the active contract.
create or replace function public.release_tire_set(p_business uuid, p_set uuid, p_note text default null, p_allow_unpaid boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.tire_sets%rowtype; c public.tire_storage_contracts%rowtype;
begin
  perform private.require_perm(p_business, 'tire_hotel.manage');
  select * into s from public.tire_sets where id = p_set and business_id = p_business and status = 'stored' for update;
  if not found then raise exception 'set_not_stored' using errcode = 'P0002'; end if;
  select * into c from public.tire_storage_contracts where tire_set_id = p_set and status = 'active' for update;
  if found and c.paid_total < c.price and not p_allow_unpaid then
    raise exception 'storage_unpaid' using errcode = '22023';
  end if;
  update public.tire_sets set status = 'released', location_id = null where id = p_set;
  update public.tire_storage_contracts set status = 'closed', closed_at = now() where id = c.id;
  insert into public.tire_storage_movements (business_id, tire_set_id, kind, from_location_id, note, created_by)
  values (p_business, p_set, 'check_out', s.location_id, p_note, auth.uid());
end $$;

create or replace function public.extend_storage(p_business uuid, p_set uuid, p_ends_on date, p_price bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.tire_storage_contracts%rowtype; v_id uuid;
begin
  perform private.require_perm(p_business, 'tire_hotel.manage');
  select * into c from public.tire_storage_contracts
   where tire_set_id = p_set and business_id = p_business and status = 'active' for update;
  if not found then raise exception 'no_active_contract' using errcode = 'P0002'; end if;
  if p_ends_on <= c.ends_on then raise exception 'invalid_end_date' using errcode = '22023'; end if;
  update public.tire_storage_contracts set status = 'extended', closed_at = now() where id = c.id;
  insert into public.tire_storage_contracts (business_id, tire_set_id, number, starts_on, ends_on, price, currency, extended_from, created_by)
  values (p_business, p_set, private.next_tire_code(p_business, 'SC'), c.ends_on, p_ends_on, p_price, c.currency, c.id, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.record_storage_payment(p_business uuid, p_contract uuid, p_amount bigint, p_method uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.tire_storage_contracts%rowtype; v_id uuid; v_cust uuid;
begin
  perform private.require_perm(p_business, 'finance.manage');
  select * into c from public.tire_storage_contracts where id = p_contract and business_id = p_business for update;
  if not found then raise exception 'contract_not_found' using errcode = 'P0002'; end if;
  if p_amount <= 0 then raise exception 'invalid_amount' using errcode = '22023'; end if;
  select customer_id into v_cust from public.tire_sets where id = c.tire_set_id;
  insert into public.payments (business_id, storage_contract_id, customer_id, kind, amount, currency, method_id, received_by)
  values (p_business, p_contract, v_cust, 'payment', p_amount, c.currency, p_method, auth.uid())
  returning id into v_id;
  update public.tire_storage_contracts set paid_total = paid_total + p_amount where id = p_contract;
  return v_id;
end $$;

-- Generate a grid of cells for a hotel warehouse.
create or replace function public.create_storage_grid(
  p_business uuid, p_warehouse uuid, p_zone text, p_racks int, p_shelves int, p_cells int, p_capacity int default 1
) returns int language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  perform private.require_perm(p_business, 'tire_hotel.manage');
  if not exists (select 1 from public.warehouses where id = p_warehouse and business_id = p_business and purpose = 'tire_hotel') then
    raise exception 'not_a_hotel_warehouse' using errcode = '22023';
  end if;
  if p_racks * p_shelves * p_cells > 5000 then raise exception 'grid_too_large' using errcode = '22023'; end if;
  insert into public.storage_locations (business_id, warehouse_id, zone, rack, shelf, cell, capacity_sets)
  select p_business, p_warehouse, upper(p_zone), r, s, c, p_capacity
    from generate_series(1, p_racks) r, generate_series(1, p_shelves) s, generate_series(1, p_cells) c
  on conflict (warehouse_id, zone, rack, shelf, cell) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
