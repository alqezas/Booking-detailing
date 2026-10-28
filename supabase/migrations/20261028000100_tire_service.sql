-- Tyre services (pneuservis / wulkanizacja / шиномонтаж).
--
-- Additive only: every new column is nullable or has a default, existing
-- functions keep their signatures and, for a studio without a tyre matrix,
-- their behaviour:
--   * tenants.kind 'tireservice', tenants.tire_config (price matrix, null for
--     other studios) and tenants.tire_seasons (seasonal periods);
--   * resources.seasonal: a post that takes bookings only inside a season;
--   * bookings.plate / tire_size / tire_source / tire_params;
--   * public.tire_sets — the tyre hotel (stored sets), members only;
--   * private.tire_quote — the server price of a calculator booking, the same
--     rules as supabase/functions/_shared/tire.ts;
--   * private.create_booking → private.create_booking_ex(…, p_tire): the old
--     function is a wrapper with p_tire = null, so nothing else changes;
--   * the booking window is shortened while a season with its own horizon
--     runs, and seasonal posts are free only inside a season.

alter table public.tenants drop constraint tenants_kind_check;
alter table public.tenants add constraint tenants_kind_check check (kind in ('detailing', 'autoservice', 'tireservice'));
alter table public.tenants add column tire_config jsonb check (tire_config is null or jsonb_typeof(tire_config) = 'object');
alter table public.tenants add column tire_seasons jsonb not null default '[]' check (jsonb_typeof(tire_seasons) = 'array');

alter table public.info_cards drop constraint info_cards_icon_check;
alter table public.info_cards add constraint info_cards_icon_check
  check (icon in ('shield', 'sparkle', 'clock', 'drop', 'car', 'wrench', 'medal', 'sun', 'coffee', 'credit-card',
                  'tire', 'snowflake', 'warehouse'));

alter table public.resources add column seasonal boolean not null default false;

alter table public.bookings
  add column plate text check (plate is null or plate ~ '^[A-Z0-9]{2,10}$'),
  add column tire_size text check (tire_size is null or char_length(tire_size) <= 40),
  add column tire_source text check (tire_source is null or tire_source in ('own', 'buy', 'storage')),
  add column tire_params jsonb;
create index bookings_tenant_plate_idx on public.bookings (tenant_id, plate) where plate is not null;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.normalize_plate(p text) returns text
language sql immutable set search_path = '' as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), '');
$$;

-- The season covering a local date. Periods are 'MM-DD'..'MM-DD' and may wrap the year.
create or replace function private.tire_season_on(p_seasons jsonb, p_day date) returns jsonb
language sql immutable set search_path = '' as $$
  select s
  from jsonb_array_elements(case when jsonb_typeof(p_seasons) = 'array' then p_seasons else '[]'::jsonb end) s
  where case when s ->> 'from' <= s ->> 'to'
             then to_char(p_day, 'MM-DD') between s ->> 'from' and s ->> 'to'
             else to_char(p_day, 'MM-DD') >= s ->> 'from' or to_char(p_day, 'MM-DD') <= s ->> 'to' end
  limit 1;
$$;

-- A seasonal post is open only on days inside a season.
create or replace function private.resource_open_on(p_resource uuid, p_at timestamptz) returns boolean
language sql stable set search_path = '' as $$
  select not r.seasonal or private.tire_season_on(t.tire_seasons, (p_at at time zone t.timezone)::date) is not null
  from public.resources r join public.tenants t on t.id = r.tenant_id
  where r.id = p_resource;
$$;

create or replace function private.free_resource_count(p_tenant uuid, p_service uuid, p_period tstzrange)
returns int
language sql stable set search_path = '' as $$
  select count(*)::int
  from private.eligible_resources(p_service) e
  where private.resource_open_on(e.resource_id, lower(p_period))
    and not exists (
      select 1 from public.resource_occupancies o
      where o.tenant_id = p_tenant and o.resource_id = e.resource_id and o.period && p_period
    );
$$;

-- Booking horizon in days today: shorter while a season with its own horizon runs.
create or replace function private.effective_horizon_days(p_tenant uuid) returns int
language sql stable set search_path = '' as $$
  select least(t.horizon_days,
               coalesce((private.tire_season_on(t.tire_seasons, (now() at time zone t.timezone)::date) ->> 'horizonDays')::int,
                        t.horizon_days))
  from public.tenants t where t.id = p_tenant;
$$;

create or replace function private.bookable_window(p_tenant uuid)
returns tstzrange
language sql stable set search_path = '' as $$
  select tstzrange(now() + make_interval(mins => min_lead_minutes),
                   now() + make_interval(days => private.effective_horizon_days(p_tenant)), '[)')
  from public.tenants where id = p_tenant;
$$;

-- ---------------------------------------------------------------------------
-- Price matrix: the same rules as quote() in supabase/functions/_shared/tire.ts
-- ---------------------------------------------------------------------------
create or replace function private.tire_quote(p_tenant uuid, p_service uuid, p_params jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  t public.tenants;
  s public.services;
  op jsonb;
  r jsonb;
  v_vehicle text := p_params ->> 'vehicle';
  v_rim text := p_params ->> 'rim';
  v_d int;
  v_w int;
  v_unit text;
  v_price int;
  v_minutes int;
  v_on_request boolean;
begin
  select * into t from public.tenants where id = p_tenant;
  select * into s from public.services where id = p_service and tenant_id = p_tenant and is_active;
  if not found then
    perform private.fail('404', 'SERVICE_NOT_FOUND', 'Услуга не найдена');
  end if;
  select o into op from jsonb_array_elements(coalesce(t.tire_config -> 'operations', '[]'::jsonb)) o
   where o ->> 'service' = s.key limit 1;
  if op is null then
    perform private.fail('422', 'NOT_A_TIRE_SERVICE', 'Эта услуга считается без калькулятора');
  end if;
  if v_vehicle is null or v_vehicle not in ('car', 'suv', 'van')
     or v_rim is null or v_rim not in ('steel', 'alloy')
     or coalesce(p_params ->> 'diameter', '') !~ '^\d{1,2}$'
     or (p_params ? 'wheels' and coalesce(p_params ->> 'wheels', '') !~ '^\d{1,2}$') then
    perform private.fail('422', 'INVALID_TIRE_PARAMS', 'Выберите тип авто, диски и диаметр');
  end if;
  v_d := (p_params ->> 'diameter')::int;
  v_w := coalesce((p_params ->> 'wheels')::int, (t.tire_config ->> 'defaultWheels')::int, 4);
  if v_d not between 13 and 22 or v_w not between 1 and 8 then
    perform private.fail('422', 'INVALID_TIRE_PARAMS', 'Диаметр R13–R22, от 1 до 8 колёс');
  end if;
  v_unit := coalesce(op ->> 'unit', 'set');

  select x.rw into r
  from jsonb_array_elements(op -> 'rows') with ordinality as x(rw, ord)
  where (x.rw -> 'vehicles' is null or x.rw -> 'vehicles' ? v_vehicle)
    and (x.rw -> 'rims' is null or x.rw -> 'rims' ? v_rim)
    and v_d between (x.rw ->> 'from')::int and (x.rw ->> 'to')::int
  order by x.ord
  limit 1;

  if r is null then
    v_on_request := true;
    v_price := 0;
    v_minutes := greatest(15, s.duration_minutes);
  else
    v_on_request := coalesce(jsonb_typeof(r -> 'price'), 'null') = 'null';
    if v_unit = 'job' then
      v_price := case when v_on_request then 0 else (r ->> 'price')::int end;
      v_minutes := greatest(15, (r ->> 'minutes')::int);
    else
      v_price := case when v_on_request then 0 else round((r ->> 'price')::int * v_w / 4.0)::int end;
      v_minutes := greatest(15, ceil((r ->> 'minutes')::int * v_w / 20.0)::int * 5);
    end if;
  end if;

  return jsonb_build_object(
    'price', v_price,
    'on_request', v_on_request,
    'duration_minutes', v_minutes,
    'wheels', v_w,
    'vehicle', v_vehicle,
    'rim', v_rim,
    'diameter', v_d,
    'label', left(s.name || ' — ' || coalesce(t.tire_config -> 'names' -> 'vehicles' ->> v_vehicle, v_vehicle) || ', '
                  || coalesce(t.tire_config -> 'names' -> 'rims' ->> v_rim, v_rim) || ' R' || v_d
                  || case when v_d >= 22 then '+' else '' end
                  || case when v_unit = 'set' then ', ' || v_w || '×' else '' end, 120)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Availability for an explicit duration (calculator services)
-- ---------------------------------------------------------------------------
create or replace function private.availability_for(p_tenant uuid, p_service uuid, p_duration int, p_from date, p_days int)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  t public.tenants;
  s public.services;
  v_duration int;
  v_occ int;
  v_window tstzrange;
  v_from date;
  v_to date;
  v_days jsonb;
begin
  select * into t from public.tenants where id = p_tenant;
  select * into s from public.services where id = p_service and tenant_id = p_tenant and is_active;
  if not found then
    perform private.fail('404', 'SERVICE_NOT_FOUND', 'Услуга не найдена');
  end if;
  v_duration := coalesce(p_duration, s.duration_minutes);
  v_occ := v_duration + coalesce(s.buffer_minutes, t.default_buffer_minutes);
  v_window := private.bookable_window(t.id);
  v_from := greatest(coalesce(p_from, (now() at time zone t.timezone)::date), (now() at time zone t.timezone)::date);
  v_to := least(v_from + greatest(least(coalesce(p_days, 7), 14), 1) - 1,
                (upper(v_window) at time zone t.timezone)::date);

  select coalesce(jsonb_agg(day_obj order by day), '[]'::jsonb) into v_days
  from (
    select c.day,
           jsonb_build_object(
             'date', c.day,
             'slots', jsonb_agg(jsonb_build_object(
               'start_at', c.start_at,
               'available', private.free_resource_count(t.id, s.id,
                              tstzrange(c.start_at, c.start_at + make_interval(mins => v_occ), '[)')) > 0
             ) order by c.start_at)
           ) as day_obj
    from private.slot_candidates(t.id, v_duration, v_from, v_to) c
    where c.start_at <@ v_window
    group by c.day
  ) d;

  return jsonb_build_object(
    'timezone', t.timezone,
    'service', jsonb_build_object('id', s.id, 'name', s.name, 'duration_minutes', v_duration,
                                  'price', s.price, 'price_from', s.price_from),
    'from', v_from,
    'to', v_to,
    'horizon_end', upper(v_window),
    'days', v_days
  );
end $$;

create or replace function private.availability(p_tenant uuid, p_service uuid, p_from date, p_days int)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.availability_for(p_tenant, p_service, null, p_from, p_days);
$$;

-- ---------------------------------------------------------------------------
-- Booking creation with optional tyre parameters
-- p_tire: {vehicle, rim, diameter, wheels, plate, tire_size, tire_source}
-- ---------------------------------------------------------------------------
create or replace function private.create_booking_ex(
  p_tenant uuid,
  p_service uuid,
  p_start_at timestamptz,
  p_resource uuid,
  p_customer_name text,
  p_customer_phone text,
  p_car text,
  p_comment text,
  p_idempotency_key text,
  p_source text,
  p_created_by uuid,
  p_enforce_schedule boolean,
  p_tire jsonb
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  t public.tenants;
  s public.services;
  v_phone text := private.normalize_phone(p_customer_phone);
  v_name text := btrim(coalesce(p_customer_name, ''));
  v_car text := btrim(coalesce(p_car, ''));
  v_comment text := btrim(coalesce(p_comment, ''));
  v_fingerprint text;
  v_existing public.bookings;
  v_quote jsonb;
  v_service_name text;
  v_price int;
  v_price_from boolean;
  v_duration int;
  v_plate text;
  v_tire_size text;
  v_tire_source text;
  v_occ int;
  v_buffer int;
  v_period tstzrange;
  v_booking uuid;
  v_resource uuid;
  v_token text;
begin
  select * into t from public.tenants where id = p_tenant;

  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,80}$' then
    perform private.fail('422', 'INVALID_IDEMPOTENCY_KEY', 'Обновите страницу и попробуйте снова');
  end if;
  if char_length(v_name) not between 2 and 80 then
    perform private.fail('422', 'INVALID_NAME', 'Укажите имя (от 2 символов)');
  end if;
  if v_phone !~ '^\+\d{10,15}$' then
    perform private.fail('422', 'INVALID_PHONE', 'Телефон в формате +7 999 123-45-67');
  end if;
  if char_length(v_car) not between 2 and 80 then
    perform private.fail('422', 'INVALID_CAR', 'Укажите марку и модель автомобиля');
  end if;
  if char_length(v_comment) > 500 then
    perform private.fail('422', 'INVALID_COMMENT', 'Комментарий слишком длинный');
  end if;

  -- concat_ws skips a null p_tire: plain bookings keep their old fingerprint.
  v_fingerprint := encode(extensions.digest(concat_ws('|', p_service, p_start_at, v_phone, p_tire::text), 'sha256'), 'hex');

  -- Retry of an earlier request: return the same booking and the same token.
  select * into v_existing from public.bookings
   where tenant_id = p_tenant and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      perform private.fail('409', 'IDEMPOTENCY_MISMATCH', 'Этот запрос уже использован для другой записи');
    end if;
    return jsonb_build_object('booking', private.public_booking_json(v_existing.id),
                              'access_token', private.booking_token(v_existing.id, p_idempotency_key),
                              'replayed', true);
  end if;

  select * into s from public.services where id = p_service and tenant_id = p_tenant and is_active;
  if not found then
    perform private.fail('404', 'SERVICE_NOT_FOUND', 'Услуга не найдена или больше не оказывается');
  end if;

  if p_tire is null then
    v_service_name := s.name;
    v_price := s.price;
    v_price_from := s.price_from;
    v_duration := s.duration_minutes;
  else
    v_quote := private.tire_quote(p_tenant, s.id, p_tire);
    v_service_name := v_quote ->> 'label';
    v_price := (v_quote ->> 'price')::int;
    v_price_from := false;
    v_duration := (v_quote ->> 'duration_minutes')::int;
    v_plate := private.normalize_plate(p_tire ->> 'plate');
    if v_plate is null or v_plate !~ '^[A-Z0-9]{2,10}$' then
      perform private.fail('422', 'INVALID_PLATE', 'Укажите госномер (SPZ)');
    end if;
    v_tire_size := nullif(left(btrim(coalesce(p_tire ->> 'tire_size', '')), 40), '');
    v_tire_source := coalesce(nullif(p_tire ->> 'tire_source', ''), 'own');
    if v_tire_source not in ('own', 'buy', 'storage') then
      perform private.fail('422', 'INVALID_TIRE_SOURCE', 'Выберите, чьи шины');
    end if;
  end if;

  v_buffer := coalesce(s.buffer_minutes, t.default_buffer_minutes);
  v_occ := v_duration + v_buffer;
  v_period := tstzrange(p_start_at, p_start_at + make_interval(mins => v_occ), '[)');

  if p_enforce_schedule then
    if not (p_start_at <@ private.bookable_window(p_tenant)) then
      perform private.fail('422', 'OUTSIDE_BOOKING_WINDOW', 'Это время уже недоступно для записи');
    end if;
    if not exists (
      select 1 from private.slot_candidates(p_tenant, v_duration,
                                            (p_start_at at time zone t.timezone)::date,
                                            (p_start_at at time zone t.timezone)::date) c
      where c.start_at = p_start_at
    ) then
      perform private.fail('422', 'NOT_A_SLOT', 'Студия не принимает машины в это время');
    end if;
  end if;

  if p_resource is not null
     and not exists (select 1 from private.eligible_resources(s.id) e where e.resource_id = p_resource) then
    perform private.fail('422', 'RESOURCE_NOT_SUITABLE', 'Этот бокс не подходит для услуги');
  end if;

  for v_resource in
    select e.resource_id from private.eligible_resources(s.id) e
    where (p_resource is null or e.resource_id = p_resource)
      and private.resource_open_on(e.resource_id, p_start_at)
  loop
    begin
      insert into public.bookings (
        tenant_id, service_id, resource_id, start_at, end_at, occupancy_end_at,
        service_name, price, price_from, duration_minutes, buffer_minutes,
        customer_name, customer_phone, car, comment, source, is_demo,
        idempotency_key, request_fingerprint, created_by,
        plate, tire_size, tire_source, tire_params)
      values (
        p_tenant, s.id, v_resource, p_start_at, p_start_at + make_interval(mins => v_duration), upper(v_period),
        v_service_name, v_price, v_price_from, v_duration, v_buffer,
        v_name, v_phone, v_car, v_comment, p_source, t.status = 'preview' or p_source = 'demo',
        p_idempotency_key, v_fingerprint, p_created_by,
        v_plate, v_tire_size, case when p_tire is null then null else v_tire_source end,
        case when p_tire is null then null
             else jsonb_build_object('vehicle', v_quote ->> 'vehicle', 'rim', v_quote ->> 'rim',
                                     'diameter', (v_quote ->> 'diameter')::int, 'wheels', (v_quote ->> 'wheels')::int,
                                     'on_request', (v_quote ->> 'on_request')::boolean) end)
      on conflict (tenant_id, idempotency_key) do nothing
      returning id into v_booking;

      if v_booking is null then
        -- A concurrent request with the same key committed first.
        select * into v_existing from public.bookings
         where tenant_id = p_tenant and idempotency_key = p_idempotency_key;
        if v_existing.request_fingerprint <> v_fingerprint then
          perform private.fail('409', 'IDEMPOTENCY_MISMATCH', 'Этот запрос уже использован для другой записи');
        end if;
        return jsonb_build_object('booking', private.public_booking_json(v_existing.id),
                                  'access_token', private.booking_token(v_existing.id, p_idempotency_key),
                                  'replayed', true);
      end if;

      insert into public.resource_occupancies (tenant_id, resource_id, booking_id, kind, period, created_by)
      values (p_tenant, v_resource, v_booking, 'booking', v_period, p_created_by);
      exit;
    exception when exclusion_violation then
      v_booking := null; -- this bay is taken; the subtransaction rolled back the booking row too
    end;
  end loop;

  if v_booking is null then
    perform private.fail('409', 'SLOT_TAKEN', 'Это время только что заняли. Выберите другое.');
  end if;

  v_token := private.booking_token(v_booking, p_idempotency_key);
  insert into public.booking_access (booking_id, tenant_id, token_hash)
  values (v_booking, p_tenant, private.token_hash(v_token));

  return jsonb_build_object('booking', private.public_booking_json(v_booking),
                            'access_token', v_token,
                            'replayed', false);
end $$;

create or replace function private.create_booking(
  p_tenant uuid,
  p_service uuid,
  p_start_at timestamptz,
  p_resource uuid,
  p_customer_name text,
  p_customer_phone text,
  p_car text,
  p_comment text,
  p_idempotency_key text,
  p_source text,
  p_created_by uuid,
  p_enforce_schedule boolean
) returns jsonb
language sql volatile security definer set search_path = '' as $$
  select private.create_booking_ex(p_tenant, p_service, p_start_at, p_resource, p_customer_name, p_customer_phone,
                                   p_car, p_comment, p_idempotency_key, p_source, p_created_by, p_enforce_schedule, null);
$$;

-- ---------------------------------------------------------------------------
-- Read models: the plate and tyre details travel with the booking.
-- ---------------------------------------------------------------------------
create or replace function private.public_booking_json(p_booking uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id,
    'status', b.status,
    'service_name', b.service_name,
    'price', b.price,
    'price_from', b.price_from,
    'start_at', b.start_at,
    'end_at', b.end_at,
    'duration_minutes', b.duration_minutes,
    'customer_name', b.customer_name,
    'customer_phone', b.customer_phone,
    'car', b.car,
    'comment', b.comment,
    'plate', b.plate,
    'tire_size', b.tire_size,
    'tire_source', b.tire_source,
    'tire_params', b.tire_params,
    'resource_name', r.name,
    'is_demo', b.is_demo,
    'cancel_deadline', b.start_at - make_interval(hours => t.cancel_cutoff_hours),
    'can_cancel', b.status = 'confirmed' and now() < b.start_at - make_interval(hours => t.cancel_cutoff_hours),
    'cancel_cutoff_hours', t.cancel_cutoff_hours,
    'reminder', (
      select jsonb_build_object('status', j.status, 'run_at', j.run_at, 'note', j.last_error)
      from public.notification_jobs j
      where j.booking_id = b.id and j.booking_start_at = b.start_at
      order by j.id desc limit 1
    ),
    'tenant', jsonb_build_object(
      'slug', t.slug, 'name', t.name, 'phone', t.phone, 'address', t.address,
      'map_url', t.map_url, 'timezone', t.timezone, 'currency', t.currency, 'status', t.status
    )
  )
  from public.bookings b
  join public.tenants t on t.id = b.tenant_id
  join public.resources r on r.tenant_id = b.tenant_id and r.id = b.resource_id
  where b.id = p_booking;
$$;

create or replace function private.booking_owner_json(p_booking uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id, 'tenant_id', b.tenant_id, 'status', b.status,
    'service_id', b.service_id, 'service_name', b.service_name,
    'resource_id', b.resource_id, 'resource_name', r.name,
    'start_at', b.start_at, 'end_at', b.end_at, 'occupancy_end_at', b.occupancy_end_at,
    'price', b.price, 'price_from', b.price_from, 'duration_minutes', b.duration_minutes,
    'customer_name', b.customer_name, 'customer_phone', b.customer_phone, 'car', b.car, 'comment', b.comment,
    'plate', b.plate, 'tire_size', b.tire_size, 'tire_source', b.tire_source, 'tire_params', b.tire_params,
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

create or replace function public.public_get_tenant(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.tenants;
begin
  t := private.tenant_by_slug(p_slug);
  return jsonb_build_object(
    'id', t.id,
    'slug', t.slug,
    'status', t.status,
    'kind', t.kind,
    'name', t.name,
    'short_name', t.short_name,
    'tagline', t.tagline,
    'description', t.description,
    'timezone', t.timezone,
    'currency', t.currency,
    'locale', t.locale,
    'accent_color', t.accent_color,
    'phone', t.phone,
    'address', t.address,
    'legal_address', t.legal_address,
    'map_url', t.map_url,
    'lat', t.lat,
    'lng', t.lng,
    'telegram', t.telegram,
    'whatsapp', t.whatsapp,
    'instagram', t.instagram,
    'facebook', t.facebook,
    'tiktok', t.tiktok,
    'email', t.email,
    'logo_path', t.logo_path,
    'hero_path', t.hero_path,
    'assistant_enabled', t.assistant_enabled,
    'faq', t.faq,
    'tire', t.tire_config,
    'tire_seasons', t.tire_seasons,
    'booking', jsonb_build_object(
      'slot_step_minutes', t.slot_step_minutes,
      'min_lead_minutes', t.min_lead_minutes,
      'horizon_days', t.horizon_days,
      'effective_horizon_days', private.effective_horizon_days(t.id),
      'cancel_cutoff_hours', t.cancel_cutoff_hours,
      'default_buffer_minutes', t.default_buffer_minutes
    ),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'key', s.key, 'name', s.name, 'description', s.description,
        'category', s.category, 'price', s.price, 'price_from', s.price_from,
        'duration_minutes', s.duration_minutes) order by s.sort, s.name)
      from public.services s
      where s.tenant_id = t.id and s.is_active
        and exists (select 1 from private.eligible_resources(s.id))
    ), '[]'::jsonb),
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object('weekday', w.weekday, 'opens', to_char(w.opens, 'HH24:MI'),
                                          'closes', to_char(w.closes, 'HH24:MI')) order by w.weekday, w.opens)
      from public.working_hours w where w.tenant_id = t.id
    ), '[]'::jsonb),
    'exceptions', coalesce((
      select jsonb_agg(jsonb_build_object('day', e.day, 'is_closed', e.is_closed,
                                          'opens', to_char(e.opens, 'HH24:MI'), 'closes', to_char(e.closes, 'HH24:MI'),
                                          'note', e.note) order by e.day)
      from public.schedule_exceptions e
      where e.tenant_id = t.id and e.day >= (now() at time zone t.timezone)::date
        and e.day < (now() at time zone t.timezone)::date + 60
    ), '[]'::jsonb),
    'info_cards', coalesce((
      select jsonb_agg(jsonb_build_object('position', c.position, 'icon', c.icon, 'title', c.title, 'text', c.text)
                       order by c.position)
      from public.info_cards c where c.tenant_id = t.id
    ), '[]'::jsonb),
    'gallery', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'image_path', g.image_path, 'before_path', g.before_path,
                                          'caption', g.caption,
                                          'updated_at', g.updated_at) order by g.sort, g.created_at)
      from public.gallery_items g where g.tenant_id = t.id
    ), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Public calculator endpoints
-- ---------------------------------------------------------------------------
create or replace function public.public_get_tire_availability(
  p_slug text, p_service_id uuid, p_params jsonb, p_from date default null, p_days int default 7
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  t public.tenants;
  q jsonb;
begin
  t := private.tenant_by_slug(p_slug);
  perform private.enforce_rate_limit('avail:' || private.client_ip(), 120, 60);
  q := private.tire_quote(t.id, p_service_id, p_params);
  return private.availability_for(t.id, p_service_id, (q ->> 'duration_minutes')::int, p_from, p_days)
         || jsonb_build_object('quote', q);
end $$;

create or replace function public.public_create_tire_booking(
  p_slug text,
  p_service_id uuid,
  p_start_at timestamptz,
  p_customer_name text,
  p_customer_phone text,
  p_car text,
  p_comment text,
  p_idempotency_key text,
  p_tire jsonb
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  t public.tenants;
  v_ip text := private.client_ip();
begin
  t := private.tenant_by_slug(p_slug);
  perform private.enforce_rate_limit('book:ip:' || v_ip, 8, 600);
  perform private.enforce_rate_limit('book:tenant:' || t.id, 120, 3600);
  perform private.enforce_rate_limit('book:phone:' || t.id || ':' || private.normalize_phone(p_customer_phone), 6, 86400);
  if p_tire is null or jsonb_typeof(p_tire) <> 'object' then
    perform private.fail('422', 'INVALID_TIRE_PARAMS', 'Выберите тип авто, диски и диаметр');
  end if;
  return private.create_booking_ex(t.id, p_service_id, p_start_at, null, p_customer_name, p_customer_phone,
                                   p_car, p_comment, p_idempotency_key, 'client', null, true, p_tire);
end $$;

-- ---------------------------------------------------------------------------
-- Tyre hotel
-- ---------------------------------------------------------------------------
create table public.tire_sets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  customer_name text not null check (char_length(customer_name) between 2 and 80),
  customer_phone text not null check (customer_phone ~ '^\+\d{10,15}$'),
  plate text not null check (plate ~ '^[A-Z0-9]{2,10}$'),
  car text not null default '' check (char_length(car) <= 80),
  tire_size text not null default '' check (char_length(tire_size) <= 40),
  season text not null check (season in ('summer', 'winter', 'all')),
  with_rims boolean not null default false,
  tread_mm numeric(3, 1) check (tread_mm is null or tread_mm between 0 and 20),
  condition text not null default '' check (char_length(condition) <= 200),
  location text not null default '' check (char_length(location) <= 40),
  stored_at date not null default current_date,
  released_at date,
  last_contacted_at timestamptz,
  note text not null default '' check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (released_at is null or released_at >= stored_at)
);
create index tire_sets_tenant_idx on public.tire_sets (tenant_id, released_at, season);
create index tire_sets_tenant_plate_idx on public.tire_sets (tenant_id, plate);
create trigger tire_sets_touch before update on public.tire_sets
  for each row execute function private.touch_updated_at();

create or replace function private.tire_set_normalize() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id is immutable' using errcode = 'PT422';
  end if;
  -- Inline (no private.* calls): the trigger runs with the owner's own privileges.
  new.plate := upper(regexp_replace(coalesce(new.plate, ''), '[^A-Za-z0-9]', '', 'g'));
  new.customer_phone := regexp_replace(coalesce(new.customer_phone, ''), '[\s()\-]', '', 'g');
  new.customer_name := btrim(new.customer_name);
  return new;
end $$;
create trigger tire_sets_normalize before insert or update on public.tire_sets
  for each row execute function private.tire_set_normalize();

alter table public.tire_sets enable row level security;
create policy tire_sets_member_all on public.tire_sets for all to authenticated
  using (private.is_member(tenant_id)) with check (private.is_member(tenant_id));
grant select, insert, update, delete on public.tire_sets to authenticated;

-- A customer sees that the studio keeps their set, only with both their phone
-- and their plate; nothing else about the set or other customers is returned.
create or replace function public.public_tire_storage_lookup(p_slug text, p_phone text, p_plate text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare t public.tenants;
begin
  t := private.tenant_by_slug(p_slug);
  perform private.enforce_rate_limit('tirelookup:' || private.client_ip(), 20, 600);
  return coalesce((
    select jsonb_agg(jsonb_build_object('season', s.season, 'tire_size', s.tire_size, 'with_rims', s.with_rims,
                                        'stored_at', s.stored_at) order by s.stored_at desc)
    from public.tire_sets s
    where s.tenant_id = t.id and s.released_at is null
      and s.plate = private.normalize_plate(p_plate)
      and s.customer_phone = private.normalize_phone(p_phone)
  ), '[]'::jsonb);
end $$;

-- Owner list: every set still in storage, with the customer's next booking and
-- whether it is time to call them (their set is for the coming/running season
-- and they have no booking yet).
create or replace function public.owner_tire_sets(p_tenant_id uuid, p_include_released boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  t public.tenants;
  v_today date;
  v_season jsonb;
  v_start date;
  i int;
begin
  perform private.require_member(p_tenant_id);
  select * into t from public.tenants where id = p_tenant_id;
  v_today := (now() at time zone t.timezone)::date;
  -- The running season, or the one starting within 45 days.
  for i in 0..45 loop
    v_season := private.tire_season_on(t.tire_seasons, v_today + i);
    if v_season is not null then
      v_start := v_today + i;
      while v_start > v_today - 366 and private.tire_season_on(jsonb_build_array(v_season), v_start - 1) is not null loop
        v_start := v_start - 1;
      end loop;
      exit;
    end if;
  end loop;

  return jsonb_build_object(
    'today', v_today,
    'season', case when v_season is null then null
                   else v_season || jsonb_build_object('start', v_start) end,
    'sets', coalesce((
      select jsonb_agg(x order by (x ->> 'due')::boolean desc, x ->> 'stored_at' desc)
      from (
        select to_jsonb(s) || jsonb_build_object(
                 'next_booking_at', nb.start_at,
                 'due', s.released_at is null and v_season is not null and s.season = v_season ->> 'mount'
                        and nb.start_at is null
               ) as x
        from public.tire_sets s
        left join lateral (
          select min(b.start_at) as start_at from public.bookings b
          where b.tenant_id = s.tenant_id and b.plate = s.plate and b.status in ('confirmed', 'arrived')
            and b.start_at >= now() - interval '12 hours'
        ) nb on true
        where s.tenant_id = p_tenant_id and (p_include_released or s.released_at is null)
      ) q
    ), '[]'::jsonb)
  );
end $$;

-- Seasons are edited as a whole list.
create or replace function public.owner_set_tire_seasons(p_tenant_id uuid, p_seasons jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare s jsonb;
begin
  perform private.require_member(p_tenant_id);
  if jsonb_typeof(p_seasons) <> 'array' or jsonb_array_length(p_seasons) > 4 then
    perform private.fail('422', 'INVALID_SEASONS', 'Не больше четырёх сезонов');
  end if;
  for s in select * from jsonb_array_elements(p_seasons) loop
    if coalesce(s ->> 'from', '') !~ '^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$'
       or coalesce(s ->> 'to', '') !~ '^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$'
       or coalesce(s ->> 'mount', '') not in ('summer', 'winter')
       or (s ? 'horizonDays' and jsonb_typeof(s -> 'horizonDays') <> 'null'
           and (coalesce(s ->> 'horizonDays', '') !~ '^\d{1,3}$' or (s ->> 'horizonDays')::int not between 1 and 120)) then
      perform private.fail('422', 'INVALID_SEASONS', 'Проверьте даты сезона (ДД.ММ) и горизонт записи (1–120 дней)');
    end if;
  end loop;
  update public.tenants
     set tire_seasons = (select coalesce(jsonb_agg(jsonb_build_object('from', x ->> 'from', 'to', x ->> 'to', 'mount', x ->> 'mount',
                                                                      'horizonDays', (x ->> 'horizonDays')::int)), '[]'::jsonb)
                         from jsonb_array_elements(p_seasons) x),
         owner_edited_at = now()
   where id = p_tenant_id;
  return (select tire_seasons from public.tenants where id = p_tenant_id);
end $$;

-- ---------------------------------------------------------------------------
-- Owner: calculator bookings and the live queue
-- ---------------------------------------------------------------------------
create or replace function public.owner_tire_availability(
  p_tenant_id uuid, p_service_id uuid, p_params jsonb, p_from date, p_days int default 7
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q jsonb;
begin
  perform private.require_member(p_tenant_id);
  q := private.tire_quote(p_tenant_id, p_service_id, p_params);
  return private.availability_for(p_tenant_id, p_service_id, (q ->> 'duration_minutes')::int, p_from, p_days)
         || jsonb_build_object('quote', q);
end $$;

create or replace function public.owner_create_tire_booking(
  p_tenant_id uuid,
  p_service_id uuid,
  p_start_at timestamptz,
  p_customer_name text,
  p_customer_phone text,
  p_car text,
  p_comment text,
  p_tire jsonb,
  p_idempotency_key text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare r jsonb;
begin
  perform private.require_member(p_tenant_id);
  r := private.create_booking_ex(p_tenant_id, p_service_id, p_start_at, null, p_customer_name, p_customer_phone,
                                 p_car, p_comment, p_idempotency_key, 'owner', (select auth.uid()), true, p_tire);
  return private.booking_owner_json((r -> 'booking' ->> 'id')::uuid);
end $$;

-- Walk-in: the earliest start from the current slot on (up to a week ahead)
-- where a suitable post is free for the whole job. Working hours apply; the
-- minimum lead time for online bookings does not.
create or replace function private.walk_in(
  p_tenant uuid,
  p_service uuid,
  p_tire jsonb,
  p_customer_name text,
  p_customer_phone text,
  p_car text,
  p_comment text,
  p_idempotency_key text,
  p_created_by uuid
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  t public.tenants;
  s public.services;
  v_existing uuid;
  v_duration int;
  v_occ int;
  v_today date;
  v_created jsonb;
  c record;
begin
  select * into t from public.tenants where id = p_tenant;
  select id into v_existing from public.bookings where tenant_id = p_tenant and idempotency_key = p_idempotency_key;
  if found then
    return private.booking_owner_json(v_existing); -- replayed tap
  end if;
  select * into s from public.services where id = p_service and tenant_id = p_tenant and is_active;
  if not found then
    perform private.fail('404', 'SERVICE_NOT_FOUND', 'Услуга не найдена');
  end if;
  v_duration := case when p_tire is null then s.duration_minutes
                     else (private.tire_quote(p_tenant, s.id, p_tire) ->> 'duration_minutes')::int end;
  v_occ := v_duration + coalesce(s.buffer_minutes, t.default_buffer_minutes);
  v_today := (now() at time zone t.timezone)::date;

  for c in
    select x.start_at from private.slot_candidates(p_tenant, v_duration, v_today, v_today + 6) x
    where x.start_at > now() - make_interval(mins => t.slot_step_minutes)
    order by x.start_at
  loop
    if private.free_resource_count(p_tenant, s.id, tstzrange(c.start_at, c.start_at + make_interval(mins => v_occ), '[)')) > 0 then
      begin
        -- Two statements: the stable read model must see the row the first one inserted.
        v_created := private.create_booking_ex(
          p_tenant, s.id, c.start_at, null, p_customer_name, p_customer_phone, p_car, p_comment,
          p_idempotency_key, 'owner', p_created_by, false, p_tire);
        return private.booking_owner_json((v_created -> 'booking' ->> 'id')::uuid);
      exception when sqlstate 'PT409' then
        null; -- taken a moment ago by a parallel booking: try the next slot
      end;
    end if;
  end loop;
  perform private.fail('409', 'NO_FREE_SLOT', 'В ближайшую неделю нет свободного поста на эту работу');
  return null;
end $$;

create or replace function public.owner_walk_in(
  p_tenant_id uuid,
  p_service_id uuid,
  p_tire jsonb,
  p_customer_name text,
  p_customer_phone text,
  p_car text,
  p_comment text,
  p_idempotency_key text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.require_member(p_tenant_id);
  return private.walk_in(p_tenant_id, p_service_id, p_tire, p_customer_name, p_customer_phone, p_car, p_comment,
                         p_idempotency_key, (select auth.uid()));
end $$;

-- ---------------------------------------------------------------------------
-- Pipeline: the matrix, seasons and seasonal posts come from business.json
-- ---------------------------------------------------------------------------
create or replace function public.svc_sync_tenant(p_config jsonb, p_config_hash text, p_sync_content boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  r jsonb := private.sync_tenant_core(p_config, p_config_hash, p_sync_content);
  v_tenant uuid := (r ->> 'tenant_id')::uuid;
begin
  if (r ->> 'content_synced')::boolean then
    update public.tenants
       set legal_address = nullif(p_config -> 'contacts' ->> 'legalAddress', ''),
           instagram = nullif(p_config -> 'contacts' ->> 'instagram', ''),
           facebook = nullif(p_config -> 'contacts' ->> 'facebook', ''),
           tiktok = nullif(p_config -> 'contacts' ->> 'tiktok', ''),
           faq = coalesce(p_config -> 'faq', '[]'::jsonb),
           tire_config = case when p_config ? 'tire' then (p_config -> 'tire') - 'seasons' end,
           tire_seasons = coalesce(p_config -> 'tire' -> 'seasons', '[]'::jsonb)
     where id = v_tenant;
    update public.resources res
       set seasonal = coalesce((x ->> 'seasonal')::boolean, false)
      from jsonb_array_elements(coalesce(p_config -> 'resources', '[]'::jsonb)) x
     where res.tenant_id = v_tenant and res.source = 'config' and res.key = x ->> 'key'
       and res.seasonal is distinct from coalesce((x ->> 'seasonal')::boolean, false);
    update public.gallery_items g
       set before_path = nullif(x ->> 'before', '')
      from jsonb_array_elements(coalesce(p_config -> 'gallery', '[]'::jsonb)) x
     where g.tenant_id = v_tenant and g.source = 'config' and g.config_key = x ->> 'image'
       and g.before_path is distinct from nullif(x ->> 'before', '');
    -- Closed dates from the config are labelled in the studio language.
    if p_config ->> 'locale' = 'cs-CZ' then
      update public.schedule_exceptions set note = 'Zavřeno'
       where tenant_id = v_tenant and source = 'config' and note = 'Выходной';
    elsif p_config ->> 'locale' = 'pl-PL' then
      update public.schedule_exceptions set note = 'Zamknięte'
       where tenant_id = v_tenant and source = 'config' and note = 'Выходной';
    elsif p_config ->> 'locale' = 'uk-UA' then
      update public.schedule_exceptions set note = 'Вихідний'
       where tenant_id = v_tenant and source = 'config' and note = 'Выходной';
    end if;
  end if;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- Grants (new functions only; existing grants stay)
-- ---------------------------------------------------------------------------
-- Same sweep as 0500: private functions are callable only from security definer code.
revoke execute on all functions in schema private from public, anon;
grant execute on function private.is_member(uuid), private.try_uuid(text) to authenticated;

grant execute on function
  public.public_get_tire_availability(text, uuid, jsonb, date, int),
  public.public_create_tire_booking(text, uuid, timestamptz, text, text, text, text, text, jsonb),
  public.public_tire_storage_lookup(text, text, text)
to anon, authenticated;

grant execute on function
  public.owner_tire_sets(uuid, boolean),
  public.owner_set_tire_seasons(uuid, jsonb),
  public.owner_tire_availability(uuid, uuid, jsonb, date, int),
  public.owner_create_tire_booking(uuid, uuid, timestamptz, text, text, text, text, jsonb, text),
  public.owner_walk_in(uuid, uuid, jsonb, text, text, text, text, text)
to authenticated;
