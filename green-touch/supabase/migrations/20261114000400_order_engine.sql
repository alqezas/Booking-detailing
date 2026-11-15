-- Order creation, payment state machine (LiqPay), outbox.
-- Called only by Edge Functions with the service role (svc_* wrappers below).
-- Everything is made to order: no stock reservations.

create function private.enqueue(p_topic text, p_order uuid, p_payload jsonb, p_dedupe text) returns void
language sql set search_path = '' as $$
  insert into public.outbox (topic, order_id, payload, dedupe_key)
  values (p_topic, p_order, coalesce(p_payload, '{}'), p_dedupe)
  on conflict (dedupe_key) do nothing;
$$;

create function private.add_review(p_order uuid, p_reason text) returns void
language sql set search_path = '' as $$
  update public.orders
  set needs_review = true,
      review_reasons = case when p_reason = any (review_reasons) then review_reasons else review_reasons || p_reason end
  where id = p_order;
$$;

-- p: {idempotency_key, lines:[{id,qty}], customer:{...}, delivery:{...verified by the NP API...}, expected_total_kop?}
create function private.create_order(p jsonb, p_request_hash text, p_token_hash bytea) returns jsonb
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
begin
  -- Same key → same order; same key with a different body → rejected.
  perform pg_advisory_xact_lock(hashtextextended('order:' || v_key, 0));
  select * into v_existing from public.orders where idempotency_key = v_key;
  if found then
    if v_existing.request_hash <> p_request_hash then
      raise exception 'IDEMPOTENCY_MISMATCH';
    end if;
    return jsonb_build_object('order_id', v_existing.id, 'number', v_existing.number, 'total_kop', v_existing.total_kop, 'existing', true);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', pl.item_id, 'name', pl.name)), '[]') into v_bad
  from private.price_lines(p -> 'lines') pl where not pl.purchasable or not pl.available;
  if jsonb_array_length(v_bad) > 0 then
    raise exception 'ITEM_UNAVAILABLE' using detail = v_bad::text;
  end if;

  select coalesce(sum(pl.unit_base_kop * pl.qty), 0), coalesce(sum(pl.unit_discount_kop * pl.qty), 0), coalesce(sum(pl.unit_price_kop * pl.qty), 0)
  into v_sub, v_disc, v_total from private.price_lines(p -> 'lines') pl;

  -- The client shows a total; if the server's differs the buyer must see the new one first.
  if p ? 'expected_total_kop' and (p ->> 'expected_total_kop')::int <> v_total then
    raise exception 'PRICE_CHANGED' using detail = jsonb_build_object('total_kop', v_total)::text;
  end if;

  insert into public.orders (
    idempotency_key, request_hash, access_token_hash, first_name, last_name, phone, email, comment,
    delivery_method, np_settlement_ref, np_city_ref, np_settlement_name, np_area,
    np_warehouse_ref, np_warehouse_number, np_warehouse_name, np_warehouse_type_ref,
    subtotal_kop, discount_kop, total_kop)
  values (
    v_key, p_request_hash, p_token_hash,
    p #>> '{customer,first_name}', p #>> '{customer,last_name}', p #>> '{customer,phone}',
    nullif(p #>> '{customer,email}', ''), nullif(p #>> '{customer,comment}', ''),
    p #>> '{delivery,method}', p #>> '{delivery,settlement_ref}', p #>> '{delivery,city_ref}',
    p #>> '{delivery,settlement_name}', p #>> '{delivery,area}',
    p #>> '{delivery,warehouse_ref}', p #>> '{delivery,warehouse_number}', p #>> '{delivery,warehouse_name}',
    p #>> '{delivery,warehouse_type_ref}',
    v_sub, v_disc, v_total)
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

  perform private.enqueue('order.created', v_order, jsonb_build_object('total_kop', v_total), 'order.created:' || v_order);
  return jsonb_build_object('order_id', v_order, 'number', (select number from public.orders where id = v_order), 'total_kop', v_total, 'existing', false);
end $$;

-- Step 1 of a payment: decide whether a new LiqPay payment may be prepared.
create function private.begin_payment(p_order uuid, p_validity_minutes int) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_o public.orders;
  v_a public.payment_attempts;
  v_id uuid := gen_random_uuid();
  v_poid text;
  v_expires timestamptz := now() + make_interval(mins => p_validity_minutes);
begin
  select * into v_o from public.orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_o.payment_status = 'paid' then return jsonb_build_object('state', 'paid'); end if;
  if v_o.fulfillment_status = 'cancelled' then raise exception 'ORDER_CANCELLED'; end if;

  select * into v_a from public.payment_attempts
  where order_id = p_order and status in ('creating', 'created', 'processing') for update;
  if found then
    if v_a.status = 'processing' then
      return jsonb_build_object('state', 'processing');
    elsif v_a.status = 'created' and v_a.expires_at > now() + interval '5 minutes' then
      return jsonb_build_object('state', 'existing', 'data', v_a.checkout_data, 'signature', v_a.checkout_signature);
    elsif v_a.status = 'creating' and v_a.created_at > now() - interval '45 seconds' then
      return jsonb_build_object('state', 'in_progress');
    elsif v_a.status = 'creating' then
      -- the previous request died between preparing and saving the payment
      update public.payment_attempts set status = 'abandoned', last_error = 'stale creating' where id = v_a.id;
    else
      -- about to expire: a fresh payment is prepared; the old one is still reconciled
      update public.payment_attempts set status = 'superseded', next_check_at = now() where id = v_a.id;
    end if;
  end if;

  -- LiqPay requires a unique order_id per payment: one per attempt.
  v_poid := 'GT-' || v_o.number || '-' || left(replace(v_id::text, '-', ''), 10);
  insert into public.payment_attempts (id, order_id, amount_kop, expires_at, provider_order_id)
  values (v_id, p_order, v_o.total_kop, v_expires, v_poid);
  return jsonb_build_object('state', 'new', 'attempt_id', v_id, 'amount_kop', v_o.total_kop, 'number', v_o.number,
    'provider_order_id', v_poid, 'expires_at', v_expires);
end $$;

-- Step 2: store the signed checkout payload the function prepared.
create function private.attach_checkout(p_attempt uuid, p_data text, p_signature text) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_a public.payment_attempts;
begin
  select * into v_a from public.payment_attempts where id = p_attempt for update;
  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  if v_a.status <> 'creating' then
    return jsonb_build_object('state', 'superseded');
  end if;
  update public.payment_attempts
    set status = 'created', checkout_data = p_data, checkout_signature = p_signature, next_check_at = now() + interval '5 minutes'
    where id = p_attempt;
  update public.orders set payment_status = 'awaiting' where id = v_a.order_id and payment_status <> 'paid';
  return jsonb_build_object('state', 'created');
end $$;

create function private.fail_attempt(p_attempt uuid, p_error text) returns void
language sql set search_path = '' as $$
  update public.payment_attempts set status = 'create_failed', last_error = left(p_error, 500)
  where id = p_attempt and status = 'creating';
$$;

-- LiqPay gives no ordering guarantee and no modification time for every status,
-- so events are ordered by rank: a lower-ranked status never overrides a higher one.
create function private.status_rank(p text) returns int
language sql immutable set search_path = '' as $$
  select case p when 'creating' then 0 when 'created' then 1 when 'superseded' then 1 when 'processing' then 2
    when 'expired' then 3 when 'failure' then 3 when 'success' then 4 when 'reversed' then 5 else 0 end;
$$;

-- Apply one provider status (callback or reconciliation). Idempotent and order-safe.
-- p: {dedupe_key, source, provider_order_id, provider_status, status, amount_kop, currency, payment_id, modified_at, failure_reason}
create function private.apply_payment_event(p jsonb) returns text
language plpgsql set search_path = '' as $$
declare
  v_event bigint;
  v_a public.payment_attempts;
  v_o public.orders;
  v_status text := p ->> 'status';
begin
  insert into public.payment_events (dedupe_key, source, provider_order_id, provider_status, status, amount_kop, currency,
    provider_payment_id, provider_modified_at, failure_reason)
  values (p ->> 'dedupe_key', p ->> 'source', p ->> 'provider_order_id', left(p ->> 'provider_status', 40), v_status,
    (p ->> 'amount_kop')::int, p ->> 'currency', left(p ->> 'payment_id', 60), (p ->> 'modified_at')::timestamptz,
    left(p ->> 'failure_reason', 300))
  on conflict (dedupe_key) do nothing
  returning id into v_event;
  if v_event is null then return 'duplicate'; end if;

  select * into v_a from public.payment_attempts where provider_order_id = p ->> 'provider_order_id' for update;
  if not found then
    update public.payment_events set outcome = 'unknown_order' where id = v_event;
    return 'unknown_order';
  end if;
  update public.payment_events set attempt_id = v_a.id where id = v_event;
  select * into v_o from public.orders where id = v_a.order_id for update;

  if v_status in ('success', 'reversed')
     and ((p ->> 'amount_kop')::int is distinct from v_a.amount_kop or (p ->> 'currency') is distinct from v_a.currency) then
    update public.payment_events set outcome = 'mismatch' where id = v_event;
    perform private.add_review(v_o.id, 'payment_amount_mismatch');
    perform private.enqueue('payment.needs_review', v_o.id, jsonb_build_object('provider_order_id', v_a.provider_order_id, 'reason', 'amount_mismatch'), 'review:mismatch:' || v_event);
    return 'mismatch';
  end if;

  if private.status_rank(v_status) < private.status_rank(v_a.status)
     or v_status = v_a.status
     or (v_status = 'reversed' and v_a.status <> 'success') then
    update public.payment_events set outcome = 'stale' where id = v_event;
    return 'stale';
  end if;

  update public.payment_attempts
    set status = case when status = 'superseded' and v_status in ('created', 'processing') then status else v_status end,
        provider_payment_id = coalesce(left(p ->> 'payment_id', 60), provider_payment_id),
        provider_modified_at = coalesce((p ->> 'modified_at')::timestamptz, provider_modified_at),
        failure_reason = coalesce(left(p ->> 'failure_reason', 300), failure_reason),
        next_check_at = case when v_status in ('success', 'failure', 'expired', 'reversed') then null else next_check_at end
    where id = v_a.id;

  if v_status = 'success' then
    if v_o.payment_status = 'paid' and v_o.paid_attempt_id is distinct from v_a.id then
      perform private.add_review(v_o.id, 'double_payment');
      perform private.enqueue('payment.needs_review', v_o.id, jsonb_build_object('provider_order_id', v_a.provider_order_id, 'reason', 'double_payment'), 'review:double:' || v_a.id);
    elsif v_o.payment_status <> 'paid' then
      update public.orders set payment_status = 'paid', paid_attempt_id = v_a.id, paid_at = coalesce((p ->> 'modified_at')::timestamptz, now()) where id = v_o.id;
      if v_o.fulfillment_status = 'cancelled' then
        perform private.add_review(v_o.id, 'paid_after_cancel');
      end if;
      perform private.enqueue('order.paid', v_o.id, jsonb_build_object('provider_order_id', v_a.provider_order_id, 'total_kop', v_o.total_kop), 'order.paid:' || v_o.id);
    end if;
  elsif v_status = 'reversed' then
    if v_o.paid_attempt_id = v_a.id then
      update public.orders set payment_status = 'reversed' where id = v_o.id;
      perform private.add_review(v_o.id, 'payment_reversed');
      perform private.enqueue('payment.needs_review', v_o.id, jsonb_build_object('provider_order_id', v_a.provider_order_id, 'reason', 'reversed'), 'review:reversed:' || v_a.id);
    end if;
  elsif v_status in ('failure', 'expired') then
    if v_o.payment_status <> 'paid' and not exists (
      select 1 from public.payment_attempts x where x.order_id = v_o.id and x.id <> v_a.id and x.status in ('creating', 'created', 'processing')
    ) then
      update public.orders set payment_status = case when v_status = 'failure' then 'failed' else 'expired' end where id = v_o.id;
      perform private.enqueue('payment.failed', v_o.id, jsonb_build_object('provider_order_id', v_a.provider_order_id, 'status', v_status), 'payment.failed:' || v_a.id || ':' || v_status);
    end if;
  elsif v_status = 'processing' then
    if v_o.payment_status in ('unpaid', 'awaiting', 'failed', 'expired') then
      update public.orders set payment_status = 'processing' where id = v_o.id;
    end if;
  end if;

  update public.payment_events set outcome = 'applied' where id = v_event;
  return 'applied';
end $$;

-- Attempts whose status should be re-checked at LiqPay (lost/late callbacks, expiry).
-- Claims them with SKIP LOCKED and pushes next_check_at with backoff.
create function private.claim_payment_checks(p_limit int) returns table (attempt_id uuid, provider_order_id text, expires_at timestamptz)
language sql set search_path = '' as $$
  with picked as (
    select a.id from public.payment_attempts a
    where a.status in ('created', 'processing', 'superseded') and a.provider_order_id is not null
      and a.next_check_at <= now() and a.check_count < 15
    order by a.next_check_at
    limit least(greatest(p_limit, 1), 50)
    for update skip locked
  )
  update public.payment_attempts a
    set check_count = a.check_count + 1,
        next_check_at = now() + least(interval '1 minute' * power(2, a.check_count), interval '2 hours')
  from picked where a.id = picked.id
  returning a.id, a.provider_order_id, a.expires_at;
$$;

-- ── Outbox processing: several workers can run at once ──────────────────────
create function private.claim_outbox(p_worker text, p_limit int, p_lease_s int) returns setof public.outbox
language sql set search_path = '' as $$
  with picked as (
    select o.id from public.outbox o
    where (o.status = 'pending' and o.available_at <= now())
       or (o.status = 'processing' and o.locked_until < now())
    order by o.id
    limit least(greatest(p_limit, 1), 100)
    for update skip locked
  )
  update public.outbox o
    set status = 'processing', locked_by = p_worker, locked_until = now() + make_interval(secs => p_lease_s), attempts = o.attempts + 1
  from picked where o.id = picked.id
  returning o.*;
$$;

create function private.complete_outbox(p_id bigint, p_worker text) returns boolean
language plpgsql set search_path = '' as $$
begin
  update public.outbox set status = 'done', done_at = now(), locked_by = null, locked_until = null, last_error = null
  where id = p_id and status = 'processing' and locked_by = p_worker;
  return found;
end $$;

create function private.fail_outbox(p_id bigint, p_worker text, p_error text) returns text
language plpgsql set search_path = '' as $$
declare
  v_status text;
begin
  update public.outbox
    set status = case when attempts >= max_attempts then 'dead' else 'pending' end,
        available_at = now() + least(interval '15 seconds' * power(2, attempts), interval '1 hour'),
        locked_by = null, locked_until = null, last_error = left(p_error, 1000)
  where id = p_id and status = 'processing' and locked_by = p_worker
  returning status into v_status;
  return v_status;
end $$;

-- Idempotent consumer bookkeeping: true the first time (event, consumer) is recorded.
create function private.record_effect(p_id bigint, p_consumer text) returns boolean
language plpgsql set search_path = '' as $$
begin
  insert into public.outbox_effects (outbox_id, consumer) values (p_id, p_consumer) on conflict do nothing;
  return found;
end $$;

create function private.record_timeline(p_outbox bigint) returns boolean
language plpgsql set search_path = '' as $$
declare
  v public.outbox;
begin
  select * into v from public.outbox where id = p_outbox;
  if v.order_id is null then return false; end if;
  insert into public.order_timeline (order_id, event, details, outbox_id)
  values (v.order_id, v.topic, v.payload, v.id) on conflict (outbox_id) do nothing;
  return found;
end $$;

-- ── Rate limiting (fixed window) ─────────────────────────────────────────────
create function private.hit_rate_limit(p_bucket text, p_max int, p_window_s int) returns boolean
language plpgsql set search_path = '' as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_s) * p_window_s);
  v_hits int;
begin
  insert into private.rate_limits (bucket, window_start, hits) values (left(p_bucket, 200), v_start, 1)
  on conflict (bucket, window_start) do update set hits = private.rate_limits.hits + 1
  returning hits into v_hits;
  if random() < 0.01 then
    delete from private.rate_limits where window_start < now() - interval '1 day';
  end if;
  return v_hits <= p_max;
end $$;

-- ── Guest order view (token checked by the Edge Function: sha256 → hash) ─────
create function private.order_for_guest(p_order uuid, p_token_hash bytea) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', o.id, 'number', o.number, 'created_at', o.created_at,
    'payment_status', o.payment_status, 'fulfillment_status', o.fulfillment_status,
    'needs_review', o.needs_review, 'ttn', o.ttn,
    'subtotal_kop', o.subtotal_kop, 'discount_kop', o.discount_kop, 'total_kop', o.total_kop,
    'delivery', jsonb_build_object('method', o.delivery_method, 'settlement', o.np_settlement_name, 'area', o.np_area,
                                   'warehouse', o.np_warehouse_name),
    'first_name', o.first_name,
    'can_pay', o.payment_status in ('unpaid', 'awaiting', 'failed', 'expired') and o.fulfillment_status <> 'cancelled',
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
        'kind', l.kind, 'slug', l.slug, 'name', l.name, 'volume', l.volume, 'qty', l.qty,
        'unit_base_kop', l.unit_base_kop, 'unit_price_kop', l.unit_price_kop, 'line_total_kop', l.line_total_kop,
        'components', (select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'volume', c.volume, 'qty', c.qty_per_kit) order by c.sort, c.name), '[]')
                       from public.order_line_components c where c.line_id = l.id)) order by l.line_no), '[]')
      from public.order_lines l where l.order_id = o.id),
    'open_attempt', (select jsonb_build_object('status', a.status, 'created_at', a.created_at)
      from public.payment_attempts a where a.order_id = o.id and a.status in ('created', 'processing') limit 1)
  )
  from public.orders o
  where o.id = p_order and o.access_token_hash = p_token_hash;
$$;

-- ── Service-role wrappers (the only entry points from Edge Functions) ────────
create function public.svc_create_order(p jsonb, p_request_hash text, p_token_hash bytea) returns jsonb
language sql security definer set search_path = '' as $$ select private.create_order(p, p_request_hash, p_token_hash); $$;
create function public.svc_begin_payment(p_order uuid, p_validity_minutes int) returns jsonb
language sql security definer set search_path = '' as $$ select private.begin_payment(p_order, p_validity_minutes); $$;
create function public.svc_attach_checkout(p_attempt uuid, p_data text, p_signature text) returns jsonb
language sql security definer set search_path = '' as $$ select private.attach_checkout(p_attempt, p_data, p_signature); $$;
create function public.svc_fail_attempt(p_attempt uuid, p_error text) returns void
language sql security definer set search_path = '' as $$ select private.fail_attempt(p_attempt, p_error); $$;
create function public.svc_apply_payment_event(p jsonb) returns text
language sql security definer set search_path = '' as $$ select private.apply_payment_event(p); $$;
create function public.svc_claim_payment_checks(p_limit int) returns table (attempt_id uuid, provider_order_id text, expires_at timestamptz)
language sql security definer set search_path = '' as $$ select * from private.claim_payment_checks(p_limit); $$;
create function public.svc_claim_outbox(p_worker text, p_limit int, p_lease_s int) returns setof public.outbox
language sql security definer set search_path = '' as $$ select * from private.claim_outbox(p_worker, p_limit, p_lease_s); $$;
create function public.svc_complete_outbox(p_id bigint, p_worker text) returns boolean
language sql security definer set search_path = '' as $$ select private.complete_outbox(p_id, p_worker); $$;
create function public.svc_fail_outbox(p_id bigint, p_worker text, p_error text) returns text
language sql security definer set search_path = '' as $$ select private.fail_outbox(p_id, p_worker, p_error); $$;
create function public.svc_record_effect(p_id bigint, p_consumer text) returns boolean
language sql security definer set search_path = '' as $$ select private.record_effect(p_id, p_consumer); $$;
create function public.svc_record_timeline(p_outbox bigint) returns boolean
language sql security definer set search_path = '' as $$ select private.record_timeline(p_outbox); $$;
create function public.svc_rate_limit(p_bucket text, p_max int, p_window_s int) returns boolean
language sql security definer set search_path = '' as $$ select private.hit_rate_limit(p_bucket, p_max, p_window_s); $$;
create function public.svc_order_for_guest(p_order uuid, p_token_hash bytea) returns jsonb
language sql security definer set search_path = '' as $$ select private.order_for_guest(p_order, p_token_hash); $$;
create function public.svc_order_attempts(p_order uuid) returns table (attempt_id uuid, provider_order_id text, status text, expires_at timestamptz)
language sql security definer set search_path = '' as $$
  select id, provider_order_id, status, expires_at from public.payment_attempts
  where order_id = p_order and provider_order_id is not null and status in ('created', 'processing', 'superseded');
$$;

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
