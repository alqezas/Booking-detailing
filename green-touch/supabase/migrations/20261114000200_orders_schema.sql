-- Orders with historical snapshots, payments (LiqPay), outbox.
-- Everything is made to order: there are no stock reservations.

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  -- human-readable number for the owner; never a lookup key for guests
  number bigint generated always as identity unique,
  idempotency_key text not null unique check (idempotency_key ~ '^[A-Za-z0-9_-]{16,80}$'),
  request_hash text not null,
  -- guests read their order with a random token; only its SHA-256 is stored
  access_token_hash bytea not null,
  first_name text not null check (length(first_name) between 1 and 60),
  last_name text not null check (length(last_name) between 1 and 60),
  phone text not null check (phone ~ '^\+380[0-9]{9}$'),
  email text check (length(email) <= 120),
  comment text check (length(comment) <= 1000),
  delivery_method text not null check (delivery_method in ('np_branch', 'np_postomat')),
  np_settlement_ref text not null,
  np_city_ref text not null,
  np_settlement_name text not null,
  np_area text,
  np_warehouse_ref text not null,
  np_warehouse_number text,
  np_warehouse_name text not null,
  np_warehouse_type_ref text not null,
  subtotal_kop int not null check (subtotal_kop >= 0),
  discount_kop int not null default 0 check (discount_kop >= 0),
  total_kop int not null check (total_kop > 0),
  currency text not null default 'UAH' check (currency = 'UAH'),
  -- payment and fulfilment are separate: the owner can never mark a LiqPay payment as received
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'awaiting', 'processing', 'paid', 'failed', 'expired', 'reversed')),
  paid_attempt_id uuid,
  paid_at timestamptz,
  fulfillment_status text not null default 'new'
    check (fulfillment_status in ('new', 'processing', 'packed', 'shipped', 'delivered', 'cancelled')),
  needs_review boolean not null default false,
  review_reasons text[] not null default '{}',
  ttn text check (ttn ~ '^[0-9]{10,20}$'),
  owner_note text check (length(owner_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (total_kop = subtotal_kop - discount_kop)
);
create index orders_created_idx on public.orders (created_at desc);
create index orders_phone_idx on public.orders (phone);

create table public.order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  line_no int not null,
  item_id uuid references public.items (id) on delete set null,
  kind text not null check (kind in ('product', 'kit', 'sample')),
  slug text not null,
  name text not null,
  volume text,
  qty int not null check (qty between 1 and 50),
  -- product: its price; kit: the sum of its components at the time of purchase
  unit_base_kop int not null check (unit_base_kop >= 0),
  discount_bp int not null default 0,
  unit_discount_kop int not null default 0 check (unit_discount_kop >= 0),
  unit_price_kop int not null check (unit_price_kop = unit_base_kop - unit_discount_kop),
  line_total_kop int not null check (line_total_kop = unit_price_kop * qty),
  unique (order_id, line_no)
);
create index order_lines_item_idx on public.order_lines (item_id);

-- What a kit consisted of when it was bought (for packing and history)
create table public.order_line_components (
  line_id uuid not null references public.order_lines (id) on delete cascade,
  product_id uuid references public.items (id) on delete set null,
  name text not null,
  volume text,
  qty_per_kit int not null check (qty_per_kit >= 1),
  unit_price_kop int not null,
  sort int not null default 0
);
create index order_line_components_line_idx on public.order_line_components (line_id);

-- One attempt = one LiqPay order_id (LiqPay requires it to be unique per payment).
create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  status text not null default 'creating' check (status in (
    'creating', 'created', 'processing', 'success', 'failure', 'reversed', 'expired',
    'create_failed', 'abandoned', 'superseded')),
  provider_order_id text unique,
  -- the signed checkout payload (public: no secrets); kept to re-open the same payment page
  checkout_data text,
  checkout_signature text,
  amount_kop int not null check (amount_kop > 0),
  currency text not null default 'UAH',
  expires_at timestamptz not null,
  provider_payment_id text,
  provider_modified_at timestamptz,
  failure_reason text,
  last_error text,
  check_count int not null default 0,
  next_check_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- At most one live payment per order: protects against creating a second one.
create unique index payment_attempts_one_open on public.payment_attempts (order_id)
  where status in ('creating', 'created', 'processing');
create index payment_attempts_check_idx on public.payment_attempts (next_check_at)
  where status in ('created', 'processing', 'superseded');
alter table public.orders add foreign key (paid_attempt_id) references public.payment_attempts (id);

-- Every provider status we saw (callback or status request). No card data, no customer data.
create table public.payment_events (
  id bigint generated always as identity primary key,
  dedupe_key text not null unique,
  source text not null check (source in ('callback', 'reconcile')),
  provider_order_id text not null,
  attempt_id uuid references public.payment_attempts (id) on delete set null,
  provider_status text not null,
  status text not null,
  amount_kop int,
  currency text,
  provider_payment_id text,
  provider_modified_at timestamptz,
  failure_reason text,
  outcome text not null default 'pending',
  received_at timestamptz not null default now()
);
create index payment_events_order_idx on public.payment_events (provider_order_id, received_at);

-- Transactional outbox: written in the same transaction as the state change.
create table public.outbox (
  id bigint generated always as identity primary key,
  topic text not null check (topic ~ '^[a-z_.]{1,60}$'),
  order_id uuid references public.orders (id) on delete cascade,
  payload jsonb not null default '{}',
  dedupe_key text not null unique,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'dead')),
  attempts int not null default 0,
  max_attempts int not null default 8,
  available_at timestamptz not null default now(),
  locked_by text,
  locked_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index outbox_ready_idx on public.outbox (available_at, id) where status in ('pending', 'processing');

-- Effects of outbox consumers, unique per (event, consumer): makes consumers idempotent.
create table public.outbox_effects (
  outbox_id bigint not null references public.outbox (id) on delete cascade,
  consumer text not null,
  done_at timestamptz not null default now(),
  primary key (outbox_id, consumer)
);

-- What happened to an order, shown to the owner (written by the outbox consumer).
create table public.order_timeline (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  event text not null,
  details jsonb not null default '{}',
  outbox_id bigint unique references public.outbox (id) on delete set null,
  at timestamptz not null default now()
);
create index order_timeline_order_idx on public.order_timeline (order_id, at);

-- Serverless-safe rate limiting (fixed windows in the database).
create table private.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (bucket, window_start)
);

create function private.orders_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger orders_touch before update on public.orders
  for each row execute function private.orders_touch();
create trigger payment_attempts_touch before update on public.payment_attempts
  for each row execute function private.orders_touch();
