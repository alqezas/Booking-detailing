-- Payment provider back to plata by mono; two payment options at checkout:
--   full_online   — the whole order paid online via mono (card / wallets on mono's page)
--   prepay_manual — 150 грн prepayment arranged by the owner in Viber (requisites,
--                   nothing paid on the site); the rest is Nova Poshta cash on delivery.

-- ── Orders: payment option and manual prepayment ─────────────────────────────
alter table public.orders
  add column payment_method text not null default 'full_online' check (payment_method in ('full_online', 'prepay_manual')),
  add column prepay_kop int not null default 0 check (prepay_kop >= 0),
  -- recorded by the owner (bank transfer by requisites, outside the site)
  add column prepay_received_at timestamptz,
  add column prepay_note text check (length(prepay_note) <= 500),
  add constraint orders_prepay_check check (
    (payment_method = 'full_online' and prepay_kop = 0)
    or (payment_method = 'prepay_manual' and prepay_kop > 0 and prepay_kop < total_kop));

grant select (payment_method, prepay_kop, prepay_received_at, prepay_note) on public.orders to authenticated;

-- ── Payment attempts: mono invoices ──────────────────────────────────────────
alter table public.payment_attempts
  add column page_url text,
  add column ccy int not null default 980;
alter table public.payment_attempts drop column checkout_data, drop column checkout_signature;
alter table public.payment_attempts drop constraint payment_attempts_status_check;
alter table public.payment_attempts add constraint payment_attempts_status_check check (status in (
  'creating', 'created', 'processing', 'hold', 'success', 'failure', 'reversed', 'expired',
  'create_failed', 'abandoned', 'superseded'));
drop index public.payment_attempts_one_open;
create unique index payment_attempts_one_open on public.payment_attempts (order_id)
  where status in ('creating', 'created', 'processing', 'hold');
-- provider_order_id now holds the mono invoiceId (set after invoice/create)

alter table public.payment_events drop constraint payment_events_source_check;
alter table public.payment_events add constraint payment_events_source_check check (source in ('webhook', 'reconcile'));

-- Public setting: prepayment amount and what to tell the buyer.
insert into public.shop_settings (key, value, is_public) values
  ('payment', jsonb_build_object('prepay_kop', 15000, 'prepay_enabled', true, 'full_enabled', true), true)
on conflict (key) do nothing;

-- ── Order creation reads the payment option ──────────────────────────────────
create or replace function private.create_order(p jsonb, p_request_hash text, p_token_hash bytea) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_key text := p ->> 'idempotency_key';
  v_existing public.orders;
  v_order uuid;
  v_sub int := 0;
  v_disc int := 0;
  v_total int := 0;
  v_bad jsonb;
  v_line record;
  v_line_id uuid;
  v_method text := coalesce(p ->> 'payment_method', 'full_online');
  v_cfg jsonb := (select value from public.shop_settings where key = 'payment');
  v_prepay int := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('order:' || v_key, 0));
  select * into v_existing from public.orders where idempotency_key = v_key;
  if found then
    if v_existing.request_hash <> p_request_hash then
      raise exception 'IDEMPOTENCY_MISMATCH';
    end if;
    return jsonb_build_object('order_id', v_existing.id, 'number', v_existing.number, 'total_kop', v_existing.total_kop,
      'payment_method', v_existing.payment_method, 'existing', true);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', pl.item_id, 'name', pl.name)), '[]') into v_bad
  from private.price_lines(p -> 'lines') pl where not pl.purchasable or not pl.available;
  if jsonb_array_length(v_bad) > 0 then
    raise exception 'ITEM_UNAVAILABLE' using detail = v_bad::text;
  end if;

  select coalesce(sum(pl.unit_base_kop * pl.qty), 0), coalesce(sum(pl.unit_discount_kop * pl.qty), 0), coalesce(sum(pl.unit_price_kop * pl.qty), 0)
  into v_sub, v_disc, v_total from private.price_lines(p -> 'lines') pl;

  if p ? 'expected_total_kop' and (p ->> 'expected_total_kop')::int <> v_total then
    raise exception 'PRICE_CHANGED' using detail = jsonb_build_object('total_kop', v_total)::text;
  end if;

  if v_method not in ('full_online', 'prepay_manual')
     or (v_method = 'full_online' and coalesce((v_cfg ->> 'full_enabled')::boolean, true) is false)
     or (v_method = 'prepay_manual' and coalesce((v_cfg ->> 'prepay_enabled')::boolean, true) is false) then
    raise exception 'PAYMENT_METHOD_UNAVAILABLE';
  end if;
  if v_method = 'prepay_manual' then
    v_prepay := coalesce((v_cfg ->> 'prepay_kop')::int, 15000);
    if v_prepay >= v_total then
      raise exception 'PAYMENT_METHOD_UNAVAILABLE' using detail = jsonb_build_object('reason', 'total_below_prepay')::text;
    end if;
  end if;

  insert into public.orders (
    idempotency_key, request_hash, access_token_hash, first_name, last_name, phone, email, comment,
    delivery_method, np_settlement_ref, np_city_ref, np_settlement_name, np_area,
    np_warehouse_ref, np_warehouse_number, np_warehouse_name, np_warehouse_type_ref,
    subtotal_kop, discount_kop, total_kop, payment_method, prepay_kop)
  values (
    v_key, p_request_hash, p_token_hash,
    p #>> '{customer,first_name}', p #>> '{customer,last_name}', p #>> '{customer,phone}',
    nullif(p #>> '{customer,email}', ''), nullif(p #>> '{customer,comment}', ''),
    p #>> '{delivery,method}', p #>> '{delivery,settlement_ref}', p #>> '{delivery,city_ref}',
    p #>> '{delivery,settlement_name}', p #>> '{delivery,area}',
    p #>> '{delivery,warehouse_ref}', p #>> '{delivery,warehouse_number}', p #>> '{delivery,warehouse_name}',
    p #>> '{delivery,warehouse_type_ref}',
    v_sub, v_disc, v_total, v_method, v_prepay)
  returning id into v_order;

  for v_line in select * from private.price_lines(p -> 'lines') order by line_no loop
    insert into public.order_lines (order_id, line_no, item_id, kind, slug, name, volume, qty,
      unit_base_kop, discount_bp, unit_discount_kop, unit_price_kop, line_total_kop)
    values (v_order, v_line.line_no, v_line.item_id, v_line.kind, v_line.slug, v_line.name, v_line.volume, v_line.qty,
      v_line.unit_base_kop, v_line.discount_bp, v_line.unit_discount_kop, v_line.unit_price_kop, v_line.unit_price_kop * v_line.qty)
    returning id into v_line_id;
    if v_line.kind = 'kit' then
      insert into public.order_line_components (line_id, product_id, name, volume, qty_per_kit, unit_price_kop, sort)
      select v_line_id, i.id, i.name, i.volume, c.qty, i.price_kop, c.sort
      from public.kit_components c join public.items i on i.id = c.product_id
      where c.kit_id = v_line.item_id;
    end if;
  end loop;

  perform private.enqueue('order.created', v_order, jsonb_build_object('total_kop', v_total, 'payment_method', v_method), 'order.created:' || v_order);
  return jsonb_build_object('order_id', v_order, 'number', (select number from public.orders where id = v_order),
    'total_kop', v_total, 'payment_method', v_method, 'existing', false);
end $$;

-- ── Online payment (mono). HTTP to mono happens between begin and attach. ─────
drop function if exists public.svc_attach_checkout(uuid, text, text);
drop function if exists private.attach_checkout(uuid, text, text);
drop function if exists public.svc_begin_payment(uuid, int);
drop function if exists private.begin_payment(uuid, int);

create function private.begin_payment(p_order uuid, p_validity_minutes int) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_o public.orders;
  v_a public.payment_attempts;
  v_id uuid := gen_random_uuid();
  v_expires timestamptz := now() + make_interval(mins => p_validity_minutes);
  v_cancel text;
begin
  select * into v_o from public.orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_o.payment_method <> 'full_online' then raise exception 'NOT_ONLINE_PAYMENT'; end if;
  if v_o.payment_status = 'paid' then return jsonb_build_object('state', 'paid'); end if;
  if v_o.fulfillment_status = 'cancelled' then raise exception 'ORDER_CANCELLED'; end if;

  select * into v_a from public.payment_attempts
  where order_id = p_order and status in ('creating', 'created', 'processing', 'hold') for update;
  if found then
    if v_a.status in ('processing', 'hold') then
      return jsonb_build_object('state', 'processing');
    elsif v_a.status = 'created' and v_a.expires_at > now() + interval '5 minutes' then
      return jsonb_build_object('state', 'existing', 'page_url', v_a.page_url);
    elsif v_a.status = 'creating' and v_a.created_at > now() - interval '45 seconds' then
      return jsonb_build_object('state', 'in_progress');
    elsif v_a.status = 'creating' then
      update public.payment_attempts set status = 'abandoned', last_error = 'stale creating' where id = v_a.id;
    else
      update public.payment_attempts set status = 'superseded', next_check_at = now() where id = v_a.id;
      v_cancel := v_a.provider_order_id;
    end if;
  end if;

  insert into public.payment_attempts (id, order_id, amount_kop, expires_at) values (v_id, p_order, v_o.total_kop, v_expires);
  return jsonb_build_object('state', 'new', 'attempt_id', v_id, 'amount_kop', v_o.total_kop, 'number', v_o.number,
    'validity_s', greatest(60, p_validity_minutes * 60), 'cancel_invoice', v_cancel);
end $$;

create function private.attach_invoice(p_attempt uuid, p_invoice text, p_page_url text) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_a public.payment_attempts;
begin
  select * into v_a from public.payment_attempts where id = p_attempt for update;
  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  if v_a.status = 'creating' then
    update public.payment_attempts
      set status = 'created', provider_order_id = p_invoice, page_url = p_page_url, next_check_at = now() + interval '3 minutes'
      where id = p_attempt;
    update public.orders set payment_status = 'awaiting' where id = v_a.order_id and payment_status <> 'paid';
    return jsonb_build_object('state', 'created', 'page_url', p_page_url);
  end if;
  -- raced with a newer attempt: keep the invoice for reconciliation, the caller cancels it
  update public.payment_attempts set provider_order_id = p_invoice, page_url = p_page_url, status = 'superseded', next_check_at = now()
    where id = p_attempt;
  return jsonb_build_object('state', 'superseded');
end $$;

-- mono sends modifiedDate: a newer status wins; success is never undone by failure/expiry,
-- reversed only follows success; duplicates are dropped by dedupe_key.
create or replace function private.apply_payment_event(p jsonb) returns text
language plpgsql set search_path = '' as $$
declare
  v_event bigint;
  v_a public.payment_attempts;
  v_o public.orders;
  v_status text := p ->> 'status';
  v_mod timestamptz := (p ->> 'modified_at')::timestamptz;
  v_terminal text[] := array['success', 'failure', 'expired', 'reversed'];
begin
  insert into public.payment_events (dedupe_key, source, provider_order_id, provider_status, status, amount_kop, currency,
    provider_payment_id, provider_modified_at, failure_reason)
  values (p ->> 'dedupe_key', p ->> 'source', p ->> 'provider_order_id', left(p ->> 'provider_status', 40), v_status,
    (p ->> 'amount_kop')::int, p ->> 'currency', null, v_mod, left(p ->> 'failure_reason', 300))
  on conflict (dedupe_key) do nothing
  returning id into v_event;
  if v_event is null then return 'duplicate'; end if;

  select * into v_a from public.payment_attempts where provider_order_id = p ->> 'provider_order_id' for update;
  if not found then
    update public.payment_events set outcome = 'unknown_invoice' where id = v_event;
    return 'unknown_invoice';
  end if;
  update public.payment_events set attempt_id = v_a.id where id = v_event;
  select * into v_o from public.orders where id = v_a.order_id for update;

  if (p ->> 'amount_kop')::int is distinct from v_a.amount_kop or (p ->> 'currency') is distinct from '980' then
    update public.payment_events set outcome = 'mismatch' where id = v_event;
    if v_status = 'success' then
      perform private.add_review(v_o.id, 'payment_amount_mismatch');
      perform private.enqueue('payment.needs_review', v_o.id, jsonb_build_object('invoice_id', v_a.provider_order_id, 'reason', 'amount_mismatch'), 'review:mismatch:' || v_event);
    end if;
    return 'mismatch';
  end if;

  if (v_a.provider_modified_at is not null and v_mod is not null and v_mod <= v_a.provider_modified_at)
     or (v_a.status = any (v_terminal) and not (v_status = any (v_terminal)))
     or (v_a.status = 'success' and v_status in ('failure', 'expired'))
     or (v_status = 'reversed' and v_a.status <> 'success') then
    update public.payment_events set outcome = 'stale' where id = v_event;
    return 'stale';
  end if;

  update public.payment_attempts
    set status = case when status = 'superseded' and not (v_status = any (v_terminal)) then status else v_status end,
        provider_modified_at = coalesce(v_mod, provider_modified_at),
        failure_reason = coalesce(left(p ->> 'failure_reason', 300), failure_reason),
        next_check_at = case when v_status = any (v_terminal) then null else next_check_at end
    where id = v_a.id;

  if v_status = 'success' then
    if v_o.payment_status = 'paid' and v_o.paid_attempt_id is distinct from v_a.id then
      perform private.add_review(v_o.id, 'double_payment');
      perform private.enqueue('payment.needs_review', v_o.id, jsonb_build_object('invoice_id', v_a.provider_order_id, 'reason', 'double_payment'), 'review:double:' || v_a.id);
    elsif v_o.payment_status <> 'paid' then
      update public.orders set payment_status = 'paid', paid_attempt_id = v_a.id, paid_at = coalesce(v_mod, now()) where id = v_o.id;
      if v_o.fulfillment_status = 'cancelled' then
        perform private.add_review(v_o.id, 'paid_after_cancel');
      end if;
      perform private.enqueue('order.paid', v_o.id, jsonb_build_object('invoice_id', v_a.provider_order_id, 'total_kop', v_o.total_kop), 'order.paid:' || v_o.id);
    end if;
  elsif v_status = 'reversed' then
    if v_o.paid_attempt_id = v_a.id then
      update public.orders set payment_status = 'reversed' where id = v_o.id;
      perform private.add_review(v_o.id, 'payment_reversed');
      perform private.enqueue('payment.needs_review', v_o.id, jsonb_build_object('invoice_id', v_a.provider_order_id, 'reason', 'reversed'), 'review:reversed:' || v_a.id);
    end if;
  elsif v_status in ('failure', 'expired') then
    if v_o.payment_status <> 'paid' and not exists (
      select 1 from public.payment_attempts x where x.order_id = v_o.id and x.id <> v_a.id and x.status in ('creating', 'created', 'processing', 'hold')
    ) then
      update public.orders set payment_status = case when v_status = 'failure' then 'failed' else 'expired' end where id = v_o.id;
      perform private.enqueue('payment.failed', v_o.id, jsonb_build_object('invoice_id', v_a.provider_order_id, 'status', v_status), 'payment.failed:' || v_a.id || ':' || v_status);
    end if;
  elsif v_status in ('processing', 'hold') then
    if v_o.payment_status in ('unpaid', 'awaiting', 'failed', 'expired') then
      update public.orders set payment_status = 'processing' where id = v_o.id;
    end if;
  end if;

  update public.payment_events set outcome = 'applied' where id = v_event;
  return 'applied';
end $$;

drop function if exists public.svc_claim_payment_checks(int);
drop function if exists private.claim_payment_checks(int);
create function private.claim_payment_checks(p_limit int) returns table (attempt_id uuid, invoice_id text, status text)
language sql set search_path = '' as $$
  with picked as (
    select a.id from public.payment_attempts a
    where a.status in ('created', 'processing', 'hold', 'superseded') and a.provider_order_id is not null
      and a.next_check_at <= now() and a.check_count < 15
    order by a.next_check_at
    limit least(greatest(p_limit, 1), 50)
    for update skip locked
  )
  update public.payment_attempts a
    set check_count = a.check_count + 1,
        next_check_at = now() + least(interval '1 minute' * power(2, a.check_count), interval '2 hours')
  from picked where a.id = picked.id
  returning a.id, a.provider_order_id, a.status;
$$;

drop function if exists public.svc_order_attempts(uuid);
create function public.svc_order_attempts(p_order uuid) returns table (attempt_id uuid, invoice_id text, status text)
language sql security definer set search_path = '' as $$
  select id, provider_order_id, status from public.payment_attempts
  where order_id = p_order and provider_order_id is not null and status in ('created', 'processing', 'hold', 'superseded');
$$;

-- Guest view: payment option, prepayment and the cash-on-delivery remainder.
create or replace function private.order_for_guest(p_order uuid, p_token_hash bytea) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', o.id, 'number', o.number, 'created_at', o.created_at,
    'payment_method', o.payment_method, 'prepay_kop', o.prepay_kop, 'prepay_received', o.prepay_received_at is not null,
    'cod_kop', case when o.payment_method = 'prepay_manual' then o.total_kop - o.prepay_kop else 0 end,
    'payment_status', o.payment_status, 'fulfillment_status', o.fulfillment_status,
    'needs_review', o.needs_review, 'ttn', o.ttn,
    'subtotal_kop', o.subtotal_kop, 'discount_kop', o.discount_kop, 'total_kop', o.total_kop,
    'delivery', jsonb_build_object('method', o.delivery_method, 'settlement', o.np_settlement_name, 'area', o.np_area,
                                   'warehouse', o.np_warehouse_name),
    'first_name', o.first_name,
    'can_pay', o.payment_method = 'full_online' and o.payment_status in ('unpaid', 'awaiting', 'failed', 'expired') and o.fulfillment_status <> 'cancelled',
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
        'kind', l.kind, 'slug', l.slug, 'name', l.name, 'volume', l.volume, 'qty', l.qty,
        'unit_base_kop', l.unit_base_kop, 'unit_price_kop', l.unit_price_kop, 'line_total_kop', l.line_total_kop,
        'components', (select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'volume', c.volume, 'qty', c.qty_per_kit) order by c.sort, c.name), '[]')
                       from public.order_line_components c where c.line_id = l.id)) order by l.line_no), '[]')
      from public.order_lines l where l.order_id = o.id),
    'open_attempt', (select jsonb_build_object('status', a.status, 'created_at', a.created_at)
      from public.payment_attempts a where a.order_id = o.id and a.status in ('created', 'processing', 'hold') limit 1)
  )
  from public.orders o
  where o.id = p_order and o.access_token_hash = p_token_hash;
$$;

create function public.svc_begin_payment(p_order uuid, p_validity_minutes int) returns jsonb
language sql security definer set search_path = '' as $$ select private.begin_payment(p_order, p_validity_minutes); $$;
create function public.svc_attach_invoice(p_attempt uuid, p_invoice text, p_page_url text) returns jsonb
language sql security definer set search_path = '' as $$ select private.attach_invoice(p_attempt, p_invoice, p_page_url); $$;
create function public.svc_claim_payment_checks(p_limit int) returns table (attempt_id uuid, invoice_id text, status text)
language sql security definer set search_path = '' as $$ select * from private.claim_payment_checks(p_limit); $$;

do $$
declare
  f text;
begin
  for f in
    select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'svc\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ── Owner: record the manual prepayment; shipping rules per payment option ───
create function public.admin_mark_prepay(p_order uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.orders;
begin
  perform private.assert_admin();
  select * into v from public.orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v.payment_method <> 'prepay_manual' then raise exception 'NOT_PREPAY_ORDER'; end if;
  if v.prepay_received_at is not null then return jsonb_build_object('ok', true); end if;
  update public.orders set prepay_received_at = now(), prepay_note = left(nullif(btrim(p_note), ''), 500) where id = p_order;
  insert into public.order_timeline (order_id, event, details)
  values (p_order, 'owner.prepay_received', jsonb_build_object('amount_kop', v.prepay_kop, 'note', left(p_note, 200), 'by', (select auth.uid())));
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.admin_mark_prepay(uuid, text) to authenticated;

create or replace function public.admin_update_order(p_order uuid, p_fulfillment text, p_ttn text default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.orders;
  v_ready boolean;
begin
  perform private.assert_admin();
  select * into v from public.orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if p_fulfillment not in ('new', 'processing', 'packed', 'shipped', 'delivered', 'cancelled') then
    raise exception 'BAD_STATUS';
  end if;
  -- full: mono confirmed the payment; prepay: the owner recorded the prepayment
  v_ready := not v.needs_review and (
    (v.payment_method = 'full_online' and v.payment_status = 'paid')
    or (v.payment_method = 'prepay_manual' and v.prepay_received_at is not null));
  if p_fulfillment in ('processing', 'packed', 'shipped', 'delivered') and not v_ready then
    raise exception 'NOT_READY_TO_SHIP';
  end if;
  if p_fulfillment = 'shipped' and coalesce(nullif(p_ttn, ''), v.ttn) is null then
    raise exception 'TTN_REQUIRED';
  end if;
  update public.orders
    set fulfillment_status = p_fulfillment,
        ttn = coalesce(nullif(regexp_replace(coalesce(p_ttn, ''), '\s', '', 'g'), ''), ttn),
        owner_note = coalesce(p_note, owner_note)
  where id = p_order;
  if p_fulfillment = 'cancelled' and v.fulfillment_status <> 'cancelled' and (v.payment_status = 'paid' or v.prepay_received_at is not null) then
    perform private.add_review(p_order, 'cancelled_after_payment');
  end if;
  insert into public.order_timeline (order_id, event, details)
  values (p_order, 'owner.fulfillment', jsonb_build_object('from', v.fulfillment_status, 'to', p_fulfillment, 'ttn', p_ttn, 'by', (select auth.uid())));
  return jsonb_build_object('ok', true);
end $$;

-- Texts the owner has not reviewed yet: describe both payment options.
update public.pages set body = $md$
## Оплата
Два варіанти на вибір під час оформлення:

- **Повна оплата онлайн** — на сторінці оплати monobank (plata by mono). Замовлення вважається оплаченим лише після підтвердження від банку.
- **Передоплата 150 грн** — після оформлення ми напишемо вам у Viber і надішлемо реквізити. Решту суми ви сплатите при отриманні на Новій пошті (накладений платіж; комісію за переказ Нова пошта стягує за своїми тарифами).

Усі засоби виготовляються під замовлення: виготовлення починається після оплати або передоплати.

## Доставка
- Нова пошта — відділення.
- Нова пошта — поштомат.

Вартість доставки сплачує отримувач за тарифами Нової пошти при отриманні. Вона не входить у суму оплати товарів.

[ЗАПОВНІТЬ: строк виготовлення та відправлення після оплати.]
$md$, updated_at = now()
where slug = 'dostavka-i-oplata' and needs_review;

update public.shop_settings
set value = value || jsonb_build_object('payment', 'Повна оплата онлайн через monobank або передоплата 150 грн (реквізити надішлемо у Viber), решта — накладеним платежем на Новій пошті.')
where key = 'delivery';

update public.pages set body = replace(body, 'платіжному сервісу LiqPay — для проведення оплати.', 'банку (plata by mono) — для проведення онлайн-оплати.'), updated_at = now()
where slug = 'polityka-konfidentsiinosti' and needs_review;
update public.pages set body = replace(body, 'Онлайн через LiqPay.', 'Повна оплата онлайн через monobank (plata by mono) або передоплата 150 грн за реквізитами, які ми надішлемо у Viber; решта — накладеним платежем на Новій пошті.'), updated_at = now()
where slug = 'umovy-pokupky' and needs_review;
