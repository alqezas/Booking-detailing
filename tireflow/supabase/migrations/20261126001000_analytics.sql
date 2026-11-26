-- TireFlow · Dashboard & analytics aggregates (computed from real rows), mechanic work list

-- Day boundaries are taken in the business time zone.
create or replace function public.dashboard_stats(p_business uuid, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  st public.business_settings%rowtype;
  v_today date;
  v_day_start timestamptz;
  v_week_start timestamptz;
  v_month_start timestamptz;
  v_fin boolean;
  r jsonb;
begin
  perform private.require_perm(p_business, 'calendar.view');
  v_fin := public.has_perm(p_business, 'finance.view') or public.has_perm(p_business, 'analytics.view');
  select * into st from public.business_settings where business_id = p_business;
  v_today := (now() at time zone st.timezone)::date;
  v_day_start := v_today::timestamp at time zone st.timezone;
  v_week_start := date_trunc('week', v_today)::timestamp at time zone st.timezone;
  v_month_start := date_trunc('month', v_today)::timestamp at time zone st.timezone;

  select jsonb_build_object(
    'currency', st.currency,
    'timezone', st.timezone,
    'bookings_today', (select count(*) from public.bookings b where b.business_id = p_business
        and (p_branch is null or b.branch_id = p_branch)
        and b.starts_at >= v_day_start and b.starts_at < v_day_start + interval '1 day'
        and b.status not in ('cancelled')),
    'in_progress', (select count(*) from public.work_orders o where o.business_id = p_business
        and (p_branch is null or o.branch_id = p_branch) and o.status in ('in_progress', 'awaiting_approval')),
    'completed_today', (select count(*) from public.work_orders o where o.business_id = p_business
        and (p_branch is null or o.branch_id = p_branch) and o.status = 'completed' and o.completed_at >= v_day_start),
    'revenue_today', case when v_fin then (select coalesce(sum(case kind when 'payment' then amount else -amount end), 0)
        from public.payments p where p.business_id = p_business and p.received_at >= v_day_start) end,
    'revenue_week', case when v_fin then (select coalesce(sum(case kind when 'payment' then amount else -amount end), 0)
        from public.payments p where p.business_id = p_business and p.received_at >= v_week_start) end,
    'revenue_month', case when v_fin then (select coalesce(sum(case kind when 'payment' then amount else -amount end), 0)
        from public.payments p where p.business_id = p_business and p.received_at >= v_month_start) end,
    'avg_ticket_month', case when v_fin then (select coalesce(round(avg(total)), 0) from public.work_orders o
        where o.business_id = p_business and o.status = 'completed' and o.completed_at >= v_month_start) end,
    'new_customers_month', (select count(*) from public.customers c where c.business_id = p_business
        and c.created_at >= v_month_start and c.deleted_at is null),
    'returning_customers_month', (select count(distinct o.customer_id) from public.work_orders o
        join public.customers c on c.id = o.customer_id
        where o.business_id = p_business and o.status = 'completed' and o.completed_at >= v_month_start
          and c.created_at < v_month_start),
    'tire_sets_stored', (select count(*) from public.tire_sets t where t.business_id = p_business and t.status = 'stored'),
    'overdue_payments', case when v_fin then (select count(*) from public.work_orders o where o.business_id = p_business
        and o.status = 'completed' and o.payment_status in ('unpaid', 'partial')) end,
    'post_load_today', (
      select coalesce(round(100.0 * sum(extract(epoch from (least(upper(ro.during), v_day_start + interval '1 day')
                                                       - greatest(lower(ro.during), v_day_start))))
             / nullif((select count(*) from public.workstations w where w.business_id = p_business and w.is_active
                        and (p_branch is null or w.branch_id = p_branch)) * 10 * 3600, 0)), 0)
        from public.resource_occupancies ro
       where ro.business_id = p_business and ro.resource_kind = 'workstation'
         and (p_branch is null or ro.branch_id = p_branch)
         and ro.during && tstzrange(v_day_start, v_day_start + interval '1 day')),
    'upcoming', (select coalesce(jsonb_agg(x order by x.starts_at), '[]') from (
        select b.id, b.starts_at, b.ends_at, b.status, w.name as workstation,
               coalesce(nullif(trim(c.first_name || ' ' || c.last_name), ''), b.contact_name) as customer,
               coalesce(v.plate, b.plate_text) as plate
          from public.bookings b
          join public.workstations w on w.id = b.workstation_id
          left join public.customers c on c.id = b.customer_id
          left join public.vehicles v on v.id = b.vehicle_id
         where b.business_id = p_business and (p_branch is null or b.branch_id = p_branch)
           and b.starts_at >= now() - interval '30 minutes' and b.status in ('pending', 'confirmed', 'arrived')
         order by b.starts_at limit 8) x),
    'active_orders', (select coalesce(jsonb_agg(x order by x.created_at), '[]') from (
        select o.id, o.number, o.status, o.created_at,
               case when v_fin then o.total end as total,
               coalesce(nullif(trim(c.first_name || ' ' || c.last_name), ''), '—') as customer, v.plate
          from public.work_orders o
          left join public.customers c on c.id = o.customer_id
          left join public.vehicles v on v.id = o.vehicle_id
         where o.business_id = p_business and (p_branch is null or o.branch_id = p_branch)
           and o.status in ('scheduled', 'in_progress', 'awaiting_approval', 'ready')
         order by o.created_at limit 8) x),
    'revenue_30d', case when v_fin then (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'amount', amt) order by d), '[]') from (
        select g::date as d, coalesce(sum(case p.kind when 'payment' then p.amount else -p.amount end), 0) as amt
          from generate_series(v_today - 29, v_today, interval '1 day') g
          left join public.payments p on p.business_id = p_business
               and (p.received_at at time zone st.timezone)::date = g::date
         group by g) s) end,
    'load_next_14d', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'bookings', n) order by d), '[]') from (
        select g::date as d, count(b.id) as n
          from generate_series(v_today, v_today + 13, interval '1 day') g
          left join public.bookings b on b.business_id = p_business and b.status not in ('cancelled', 'no_show')
               and (p_branch is null or b.branch_id = p_branch)
               and (b.starts_at at time zone st.timezone)::date = g::date
         group by g) s),
    'popular_services', (select coalesce(jsonb_agg(x), '[]') from (
        select i.name, count(*) as n, case when v_fin then sum(i.line_total) end as revenue
          from public.work_order_items i join public.work_orders o on o.id = i.work_order_id
         where o.business_id = p_business and o.status = 'completed' and o.completed_at >= now() - interval '90 days'
           and i.kind = 'service'
         group by i.name order by n desc limit 6) x),
    'low_stock', (select coalesce(jsonb_agg(x), '[]') from (
        select p.id, p.name, p.sku, coalesce(sum(s.on_hand), 0) as on_hand, p.min_stock
          from public.products p left join public.inventory_stock s on s.product_id = p.id
         where p.business_id = p_business and p.is_active and p.deleted_at is null and p.min_stock > 0
         group by p.id having coalesce(sum(s.on_hand), 0) <= p.min_stock
         order by p.name limit 8) x),
    'storage_ending', (select coalesce(jsonb_agg(x order by x.ends_on), '[]') from (
        select c.id, c.ends_on, t.code, trim(cu.first_name || ' ' || cu.last_name) as customer
          from public.tire_storage_contracts c
          join public.tire_sets t on t.id = c.tire_set_id
          join public.customers cu on cu.id = t.customer_id
         where c.business_id = p_business and c.status = 'active' and c.ends_on <= v_today + 30
         order by c.ends_on limit 8) x),
    -- customers whose last completed order was 5–8 months ago and who have no future booking
    'seasonal_candidates', (select count(*) from public.customers c
        where c.business_id = p_business and c.deleted_at is null and c.anonymized_at is null
          and c.last_visit_at between now() - interval '8 months' and now() - interval '5 months'
          and not exists (select 1 from public.bookings b where b.customer_id = c.id and b.starts_at > now()
                           and b.status in ('pending', 'confirmed')))
  ) into r;
  return r;
end $$;

-- Period analytics for the Analytics page and the AI assistant tools.
create or replace function public.analytics_summary(p_business uuid, p_from date, p_to date, p_branch uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare st public.business_settings%rowtype; v_from timestamptz; v_to timestamptz; r jsonb;
begin
  perform private.require_perm(p_business, 'analytics.view');
  select * into st from public.business_settings where business_id = p_business;
  v_from := p_from::timestamp at time zone st.timezone;
  v_to := (p_to + 1)::timestamp at time zone st.timezone;
  with o as (
    select * from public.work_orders where business_id = p_business and status = 'completed'
       and completed_at >= v_from and completed_at < v_to and (p_branch is null or branch_id = p_branch)
  ), cogs as (
    select coalesce(sum(-m.quantity * coalesce(m.unit_cost, s.avg_cost)), 0) as v
      from public.inventory_movements m
      join o on o.id = m.work_order_id
      left join public.inventory_stock s on s.product_id = m.product_id and s.warehouse_id = m.warehouse_id
     where m.kind = 'order_consumption'
  ), bk as (
    select * from public.bookings where business_id = p_business and starts_at >= v_from and starts_at < v_to
       and (p_branch is null or branch_id = p_branch)
  )
  select jsonb_build_object(
    'revenue', (select coalesce(sum(total), 0) from o),
    'tax', (select coalesce(sum(tax_total), 0) from o),
    'cogs', (select v from cogs),
    'gross_profit', (select coalesce(sum(total - tax_total), 0) from o) - (select v from cogs),
    'orders', (select count(*) from o),
    'avg_ticket', (select coalesce(round(avg(total)), 0) from o),
    'customers_total', (select count(distinct customer_id) from o),
    'customers_new', (select count(distinct o.customer_id) from o join public.customers c on c.id = o.customer_id where c.created_at >= v_from),
    'customers_returning', (select count(distinct o.customer_id) from o join public.customers c on c.id = o.customer_id where c.created_at < v_from),
    'bookings', (select count(*) from bk),
    'cancel_rate', (select coalesce(round(100.0 * count(*) filter (where status = 'cancelled') / nullif(count(*), 0), 1), 0) from bk),
    'no_show_rate', (select coalesce(round(100.0 * count(*) filter (where status = 'no_show') / nullif(count(*), 0), 1), 0) from bk),
    'by_source', (select coalesce(jsonb_object_agg(source, n), '{}') from (select source, count(*) n from bk group by source) s),
    'storage_revenue', (select coalesce(sum(case kind when 'payment' then amount else -amount end), 0) from public.payments
        where business_id = p_business and storage_contract_id is not null and received_at >= v_from and received_at < v_to),
    'hotel_fill_pct', (select coalesce(round(100.0 * sum(occupied_sets) / nullif(sum(capacity_sets), 0), 1), 0)
        from public.storage_locations where business_id = p_business and is_active),
    'by_employee', (select coalesce(jsonb_agg(x), '[]') from (
        select e.first_name || ' ' || e.last_name as name, count(*) as orders, sum(o.total) as revenue,
               round(avg(extract(epoch from o.completed_at - o.started_at) / 60) filter (where o.started_at is not null)) as avg_minutes
          from o join public.employees e on e.id = o.employee_id group by e.id order by revenue desc) x),
    'by_service', (select coalesce(jsonb_agg(x), '[]') from (
        select i.name, count(*) as n, sum(i.line_total) as revenue
          from public.work_order_items i join o on o.id = i.work_order_id
         where i.kind = 'service' and i.approval = 'approved'
         group by i.name order by revenue desc limit 15) x),
    'by_month', (select coalesce(jsonb_agg(x order by x.month), '[]') from (
        select to_char(date_trunc('month', completed_at at time zone st.timezone), 'YYYY-MM') as month,
               sum(total) as revenue, count(*) as orders
          from o group by 1) x),
    'by_weekday', (select coalesce(jsonb_agg(x order by x.dow), '[]') from (
        select extract(isodow from starts_at at time zone st.timezone)::int as dow, count(*) as bookings
          from bk where status not in ('cancelled') group by 1) x)
  ) into r;
  return r;
end $$;

-- What a mechanic needs on the tablet: their orders, no money.
create or replace function public.my_work(p_business uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_perm(p_business, 'orders.work') then raise exception 'forbidden' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(x order by x.created_at), '[]') from (
    select o.id, o.number, o.status, o.created_at, o.damage_notes, o.internal_note,
           v.make, v.model, v.plate, v.rim_diameter, v.has_tpms, v.has_runflat,
           (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'quantity', i.quantity, 'approval', i.approval)), '[]')
              from public.work_order_items i where i.work_order_id = o.id) as items
      from public.work_orders o
      join public.employees e on e.id = o.employee_id
      join public.memberships m on m.id = e.membership_id and m.user_id = auth.uid()
      left join public.vehicles v on v.id = o.vehicle_id
     where o.business_id = p_business and o.status in ('scheduled', 'in_progress', 'awaiting_approval', 'ready')) x);
end $$;

grant execute on function public.dashboard_stats(uuid, uuid) to authenticated;
grant execute on function public.analytics_summary(uuid, date, date, uuid) to authenticated;
grant execute on function public.my_work(uuid) to authenticated;
revoke execute on function public.dashboard_stats(uuid, uuid) from public, anon;
revoke execute on function public.analytics_summary(uuid, date, date, uuid) from public, anon;
revoke execute on function public.my_work(uuid) from public, anon;
