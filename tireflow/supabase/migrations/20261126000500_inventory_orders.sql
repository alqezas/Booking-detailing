-- TireFlow · Inventory (movement journal), work orders, payments

-- ─────────────────────────────────────────── inventory
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  contact text,
  phone text,
  email text,
  created_at timestamptz not null default now(),
  unique (business_id, id)
);

create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  branch_id uuid not null,
  name text not null,
  -- 'stock' for commercial goods, 'tire_hotel' for customers' tires. Never mixed.
  purpose text not null check (purpose in ('stock', 'tire_hotel')),
  created_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, branch_id) references public.branches (business_id, id) on delete cascade
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  sku text not null check (length(sku) between 1 and 60),
  barcode text,
  name text not null check (length(name) between 1 and 200),
  category text not null check (category in (
    'new_tires', 'used_tires', 'rims', 'valves', 'tpms_sensors', 'balance_weights',
    'repair_materials', 'bolts', 'nuts', 'consumables', 'other')),
  manufacturer text,
  attributes jsonb not null default '{}'::jsonb,
  unit text not null default 'pcs' check (unit in ('pcs', 'set', 'g', 'kg', 'ml', 'l', 'm')),
  purchase_price bigint not null default 0 check (purchase_price >= 0),
  retail_price bigint not null default 0 check (retail_price >= 0),
  tax_rate_bp int check (tax_rate_bp between 0 and 10000),
  min_stock numeric(12, 3) not null default 0 check (min_stock >= 0),
  supplier_id uuid,
  location_note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (business_id, sku),
  unique (business_id, id),
  foreign key (business_id, supplier_id) references public.suppliers (business_id, id) on delete set null (supplier_id)
);
create trigger products_touch before update on public.products
  for each row execute function private.touch_updated_at();

-- Append-only journal. Stock is never edited directly.
create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  product_id uuid not null,
  warehouse_id uuid not null,
  kind text not null check (kind in ('receipt', 'issue', 'write_off', 'return', 'adjustment', 'transfer_out', 'transfer_in', 'order_consumption')),
  -- signed quantity: positive in, negative out
  quantity numeric(12, 3) not null check (quantity <> 0),
  unit_cost bigint check (unit_cost >= 0),
  work_order_id uuid,
  transfer_group uuid,
  note text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  check ((kind in ('receipt', 'return', 'transfer_in') and quantity > 0)
      or (kind in ('issue', 'write_off', 'transfer_out', 'order_consumption') and quantity < 0)
      or kind = 'adjustment'),
  foreign key (business_id, product_id) references public.products (business_id, id),
  foreign key (business_id, warehouse_id) references public.warehouses (business_id, id)
);
create index inventory_movements_product_idx on public.inventory_movements (business_id, product_id, created_at desc);

-- Materialised running stock per warehouse, maintained only by the movement trigger.
create table public.inventory_stock (
  business_id uuid not null,
  product_id uuid not null,
  warehouse_id uuid not null,
  on_hand numeric(12, 3) not null default 0 check (on_hand >= 0),
  reserved numeric(12, 3) not null default 0 check (reserved >= 0),
  avg_cost bigint not null default 0,
  primary key (product_id, warehouse_id),
  foreign key (business_id, product_id) references public.products (business_id, id) on delete cascade,
  foreign key (business_id, warehouse_id) references public.warehouses (business_id, id) on delete cascade
);

create or replace function private.apply_inventory_movement() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.inventory_stock%rowtype;
begin
  if not exists (select 1 from public.warehouses w where w.id = new.warehouse_id and w.purpose = 'stock') then
    raise exception 'not_a_stock_warehouse' using errcode = '22023';
  end if;
  insert into public.inventory_stock (business_id, product_id, warehouse_id)
  values (new.business_id, new.product_id, new.warehouse_id)
  on conflict (product_id, warehouse_id) do nothing;

  select * into s from public.inventory_stock
   where product_id = new.product_id and warehouse_id = new.warehouse_id for update;

  if s.on_hand + new.quantity < 0 then
    raise exception 'insufficient_stock' using errcode = '23514';
  end if;

  update public.inventory_stock set
    on_hand = s.on_hand + new.quantity,
    -- moving weighted average cost on receipts
    avg_cost = case when new.quantity > 0 and new.unit_cost is not null and s.on_hand + new.quantity > 0
                    then round((s.avg_cost * s.on_hand + new.unit_cost * new.quantity) / (s.on_hand + new.quantity))::bigint
                    else s.avg_cost end
   where product_id = new.product_id and warehouse_id = new.warehouse_id;
  return new;
end $$;

create trigger inventory_movements_apply before insert on public.inventory_movements
  for each row execute function private.apply_inventory_movement();

create or replace function private.forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;
create trigger inventory_movements_immutable before update or delete on public.inventory_movements
  for each row execute function private.forbid_change();

create or replace function public.record_inventory_movement(
  p_business uuid, p_product uuid, p_warehouse uuid, p_kind text, p_quantity numeric,
  p_unit_cost bigint default null, p_note text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_qty numeric := p_quantity;
begin
  perform private.require_perm(p_business, 'inventory.manage');
  if p_kind not in ('receipt', 'issue', 'write_off', 'return', 'adjustment') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  -- callers pass a positive amount; the sign follows the kind
  if p_kind in ('issue', 'write_off') then v_qty := -abs(p_quantity);
  elsif p_kind in ('receipt', 'return') then v_qty := abs(p_quantity); end if;
  insert into public.inventory_movements (business_id, product_id, warehouse_id, kind, quantity, unit_cost, note, created_by)
  values (p_business, p_product, p_warehouse, p_kind, v_qty, p_unit_cost, p_note, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.transfer_stock(
  p_business uuid, p_product uuid, p_from uuid, p_to uuid, p_quantity numeric, p_note text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_group uuid := gen_random_uuid();
begin
  perform private.require_perm(p_business, 'inventory.manage');
  if p_quantity <= 0 or p_from = p_to then raise exception 'invalid_transfer' using errcode = '22023'; end if;
  insert into public.inventory_movements (business_id, product_id, warehouse_id, kind, quantity, transfer_group, note, created_by)
  values (p_business, p_product, p_from, 'transfer_out', -p_quantity, v_group, p_note, auth.uid()),
         (p_business, p_product, p_to, 'transfer_in', p_quantity, v_group, p_note, auth.uid());
  return v_group;
end $$;

-- ─────────────────────────────────────────── work orders
create type public.work_order_status as enum
  ('draft', 'scheduled', 'in_progress', 'awaiting_approval', 'ready', 'completed', 'cancelled');
create type public.payment_status as enum ('unpaid', 'partial', 'paid', 'refunded', 'overpaid');

create table public.order_counters (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  last_number int not null default 0
);

create table public.work_orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  number text not null,
  branch_id uuid not null,
  booking_id uuid,
  customer_id uuid,
  vehicle_id uuid,
  corporate_customer_id uuid,
  workstation_id uuid,
  employee_id uuid,
  status public.work_order_status not null default 'draft',
  payment_status public.payment_status not null default 'unpaid',
  currency public.currency_code not null,
  vehicle_params jsonb not null default '{}'::jsonb,
  mileage_km int,
  -- totals in minor units, recomputed by private.recalc_work_order()
  subtotal bigint not null default 0,
  discount_total bigint not null default 0,
  tax_total bigint not null default 0,
  total bigint not null default 0,
  paid_total bigint not null default 0,
  prices_include_tax boolean not null,
  order_discount_bp int not null default 0 check (order_discount_bp between 0 and 10000),
  damage_notes text,
  customer_note text,
  internal_note text,
  due_date date,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, number),
  unique (business_id, id),
  foreign key (business_id, branch_id) references public.branches (business_id, id),
  foreign key (business_id, booking_id) references public.bookings (business_id, id) on delete set null (booking_id),
  foreign key (business_id, customer_id) references public.customers (business_id, id) on delete set null (customer_id),
  foreign key (business_id, vehicle_id) references public.vehicles (business_id, id) on delete set null (vehicle_id),
  foreign key (business_id, corporate_customer_id) references public.corporate_customers (business_id, id) on delete set null (corporate_customer_id),
  foreign key (business_id, workstation_id) references public.workstations (business_id, id) on delete set null (workstation_id),
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete set null (employee_id)
);
create unique index work_orders_booking_uq on public.work_orders (booking_id) where booking_id is not null;
create index work_orders_business_idx on public.work_orders (business_id, created_at desc);
create index work_orders_status_idx on public.work_orders (business_id, status);
create trigger work_orders_touch before update on public.work_orders
  for each row execute function private.touch_updated_at();

alter table public.inventory_movements
  add foreign key (business_id, work_order_id) references public.work_orders (business_id, id);

create table public.work_order_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  work_order_id uuid not null,
  kind text not null check (kind in ('service', 'product', 'custom')),
  service_id uuid,
  product_id uuid,
  warehouse_id uuid,
  -- snapshot: name and price stay fixed after the price list changes
  name text not null,
  quantity numeric(12, 3) not null check (quantity > 0),
  unit_price bigint not null check (unit_price >= 0),
  discount_bp int not null default 0 check (discount_bp between 0 and 10000),
  tax_rate_bp int not null check (tax_rate_bp between 0 and 10000),
  line_total bigint not null default 0,
  line_tax bigint not null default 0,
  is_additional boolean not null default false,
  approval text not null default 'approved' check (approval in ('approved', 'pending', 'declined')),
  employee_id uuid,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  check ((kind = 'service') = (service_id is not null)),
  check ((kind = 'product') = (product_id is not null and warehouse_id is not null)),
  foreign key (business_id, work_order_id) references public.work_orders (business_id, id) on delete cascade,
  foreign key (business_id, service_id) references public.services (business_id, id),
  foreign key (business_id, product_id) references public.products (business_id, id),
  foreign key (business_id, warehouse_id) references public.warehouses (business_id, id),
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete set null (employee_id)
);
create index work_order_items_order_idx on public.work_order_items (work_order_id);

create table public.work_order_status_history (
  id bigint generated always as identity primary key,
  business_id uuid not null,
  work_order_id uuid not null,
  from_status public.work_order_status,
  to_status public.work_order_status not null,
  changed_by uuid references auth.users (id),
  note text,
  changed_at timestamptz not null default now(),
  foreign key (business_id, work_order_id) references public.work_orders (business_id, id) on delete cascade
);

create or replace function private.log_work_order_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    insert into public.work_order_status_history (business_id, work_order_id, from_status, to_status, changed_by)
    values (new.business_id, new.id, case when tg_op = 'UPDATE' then old.status end, new.status, auth.uid());
  end if;
  return new;
end $$;
create trigger work_orders_status_log after insert or update of status on public.work_orders
  for each row execute function private.log_work_order_status();

-- ─────────────────────────────────────────── money arithmetic (exact, integer minor units)
-- Line: gross = qty × unit_price, discount by bp, tax either included or added.
-- Rounding: half away from zero once per line; order totals are sums of rounded lines.
create or replace function private.line_amounts(
  p_qty numeric, p_unit bigint, p_discount_bp int, p_tax_bp int, p_includes_tax boolean,
  out net bigint, out tax bigint, out gross bigint, out discount bigint)
language plpgsql immutable as $$
declare v_gross numeric := p_qty * p_unit;
begin
  discount := round(v_gross * p_discount_bp / 10000.0);
  if p_includes_tax then
    gross := round(v_gross) - discount;
    tax := round(gross * p_tax_bp / (10000.0 + p_tax_bp));
    net := gross - tax;
  else
    net := round(v_gross) - discount;
    tax := round(net * p_tax_bp / 10000.0);
    gross := net + tax;
  end if;
end $$;

create or replace function private.recalc_work_order(p_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.work_orders%rowtype;
begin
  select * into o from public.work_orders where id = p_order for update;
  update public.work_order_items i set (line_total, line_tax) = (
    select a.gross, a.tax from private.line_amounts(i.quantity, i.unit_price,
           least(10000, i.discount_bp + o.order_discount_bp), i.tax_rate_bp, o.prices_include_tax) a)
  where i.work_order_id = p_order;

  update public.work_orders w set
    subtotal = coalesce(t.gross_before, 0),
    discount_total = coalesce(t.discount, 0),
    tax_total = coalesce(t.tax, 0),
    total = coalesce(t.gross, 0)
  from (
    select sum(round(i.quantity * i.unit_price))::bigint as gross_before,
           sum(a.discount)::bigint as discount,
           sum(a.tax)::bigint as tax,
           sum(a.gross)::bigint as gross
      from public.work_order_items i
      cross join lateral private.line_amounts(i.quantity, i.unit_price,
         least(10000, i.discount_bp + o.order_discount_bp), i.tax_rate_bp, o.prices_include_tax) a
     where i.work_order_id = p_order and i.approval = 'approved'
  ) t
  where w.id = p_order;
  perform private.refresh_payment_status(p_order);
end $$;

-- ─────────────────────────────────────────── payments
create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  code text not null check (code ~ '^[a-z_]{2,30}$'),
  name text not null,
  is_active boolean not null default true,
  unique (business_id, code),
  unique (business_id, id)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  work_order_id uuid,
  storage_contract_id uuid,
  customer_id uuid,
  kind text not null check (kind in ('payment', 'refund')),
  -- always positive; kind decides the direction
  amount bigint not null check (amount > 0),
  currency public.currency_code not null,
  method_id uuid not null,
  refund_of uuid,
  reference text,
  note text,
  idempotency_key text,
  received_by uuid references auth.users (id),
  received_at timestamptz not null default now(),
  check ((kind = 'refund') = (refund_of is not null)),
  check (work_order_id is not null or storage_contract_id is not null),
  unique (business_id, id),
  unique (business_id, idempotency_key),
  foreign key (business_id, work_order_id) references public.work_orders (business_id, id),
  foreign key (business_id, customer_id) references public.customers (business_id, id) on delete set null (customer_id),
  foreign key (business_id, method_id) references public.payment_methods (business_id, id),
  foreign key (business_id, refund_of) references public.payments (business_id, id)
);
create index payments_business_idx on public.payments (business_id, received_at desc);
create index payments_order_idx on public.payments (work_order_id);
create trigger payments_immutable before update or delete on public.payments
  for each row execute function private.forbid_change();
create trigger payments_audit after insert on public.payments
  for each row execute function private.audit_row();

create or replace function private.refresh_payment_status(p_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_paid bigint; v_refunded bigint; v_total bigint;
begin
  select coalesce(sum(amount) filter (where kind = 'payment'), 0),
         coalesce(sum(amount) filter (where kind = 'refund'), 0)
    into v_paid, v_refunded
    from public.payments where work_order_id = p_order;
  select total into v_total from public.work_orders where id = p_order;
  update public.work_orders set
    paid_total = v_paid - v_refunded,
    payment_status = case
      when v_paid > 0 and v_paid - v_refunded <= 0 then 'refunded'
      when v_paid - v_refunded <= 0 then 'unpaid'
      when v_paid - v_refunded < v_total then 'partial'
      when v_paid - v_refunded = v_total then 'paid'
      else 'overpaid' end::public.payment_status
   where id = p_order;
end $$;

create or replace function public.record_payment(
  p_business uuid, p_order uuid, p_amount bigint, p_method uuid,
  p_reference text default null, p_idempotency_key text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare o public.work_orders%rowtype; v_id uuid;
begin
  perform private.require_perm(p_business, 'finance.manage');
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount' using errcode = '22023'; end if;
  if p_idempotency_key is not null then
    select id into v_id from public.payments where business_id = p_business and idempotency_key = p_idempotency_key;
    if found then return v_id; end if;
  end if;
  select * into o from public.work_orders where id = p_order and business_id = p_business for update;
  if not found then raise exception 'order_not_found' using errcode = 'P0002'; end if;
  if o.status = 'cancelled' then raise exception 'order_cancelled' using errcode = '22023'; end if;
  insert into public.payments (business_id, work_order_id, customer_id, kind, amount, currency, method_id, reference, idempotency_key, received_by)
  values (p_business, p_order, o.customer_id, 'payment', p_amount, o.currency, p_method, p_reference, p_idempotency_key, auth.uid())
  returning id into v_id;
  perform private.refresh_payment_status(p_order);
  return v_id;
end $$;

create or replace function public.refund_payment(
  p_business uuid, p_payment uuid, p_amount bigint, p_reason text, p_idempotency_key text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare p public.payments%rowtype; v_refunded bigint; v_id uuid;
begin
  perform private.require_perm(p_business, 'finance.manage');
  if p_idempotency_key is not null then
    select id into v_id from public.payments where business_id = p_business and idempotency_key = p_idempotency_key;
    if found then return v_id; end if;
  end if;
  select * into p from public.payments where id = p_payment and business_id = p_business and kind = 'payment' for update;
  if not found then raise exception 'payment_not_found' using errcode = 'P0002'; end if;
  select coalesce(sum(amount), 0) into v_refunded from public.payments where refund_of = p_payment;
  if p_amount <= 0 or p_amount > p.amount - v_refunded then
    raise exception 'refund_exceeds_payment' using errcode = '22023';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required' using errcode = '22023'; end if;
  insert into public.payments (business_id, work_order_id, storage_contract_id, customer_id, kind, amount, currency, method_id, refund_of, note, idempotency_key, received_by)
  values (p_business, p.work_order_id, p.storage_contract_id, p.customer_id, 'refund', p_amount, p.currency, p.method_id, p.id, p_reason, p_idempotency_key, auth.uid())
  returning id into v_id;
  if p.work_order_id is not null then perform private.refresh_payment_status(p.work_order_id); end if;
  return v_id;
end $$;

-- ─────────────────────────────────────────── work order RPCs
create or replace function private.next_order_number(p_business uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_n int; v_prefix text;
begin
  insert into public.order_counters (business_id, last_number) values (p_business, 1)
  on conflict (business_id) do update set last_number = public.order_counters.last_number + 1
  returning last_number into v_n;
  select order_number_prefix into v_prefix from public.business_settings where business_id = p_business;
  return coalesce(v_prefix, 'WO') || '-' || lpad(v_n::text, 6, '0');
end $$;

-- p: {branch_id, customer_id, vehicle_id, booking_id, workstation_id, employee_id,
--     vehicle_params, service_ids[], status}
create or replace function public.create_work_order(p_business uuid, p jsonb, p_idempotency_key text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  st public.business_settings%rowtype;
  v_id uuid;
  v_existing jsonb;
  v_booking public.bookings%rowtype;
  v_params jsonb := coalesce(p -> 'vehicle_params', '{}'::jsonb);
  v_services uuid[] := coalesce(array(select jsonb_array_elements_text(p -> 'service_ids')::uuid), '{}');
  v_line record;
  v_cust uuid := nullif(p ->> 'customer_id', '')::uuid;
  v_corp uuid;
  v_discount int := 0;
begin
  perform private.require_perm(p_business, 'orders.manage');
  if p_idempotency_key is not null then
    select result into v_existing from public.idempotency_keys
     where business_id = p_business and operation = 'create_work_order' and key = p_idempotency_key;
    if found then return (v_existing ->> 'id')::uuid; end if;
  end if;
  select * into st from public.business_settings where business_id = p_business;

  if nullif(p ->> 'booking_id', '') is not null then
    select * into v_booking from public.bookings where id = (p ->> 'booking_id')::uuid and business_id = p_business;
    if not found then raise exception 'booking_not_found' using errcode = 'P0002'; end if;
    select id into v_id from public.work_orders where booking_id = v_booking.id;
    if found then return v_id; end if; -- one order per booking
    v_cust := coalesce(v_cust, v_booking.customer_id);
    v_params := case when v_params = '{}'::jsonb then v_booking.vehicle_params else v_params end;
    if cardinality(v_services) = 0 then
      v_services := array(select service_id from public.booking_services where booking_id = v_booking.id);
    end if;
  end if;

  if v_cust is not null then
    select corporate_customer_id, discount_bp into v_corp, v_discount from public.customers
     where id = v_cust and business_id = p_business;
    if not found then raise exception 'customer_not_found' using errcode = 'P0002'; end if;
    if v_corp is not null then
      select greatest(v_discount, discount_bp) into v_discount from public.corporate_customers where id = v_corp;
    end if;
  end if;

  insert into public.work_orders (
    business_id, number, branch_id, booking_id, customer_id, vehicle_id, corporate_customer_id,
    workstation_id, employee_id, status, currency, vehicle_params, prices_include_tax,
    order_discount_bp, customer_note, internal_note, created_by)
  values (
    p_business, private.next_order_number(p_business),
    coalesce(nullif(p ->> 'branch_id', '')::uuid, v_booking.branch_id),
    v_booking.id, v_cust,
    coalesce(nullif(p ->> 'vehicle_id', '')::uuid, v_booking.vehicle_id), v_corp,
    coalesce(nullif(p ->> 'workstation_id', '')::uuid, v_booking.workstation_id),
    coalesce(nullif(p ->> 'employee_id', '')::uuid, v_booking.employee_id),
    coalesce(nullif(p ->> 'status', '')::public.work_order_status, 'scheduled'),
    st.currency, v_params, st.prices_include_tax, coalesce(v_discount, 0),
    p ->> 'customer_note', p ->> 'internal_note', auth.uid())
  returning id into v_id;

  for v_line in
    select q.*, s.name from unnest(v_services) with ordinality as u(sid, ord)
    cross join lateral public.quote_service(p_business, u.sid, v_params) q
    join public.services s on s.id = u.sid
    order by u.ord
  loop
    insert into public.work_order_items (business_id, work_order_id, kind, service_id, name, quantity, unit_price, tax_rate_bp)
    values (p_business, v_id, 'service', v_line.service_id, v_line.name, v_line.quantity, v_line.unit_price, v_line.tax_rate_bp);
  end loop;

  perform private.recalc_work_order(v_id);
  if p_idempotency_key is not null then
    insert into public.idempotency_keys (business_id, key, operation, result)
    values (p_business, p_idempotency_key, 'create_work_order', jsonb_build_object('id', v_id));
  end if;
  return v_id;
end $$;

-- p: {kind: service|product|custom, service_id, product_id, warehouse_id, name, quantity,
--     unit_price (custom only), discount_bp, is_additional}
create or replace function public.add_work_order_item(p_business uuid, p_order uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  o public.work_orders%rowtype;
  v_id uuid;
  v_kind text := p ->> 'kind';
  v_qty numeric := coalesce((p ->> 'quantity')::numeric, 1);
  v_q record;
  v_prod public.products%rowtype;
  v_st public.business_settings%rowtype;
  v_additional boolean := coalesce((p ->> 'is_additional')::boolean, false);
begin
  perform private.require_perm(p_business, 'orders.manage');
  select * into o from public.work_orders where id = p_order and business_id = p_business for update;
  if not found then raise exception 'order_not_found' using errcode = 'P0002'; end if;
  if o.status in ('completed', 'cancelled') then raise exception 'order_closed' using errcode = '22023'; end if;
  select * into v_st from public.business_settings where business_id = p_business;
  if v_qty <= 0 then raise exception 'invalid_quantity' using errcode = '22023'; end if;

  if v_kind = 'service' then
    -- price always comes from the server-side quote, never from the client
    select q.*, s.name into v_q
      from public.quote_service(p_business, (p ->> 'service_id')::uuid, o.vehicle_params) q
      join public.services s on s.id = q.service_id;
    insert into public.work_order_items (business_id, work_order_id, kind, service_id, name, quantity, unit_price,
        discount_bp, tax_rate_bp, is_additional, approval)
    values (p_business, p_order, 'service', v_q.service_id, v_q.name,
            case when p ? 'quantity' then v_qty else v_q.quantity end, v_q.unit_price,
            coalesce((p ->> 'discount_bp')::int, 0), v_q.tax_rate_bp, v_additional,
            case when v_additional and o.status = 'in_progress' then 'pending' else 'approved' end)
    returning id into v_id;
  elsif v_kind = 'product' then
    select * into v_prod from public.products where id = (p ->> 'product_id')::uuid and business_id = p_business and deleted_at is null;
    if not found then raise exception 'product_not_found' using errcode = 'P0002'; end if;
    insert into public.work_order_items (business_id, work_order_id, kind, product_id, warehouse_id, name, quantity,
        unit_price, discount_bp, tax_rate_bp, is_additional)
    values (p_business, p_order, 'product', v_prod.id, (p ->> 'warehouse_id')::uuid, v_prod.name, v_qty,
            v_prod.retail_price, coalesce((p ->> 'discount_bp')::int, 0),
            coalesce(v_prod.tax_rate_bp, v_st.default_tax_rate_bp), v_additional)
    returning id into v_id;
  elsif v_kind = 'custom' then
    if not public.has_perm(p_business, 'services.manage') then
      raise exception 'forbidden: custom price' using errcode = '42501';
    end if;
    insert into public.work_order_items (business_id, work_order_id, kind, name, quantity, unit_price, discount_bp, tax_rate_bp, is_additional)
    values (p_business, p_order, 'custom', coalesce(nullif(trim(p ->> 'name'), ''), 'Item'), v_qty,
            (p ->> 'unit_price')::bigint, coalesce((p ->> 'discount_bp')::int, 0), v_st.default_tax_rate_bp, v_additional)
    returning id into v_id;
  else
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  if exists (select 1 from public.work_order_items where id = v_id and approval = 'pending') then
    update public.work_orders set status = 'awaiting_approval' where id = p_order;
  end if;
  perform private.recalc_work_order(p_order);
  return v_id;
end $$;

create or replace function public.remove_work_order_item(p_business uuid, p_item uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_order uuid;
begin
  perform private.require_perm(p_business, 'orders.manage');
  delete from public.work_order_items i using public.work_orders o
   where i.id = p_item and i.business_id = p_business and o.id = i.work_order_id
     and o.status not in ('completed', 'cancelled')
  returning i.work_order_id into v_order;
  if v_order is null then raise exception 'item_not_found_or_closed' using errcode = 'P0002'; end if;
  perform private.recalc_work_order(v_order);
end $$;

create or replace function public.decide_additional_work(p_business uuid, p_item uuid, p_approved boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_order uuid;
begin
  perform private.require_perm(p_business, 'orders.manage');
  update public.work_order_items set approval = case when p_approved then 'approved' else 'declined' end
   where id = p_item and business_id = p_business and approval = 'pending'
  returning work_order_id into v_order;
  if v_order is null then raise exception 'item_not_pending' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.work_order_items where work_order_id = v_order and approval = 'pending') then
    update public.work_orders set status = 'in_progress' where id = v_order and status = 'awaiting_approval';
  end if;
  perform private.recalc_work_order(v_order);
end $$;

-- Status change. Mechanics may move only orders assigned to them, and never complete payment.
create or replace function public.set_work_order_status(p_business uuid, p_order uuid, p_status public.work_order_status, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.work_orders%rowtype; v_item record; v_is_assignee boolean;
begin
  select * into o from public.work_orders where id = p_order and business_id = p_business for update;
  if not found then raise exception 'order_not_found' using errcode = 'P0002'; end if;

  select exists (select 1 from public.employees e join public.memberships m on m.id = e.membership_id
                  where e.id = o.employee_id and m.user_id = auth.uid()) into v_is_assignee;
  if not (public.has_perm(p_business, 'orders.manage')
          or (public.has_perm(p_business, 'orders.work') and v_is_assignee and p_status in ('in_progress', 'ready'))) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if o.status in ('completed', 'cancelled') then raise exception 'order_closed' using errcode = '22023'; end if;
  if p_status = 'completed' and exists (select 1 from public.work_order_items where work_order_id = p_order and approval = 'pending') then
    raise exception 'pending_approvals' using errcode = '22023';
  end if;

  if p_status = 'completed' then
    -- consume used materials from stock in the same transaction
    for v_item in select * from public.work_order_items
                   where work_order_id = p_order and kind = 'product' and approval = 'approved' loop
      insert into public.inventory_movements (business_id, product_id, warehouse_id, kind, quantity, work_order_id, created_by)
      values (p_business, v_item.product_id, v_item.warehouse_id, 'order_consumption', -v_item.quantity, p_order, auth.uid());
    end loop;
    update public.customers c set
      visits_count = c.visits_count + 1,
      total_spent = c.total_spent + o.total,
      last_visit_at = now()
     where c.id = o.customer_id;
    if o.booking_id is not null then
      update public.bookings set status = 'completed' where id = o.booking_id and status not in ('cancelled', 'no_show');
    end if;
  end if;

  update public.work_orders set
    status = p_status,
    started_at = case when p_status = 'in_progress' then coalesce(started_at, now()) else started_at end,
    completed_at = case when p_status = 'completed' then now() else completed_at end
   where id = p_order;
  if p_note is not null then
    update public.work_order_status_history set note = p_note
     where id = (select max(id) from public.work_order_status_history where work_order_id = p_order);
  end if;
  if p_status = 'ready' then
    perform private.enqueue_order_event(p_business, p_order, 'order_ready');
  end if;
end $$;

-- ─────────────────────────────────────────── expenses
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  branch_id uuid,
  category text not null check (category in ('rent', 'salaries', 'utilities', 'purchases', 'equipment', 'marketing', 'taxes', 'other')),
  amount bigint not null check (amount > 0),
  currency public.currency_code not null,
  spent_on date not null,
  supplier_id uuid,
  note text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  foreign key (business_id, branch_id) references public.branches (business_id, id) on delete set null (branch_id),
  foreign key (business_id, supplier_id) references public.suppliers (business_id, id) on delete set null (supplier_id)
);
create index expenses_business_idx on public.expenses (business_id, spent_on desc);
