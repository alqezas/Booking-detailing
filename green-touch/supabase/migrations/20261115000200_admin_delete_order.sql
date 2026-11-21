-- The owner can delete an order from the admin (test orders, spam, duplicates).
-- Refused while money is confirmed or in flight at monobank: refund first.
-- A still-open mono invoice is queued for invalidation (outbox topic
-- 'mono.remove_invoice', not tied to the order so it survives the delete).

create function public.admin_delete_order(p_order uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.orders;
  v_inv text;
begin
  perform private.assert_admin();
  select * into v from public.orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v.payment_status = 'paid' then raise exception 'ORDER_PAID'; end if;
  if exists (select 1 from public.payment_attempts
             where order_id = p_order and status in ('creating', 'processing', 'hold')) then
    raise exception 'PAYMENT_IN_PROGRESS';
  end if;

  for v_inv in
    select provider_order_id from public.payment_attempts
    where order_id = p_order and provider_order_id is not null and status in ('created', 'superseded')
  loop
    insert into public.outbox (topic, order_id, payload, dedupe_key)
    values ('mono.remove_invoice', null, jsonb_build_object('invoice_id', v_inv, 'order_number', v.number),
            'mono.remove_invoice:' || v_inv)
    on conflict (dedupe_key) do nothing;
  end loop;

  -- Lines, components, attempts, timeline and order outbox rows cascade;
  -- payment_events keep the provider history (attempt_id set null).
  update public.orders set paid_attempt_id = null where id = p_order;
  delete from public.orders where id = p_order;
  return jsonb_build_object('ok', true, 'number', v.number);
end $$;
revoke execute on function public.admin_delete_order(uuid) from public, anon;
grant execute on function public.admin_delete_order(uuid) to authenticated;
