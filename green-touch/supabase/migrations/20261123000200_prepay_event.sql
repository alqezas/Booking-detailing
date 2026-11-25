-- «Передоплату отримано» now also emits an outbox event (order.prepaid), so the
-- Telegram bot announces prepay orders only once the prepayment has arrived.
create or replace function public.admin_mark_prepay(p_order uuid, p_note text default null) returns jsonb
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
  perform private.enqueue('order.prepaid', p_order, jsonb_build_object('prepay_kop', v.prepay_kop), 'order.prepaid:' || p_order);
  return jsonb_build_object('ok', true);
end $$;
