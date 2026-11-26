-- TireFlow · Mechanics add notes / damage records to orders assigned to them (no other columns).
create or replace function public.update_work_notes(p_business uuid, p_order uuid, p_damage text, p_note text, p_mileage int default null)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.work_orders%rowtype; v_assignee boolean;
begin
  select * into o from public.work_orders where id = p_order and business_id = p_business for update;
  if not found then raise exception 'order_not_found' using errcode = 'P0002'; end if;
  select exists (select 1 from public.employees e join public.memberships m on m.id = e.membership_id
                  where e.id = o.employee_id and m.user_id = auth.uid()) into v_assignee;
  if not (public.has_perm(p_business, 'orders.manage') or (public.has_perm(p_business, 'orders.work') and v_assignee)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if o.status in ('completed', 'cancelled') then raise exception 'order_closed' using errcode = '22023'; end if;
  update public.work_orders set
    damage_notes = coalesce(left(p_damage, 4000), damage_notes),
    internal_note = coalesce(left(p_note, 4000), internal_note),
    mileage_km = coalesce(p_mileage, mileage_km)
  where id = p_order;
end $$;
revoke execute on function public.update_work_notes(uuid, uuid, text, text, int) from public, anon;
grant execute on function public.update_work_notes(uuid, uuid, text, text, int) to authenticated;
