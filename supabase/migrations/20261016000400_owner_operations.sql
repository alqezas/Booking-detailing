-- Owner cabinet operations. Every function takes the target row, resolves its
-- tenant on the server and checks membership with private.require_member —
-- a client-sent tenant id is only ever a lookup key, never a grant.

-- ---------------------------------------------------------------------------
-- Periods: one definition shared by the cabinet UI, statistics and the owner
-- assistant, always in the studio's own time zone.
-- ---------------------------------------------------------------------------
create or replace function private.period_bounds(p_tz text, p_period text, p_anchor date)
returns table (from_date date, to_date date, from_at timestamptz, to_at timestamptz)
language plpgsql stable set search_path = '' as $$
declare
  v_anchor date := coalesce(p_anchor, (now() at time zone p_tz)::date);
  v_from date;
  v_to date; -- exclusive
begin
  case p_period
    when 'day' then
      v_from := v_anchor; v_to := v_anchor + 1;
    when 'week' then
      v_from := v_anchor - (extract(isodow from v_anchor)::int - 1); v_to := v_from + 7;
    when 'month' then
      v_from := date_trunc('month', v_anchor)::date; v_to := (date_trunc('month', v_anchor) + interval '1 month')::date;
    else
      perform private.fail('422', 'INVALID_PERIOD', 'Период: day, week или month');
  end case;
  return query select v_from, v_to - 1, (v_from::timestamp at time zone p_tz), (v_to::timestamp at time zone p_tz);
end $$;

create or replace function private.tenant_of_booking(p_booking uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select tenant_id from public.bookings where id = p_booking;
$$;

create or replace function private.lock_owner_booking(p_booking uuid) returns public.bookings
language plpgsql volatile security definer set search_path = '' as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then
    perform private.fail('404', 'BOOKING_NOT_FOUND', 'Запись не найдена');
  end if;
  perform private.require_member(b.tenant_id);
  return b;
end $$;

create or replace function private.booking_owner_json(p_booking uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id, 'tenant_id', b.tenant_id, 'status', b.status,
    'service_id', b.service_id, 'service_name', b.service_name,
    'resource_id', b.resource_id, 'resource_name', r.name,
    'start_at', b.start_at, 'end_at', b.end_at, 'occupancy_end_at', b.occupancy_end_at,
    'price', b.price, 'price_from', b.price_from, 'duration_minutes', b.duration_minutes,
    'customer_name', b.customer_name, 'customer_phone', b.customer_phone, 'car', b.car, 'comment', b.comment,
    'source', b.source, 'is_demo', b.is_demo,
    'arrived_at', b.arrived_at, 'ready_at', b.ready_at, 'cancelled_at', b.cancelled_at,
    'cancelled_by', b.cancelled_by, 'cancel_reason', b.cancel_reason, 'created_at', b.created_at,
    'paid', coalesce(p.paid, 0), 'refunded', coalesce(p.refunded, 0),
    'balance', b.price - coalesce(p.paid, 0) + coalesce(p.refunded, 0),
    'payments', coalesce(p.items, '[]'::jsonb)
  )
  from public.bookings b
  join public.resources r on r.tenant_id = b.tenant_id and r.id = b.resource_id
  left join lateral (
    select sum(amount) filter (where kind = 'payment') as paid,
           sum(amount) filter (where kind = 'refund') as refunded,
           jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'amount', amount, 'method', method,
                                        'paid_at', paid_at, 'note', note) order by paid_at) as items
    from public.payments where booking_id = b.id
  ) p on true
  where b.id = p_booking;
$$;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------
create or replace function public.owner_bookings(p_tenant_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_member(p_tenant_id);
  if p_to <= p_from or p_to - p_from > interval '62 days' then
    perform private.fail('422', 'INVALID_RANGE', 'Слишком большой период');
  end if;
  return coalesce((
    select jsonb_agg(private.booking_owner_json(b.id) order by b.start_at)
    from public.bookings b
    where b.tenant_id = p_tenant_id
      and b.start_at < p_to and b.occupancy_end_at > p_from
  ), '[]'::jsonb);
end $$;

create or replace function public.owner_booking(p_booking_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_member(coalesce(private.tenant_of_booking(p_booking_id), gen_random_uuid()));
  return private.booking_owner_json(p_booking_id);
end $$;

create or replace function public.owner_period(p_tenant_id uuid, p_period text, p_anchor date default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text;
  pb record;
begin
  perform private.require_member(p_tenant_id);
  select timezone into v_tz from public.tenants where id = p_tenant_id;
  select * into pb from private.period_bounds(v_tz, p_period, p_anchor);
  return jsonb_build_object('period', p_period, 'timezone', v_tz, 'from_date', pb.from_date, 'to_date', pb.to_date,
                            'from_at', pb.from_at, 'to_at', pb.to_at);
end $$;

-- Statistics. Three different things that must never be summed together:
--   arrivals   — cars actually accepted (arrived_at in period),
--   completed  — works marked ready (ready_at in period),
--   received   — money actually taken minus refunds (paid_at in period).
-- expected_value is the agreed price of bookings starting in the period; it
-- is a forecast, not revenue.
create or replace function private.stats(p_tenant uuid, p_period text, p_anchor date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text;
  pb record;
  r jsonb;
begin
  select timezone into v_tz from public.tenants where id = p_tenant;
  select * into pb from private.period_bounds(v_tz, p_period, p_anchor);
  select jsonb_build_object(
    'period', p_period, 'timezone', v_tz,
    'from_date', pb.from_date, 'to_date', pb.to_date, 'from_at', pb.from_at, 'to_at', pb.to_at,
    'bookings', (select count(*) from public.bookings b where b.tenant_id = p_tenant
                   and b.start_at >= pb.from_at and b.start_at < pb.to_at and b.status <> 'cancelled'),
    'cancelled', (select count(*) from public.bookings b where b.tenant_id = p_tenant
                   and b.cancelled_at >= pb.from_at and b.cancelled_at < pb.to_at),
    'no_show', (select count(*) from public.bookings b where b.tenant_id = p_tenant and b.status = 'no_show'
                   and b.start_at >= pb.from_at and b.start_at < pb.to_at),
    'arrivals', (select count(*) from public.bookings b where b.tenant_id = p_tenant
                   and b.arrived_at >= pb.from_at and b.arrived_at < pb.to_at),
    'completed', (select count(*) from public.bookings b where b.tenant_id = p_tenant
                   and b.ready_at >= pb.from_at and b.ready_at < pb.to_at),
    'received', coalesce((select sum(amount) from public.payments p where p.tenant_id = p_tenant
                   and p.kind = 'payment' and p.paid_at >= pb.from_at and p.paid_at < pb.to_at), 0),
    'refunded', coalesce((select sum(amount) from public.payments p where p.tenant_id = p_tenant
                   and p.kind = 'refund' and p.paid_at >= pb.from_at and p.paid_at < pb.to_at), 0),
    'expected_value', coalesce((select sum(price) from public.bookings b where b.tenant_id = p_tenant
                   and b.start_at >= pb.from_at and b.start_at < pb.to_at and b.status not in ('cancelled', 'no_show')), 0)
  ) into r;
  return r || jsonb_build_object('net_received', (r ->> 'received')::bigint - (r ->> 'refunded')::bigint);
end $$;

create or replace function public.owner_stats(p_tenant_id uuid, p_period text, p_anchor date default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_member(p_tenant_id);
  return private.stats(p_tenant_id, p_period, p_anchor);
end $$;

create or replace function public.owner_availability(p_tenant_id uuid, p_service_id uuid, p_from date, p_days int default 7)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_member(p_tenant_id);
  return private.availability(p_tenant_id, p_service_id, p_from, p_days);
end $$;

-- ---------------------------------------------------------------------------
-- Booking lifecycle
-- ---------------------------------------------------------------------------
create or replace function public.owner_create_booking(
  p_tenant_id uuid,
  p_service_id uuid,
  p_start_at timestamptz,
  p_customer_name text,
  p_customer_phone text,
  p_car text,
  p_comment text default '',
  p_resource_id uuid default null,
  p_idempotency_key text default null,
  p_respect_schedule boolean default true
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare r jsonb;
begin
  perform private.require_member(p_tenant_id);
  r := private.create_booking(p_tenant_id, p_service_id, p_start_at, p_resource_id, p_customer_name, p_customer_phone,
                              p_car, p_comment, p_idempotency_key, 'owner', (select auth.uid()), p_respect_schedule);
  return private.booking_owner_json((r -> 'booking' ->> 'id')::uuid);
end $$;

-- Atomic move: the occupancy row is updated in place, so either the new range
-- is taken in full or the transaction fails and the original stays untouched.
create or replace function public.owner_reschedule_booking(
  p_booking_id uuid,
  p_start_at timestamptz,
  p_resource_id uuid default null,
  p_respect_schedule boolean default true
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  b public.bookings;
  t public.tenants;
  v_period tstzrange;
  v_resource uuid;
  v_done boolean := false;
begin
  b := private.lock_owner_booking(p_booking_id);
  if b.status not in ('confirmed', 'arrived') then
    perform private.fail('409', 'CANNOT_RESCHEDULE', 'Перенести можно только активную запись');
  end if;
  select * into t from public.tenants where id = b.tenant_id;
  v_period := tstzrange(p_start_at, p_start_at + make_interval(mins => b.duration_minutes + b.buffer_minutes), '[)');

  if p_respect_schedule and not exists (
    select 1 from private.slot_candidates(b.tenant_id, b.duration_minutes,
                                          (p_start_at at time zone t.timezone)::date,
                                          (p_start_at at time zone t.timezone)::date) c
    where c.start_at = p_start_at
  ) then
    perform private.fail('422', 'NOT_A_SLOT', 'Студия не принимает машины в это время');
  end if;

  if p_resource_id is not null
     and not exists (select 1 from private.eligible_resources(b.service_id) e where e.resource_id = p_resource_id) then
    perform private.fail('422', 'RESOURCE_NOT_SUITABLE', 'Этот бокс не подходит для услуги');
  end if;

  -- Prefer the current bay, then the other suitable ones.
  for v_resource in
    select e.resource_id from private.eligible_resources(b.service_id) e
    where p_resource_id is null or e.resource_id = p_resource_id
    order by (e.resource_id = b.resource_id) desc
  loop
    begin
      update public.resource_occupancies set resource_id = v_resource, period = v_period
       where booking_id = b.id;
      if not found then
        insert into public.resource_occupancies (tenant_id, resource_id, booking_id, kind, period, created_by)
        values (b.tenant_id, v_resource, b.id, 'booking', v_period, (select auth.uid()));
      end if;
      update public.bookings
         set start_at = p_start_at,
             end_at = p_start_at + make_interval(mins => b.duration_minutes),
             occupancy_end_at = upper(v_period),
             resource_id = v_resource
       where id = b.id;
      v_done := true;
      exit;
    exception when exclusion_violation then
      null; -- try the next bay; this subtransaction left the original intact
    end;
  end loop;

  if not v_done then
    perform private.fail('409', 'SLOT_TAKEN', 'Это время занято. Запись осталась на прежнем месте.');
  end if;
  perform private.sync_reminder_jobs(b.id);
  return private.booking_owner_json(b.id);
end $$;

create or replace function public.owner_cancel_booking(p_booking_id uuid, p_reason text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare b public.bookings;
begin
  b := private.lock_owner_booking(p_booking_id);
  if b.status = 'cancelled' then
    return private.booking_owner_json(b.id);
  end if;
  if b.status = 'ready' then
    perform private.fail('409', 'CANNOT_CANCEL', 'Работа уже выполнена — отмена невозможна');
  end if;
  perform private.cancel_booking(b.id, 'owner', p_reason);
  return private.booking_owner_json(b.id);
end $$;

create or replace function public.owner_set_booking_status(p_booking_id uuid, p_status public.booking_status)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare b public.bookings;
begin
  b := private.lock_owner_booking(p_booking_id);
  if b.status = p_status then
    return private.booking_owner_json(b.id);
  end if;
  if not (
       (b.status = 'confirmed' and p_status in ('arrived', 'ready', 'no_show'))
    or (b.status = 'arrived' and p_status in ('ready', 'confirmed'))
    or (b.status = 'ready' and p_status = 'arrived')
    or (b.status = 'no_show' and p_status = 'confirmed')
  ) then
    perform private.fail('409', 'INVALID_TRANSITION', 'Нельзя сменить статус таким образом');
  end if;

  if p_status = 'no_show' then
    delete from public.resource_occupancies where booking_id = b.id;
  elsif b.status = 'no_show' then
    begin
      insert into public.resource_occupancies (tenant_id, resource_id, booking_id, kind, period, created_by)
      values (b.tenant_id, b.resource_id, b.id, 'booking', tstzrange(b.start_at, b.occupancy_end_at, '[)'), (select auth.uid()));
    exception when exclusion_violation then
      perform private.fail('409', 'SLOT_TAKEN', 'Время уже занято другой записью');
    end;
  end if;

  update public.bookings set
    status = p_status,
    arrived_at = case when p_status in ('arrived', 'ready') then coalesce(arrived_at, now())
                      when p_status = 'confirmed' then null else arrived_at end,
    ready_at = case when p_status = 'ready' then now() when p_status = 'arrived' then null else ready_at end
  where id = b.id;
  perform private.sync_reminder_jobs(b.id);
  return private.booking_owner_json(b.id);
end $$;

create or replace function public.owner_add_payment(
  p_booking_id uuid,
  p_kind public.payment_kind,
  p_amount int,
  p_method public.payment_method default 'cash',
  p_note text default '',
  p_idempotency_key text default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  b public.bookings;
  v_net bigint;
begin
  b := private.lock_owner_booking(p_booking_id);
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,80}$' then
    perform private.fail('422', 'INVALID_IDEMPOTENCY_KEY', 'Повторите действие');
  end if;
  if exists (select 1 from public.payments where tenant_id = b.tenant_id and idempotency_key = p_idempotency_key) then
    return private.booking_owner_json(b.id); -- replayed request
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 10000000 then
    perform private.fail('422', 'INVALID_AMOUNT', 'Сумма должна быть больше нуля');
  end if;
  if p_kind = 'payment' and b.status = 'cancelled' then
    perform private.fail('409', 'BOOKING_CANCELLED', 'Запись отменена — можно оформить только возврат');
  end if;
  if p_kind = 'refund' then
    select coalesce(sum(case when kind = 'payment' then amount else -amount end), 0) into v_net
    from public.payments where booking_id = b.id;
    if p_amount > v_net then
      perform private.fail('422', 'REFUND_TOO_LARGE', format('Возврат больше полученной суммы (%s)', v_net));
    end if;
  end if;
  insert into public.payments (tenant_id, booking_id, kind, amount, method, note, idempotency_key, created_by)
  values (b.tenant_id, b.id, p_kind, p_amount, p_method, left(btrim(coalesce(p_note, '')), 200),
          p_idempotency_key, (select auth.uid()));
  return private.booking_owner_json(b.id);
end $$;

-- Bay blocks (maintenance, private work) share the occupancy table.
create or replace function public.owner_block_resource(
  p_tenant_id uuid, p_resource_id uuid, p_from timestamptz, p_to timestamptz, p_note text default null
) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.require_member(p_tenant_id);
  if p_to <= p_from then
    perform private.fail('422', 'INVALID_RANGE', 'Окончание должно быть позже начала');
  end if;
  begin
    insert into public.resource_occupancies (tenant_id, resource_id, kind, period, note, created_by)
    values (p_tenant_id, p_resource_id, 'block', tstzrange(p_from, p_to, '[)'), left(p_note, 200), (select auth.uid()))
    returning id into v_id;
  exception
    when exclusion_violation then
      perform private.fail('409', 'SLOT_TAKEN', 'На это время в боксе уже есть запись или блокировка');
    when foreign_key_violation then
      perform private.fail('404', 'RESOURCE_NOT_FOUND', 'Бокс не найден');
  end;
  return v_id;
end $$;

create or replace function public.owner_remove_block(p_occupancy_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.resource_occupancies where id = p_occupancy_id and kind = 'block';
  perform private.require_member(coalesce(v_tenant, gen_random_uuid()));
  delete from public.resource_occupancies where id = p_occupancy_id and kind = 'block';
end $$;

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
create or replace function public.owner_update_tenant(p_tenant_id uuid, p_patch jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  k text;
  allowed text[] := array['name', 'short_name', 'tagline', 'description', 'phone', 'address', 'map_url',
                          'telegram', 'whatsapp', 'email', 'logo_path', 'hero_path', 'accent_color',
                          'slot_step_minutes', 'min_lead_minutes', 'horizon_days', 'cancel_cutoff_hours',
                          'default_buffer_minutes', 'assistant_enabled'];
begin
  perform private.require_member(p_tenant_id);
  for k in select jsonb_object_keys(p_patch) loop
    if not k = any(allowed) then
      perform private.fail('422', 'FIELD_NOT_EDITABLE', format('Поле %s нельзя менять', k));
    end if;
  end loop;
  if p_patch ? 'phone' then
    p_patch := jsonb_set(p_patch, '{phone}', to_jsonb(private.normalize_phone(p_patch ->> 'phone')));
  end if;
  update public.tenants t set
    name = coalesce(p_patch ->> 'name', t.name),
    short_name = case when p_patch ? 'short_name' then nullif(p_patch ->> 'short_name', '') else t.short_name end,
    tagline = coalesce(p_patch ->> 'tagline', t.tagline),
    description = coalesce(p_patch ->> 'description', t.description),
    phone = coalesce(p_patch ->> 'phone', t.phone),
    address = coalesce(p_patch ->> 'address', t.address),
    map_url = case when p_patch ? 'map_url' then nullif(p_patch ->> 'map_url', '') else t.map_url end,
    telegram = case when p_patch ? 'telegram' then nullif(p_patch ->> 'telegram', '') else t.telegram end,
    whatsapp = case when p_patch ? 'whatsapp' then nullif(p_patch ->> 'whatsapp', '') else t.whatsapp end,
    email = case when p_patch ? 'email' then nullif(p_patch ->> 'email', '') else t.email end,
    logo_path = coalesce(p_patch ->> 'logo_path', t.logo_path),
    hero_path = coalesce(p_patch ->> 'hero_path', t.hero_path),
    accent_color = coalesce(p_patch ->> 'accent_color', t.accent_color),
    slot_step_minutes = coalesce((p_patch ->> 'slot_step_minutes')::int, t.slot_step_minutes),
    min_lead_minutes = coalesce((p_patch ->> 'min_lead_minutes')::int, t.min_lead_minutes),
    horizon_days = coalesce((p_patch ->> 'horizon_days')::int, t.horizon_days),
    cancel_cutoff_hours = coalesce((p_patch ->> 'cancel_cutoff_hours')::int, t.cancel_cutoff_hours),
    default_buffer_minutes = coalesce((p_patch ->> 'default_buffer_minutes')::int, t.default_buffer_minutes),
    assistant_enabled = coalesce((p_patch ->> 'assistant_enabled')::boolean, t.assistant_enabled),
    owner_edited_at = now()
  where t.id = p_tenant_id;
  return public.public_get_tenant((select slug from public.tenants where id = p_tenant_id));
exception
  when check_violation then
    perform private.fail('422', 'INVALID_VALUE', 'Проверьте значения: одно из полей заполнено неверно');
    return null;
end $$;

-- Replace the whole week in one transaction. p_hours: [{weekday, opens, closes}]
create or replace function public.owner_set_working_hours(p_tenant_id uuid, p_hours jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.require_member(p_tenant_id);
  if jsonb_typeof(p_hours) <> 'array' or jsonb_array_length(p_hours) > 21 then
    perform private.fail('422', 'INVALID_HOURS', 'Неверный формат графика');
  end if;
  delete from public.working_hours where tenant_id = p_tenant_id;
  insert into public.working_hours (tenant_id, weekday, opens, closes)
  select p_tenant_id, (h ->> 'weekday')::smallint, (h ->> 'opens')::time, (h ->> 'closes')::time
  from jsonb_array_elements(p_hours) h;
  update public.tenants set owner_edited_at = now() where id = p_tenant_id;
exception
  when check_violation or invalid_datetime_format or invalid_text_representation then
    perform private.fail('422', 'INVALID_HOURS', 'Проверьте часы: закрытие должно быть позже открытия');
end $$;

create or replace function public.owner_set_service_resources(p_service_id uuid, p_resource_ids uuid[]) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.services where id = p_service_id;
  perform private.require_member(coalesce(v_tenant, gen_random_uuid()));
  if coalesce(array_length(p_resource_ids, 1), 0) = 0 then
    perform private.fail('422', 'NO_RESOURCES', 'Выберите хотя бы один бокс');
  end if;
  delete from public.service_resources where service_id = p_service_id;
  -- The composite FK rejects a bay from another tenant.
  insert into public.service_resources (tenant_id, service_id, resource_id)
  select v_tenant, p_service_id, unnest(p_resource_ids);
  update public.tenants set owner_edited_at = now() where id = v_tenant;
exception
  when foreign_key_violation then
    perform private.fail('422', 'RESOURCE_NOT_FOUND', 'Бокс не найден');
end $$;

grant execute on function
  public.owner_bookings(uuid, timestamptz, timestamptz),
  public.owner_booking(uuid),
  public.owner_period(uuid, text, date),
  public.owner_stats(uuid, text, date),
  public.owner_availability(uuid, uuid, date, int),
  public.owner_create_booking(uuid, uuid, timestamptz, text, text, text, text, uuid, text, boolean),
  public.owner_reschedule_booking(uuid, timestamptz, uuid, boolean),
  public.owner_cancel_booking(uuid, text),
  public.owner_set_booking_status(uuid, public.booking_status),
  public.owner_add_payment(uuid, public.payment_kind, int, public.payment_method, text, text),
  public.owner_block_resource(uuid, uuid, timestamptz, timestamptz, text),
  public.owner_remove_block(uuid),
  public.owner_update_tenant(uuid, jsonb),
  public.owner_set_working_hours(uuid, jsonb),
  public.owner_set_service_resources(uuid, uuid[])
to authenticated;
