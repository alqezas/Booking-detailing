-- Car washes (ruční mytí / myjnia ręczna / автомойка), built on the tyre-service layer.
--
-- Additive only; studios without a wash price list or peak hours behave as before:
--   * tenants.kind 'carwash', tenants.wash_config (programs by car class + extras,
--     null for other studios), tenants.peak_hours (any studio, default none);
--   * private.priced_quote: one entry point for calculator prices — the tyre
--     matrix (private.tire_quote, unchanged) or the wash price list
--     (private.wash_quote, same rules as supabase/functions/_shared/wash.ts).
--     The tyre RPCs (public_get_tire_availability, public_create_tire_booking,
--     owner_tire_availability, owner_create_tire_booking, owner_walk_in) now
--     price through it, so a wash uses the same endpoints; bookings.tire_params
--     keeps the priced parameters of either kind;
--   * peak hours: during a peak window online booking is closed (walk-ins only)
--     or limited to N parallel online bookings. The owner is never limited;
--   * wash passes: «N washes» sold by the owner to a phone + plate; one wash is
--     taken when a matching booking is marked ready and given back if that is undone.

alter table public.tenants drop constraint tenants_kind_check;
alter table public.tenants add constraint tenants_kind_check check (kind in ('detailing', 'autoservice', 'tireservice', 'carwash'));
alter table public.tenants add column wash_config jsonb check (wash_config is null or jsonb_typeof(wash_config) = 'object');
alter table public.tenants add column peak_hours jsonb not null default '[]' check (jsonb_typeof(peak_hours) = 'array');

alter table public.info_cards drop constraint info_cards_icon_check;
alter table public.info_cards add constraint info_cards_icon_check
  check (icon in ('shield', 'sparkle', 'clock', 'drop', 'car', 'wrench', 'medal', 'sun', 'coffee', 'credit-card',
                  'tire', 'snowflake', 'warehouse', 'spray', 'ticket', 'timer'));

comment on column public.bookings.tire_params is 'Calculator parameters of a priced booking: tyre (vehicle, rim, diameter, wheels) or wash (kind = wash, class, extras)';

-- ---------------------------------------------------------------------------
-- Wash price: the same rules as washQuote() in supabase/functions/_shared/wash.ts
-- ---------------------------------------------------------------------------
create or replace function private.wash_quote(p_tenant uuid, p_service uuid, p_params jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  t public.tenants;
  s public.services;
  prog jsonb;
  r jsonb;
  e record;
  v_class text := p_params ->> 'class';
  v_wanted jsonb := coalesce(p_params -> 'extras', '[]'::jsonb);
  v_price int := 0;
  v_minutes int := 0;
  v_on_request boolean := false;
  v_keys jsonb := '[]'::jsonb;
  v_names text[] := '{}';
begin
  select * into t from public.tenants where id = p_tenant;
  select * into s from public.services where id = p_service and tenant_id = p_tenant and is_active;
  if not found then
    perform private.fail('404', 'SERVICE_NOT_FOUND', 'Услуга не найдена');
  end if;
  select p into prog from jsonb_array_elements(coalesce(t.wash_config -> 'programs', '[]'::jsonb)) p
   where p ->> 'service' = s.key limit 1;
  if prog is null then
    perform private.fail('422', 'NOT_A_PRICED_SERVICE', 'Эта услуга считается без калькулятора');
  end if;
  if v_class is null or v_class not in ('small', 'medium', 'suv', 'van')
     or jsonb_typeof(v_wanted) <> 'array' or jsonb_array_length(v_wanted) > 20 then
    perform private.fail('422', 'INVALID_WASH_PARAMS', 'Выберите класс автомобиля');
  end if;

  r := prog -> 'prices' -> v_class;
  if r is null or jsonb_typeof(r) <> 'object' then
    v_on_request := true;
    v_minutes := s.duration_minutes;
  else
    v_on_request := coalesce(jsonb_typeof(r -> 'price'), 'null') = 'null';
    v_price := coalesce((r ->> 'price')::int, 0);
    v_minutes := (r ->> 'minutes')::int;
  end if;

  -- Known extras allowed with this program, once each, in price-list order.
  for e in
    select x, i from jsonb_array_elements(coalesce(t.wash_config -> 'extras', '[]'::jsonb)) with ordinality as q(x, i)
    where v_wanted ? (x ->> 'key')
      and (x -> 'programs' is null or x -> 'programs' ? s.key)
    order by i
  loop
    r := e.x -> 'prices' -> v_class;
    if r is null or jsonb_typeof(r) <> 'object' or coalesce(jsonb_typeof(r -> 'price'), 'null') = 'null' then
      v_on_request := true;
    end if;
    v_price := v_price + coalesce((r ->> 'price')::int, 0);
    v_minutes := v_minutes + coalesce((r ->> 'minutes')::int, 0);
    v_keys := v_keys || to_jsonb(e.x ->> 'key');
    v_names := v_names || (e.x ->> 'name');
  end loop;

  return jsonb_build_object(
    'kind', 'wash',
    'price', case when v_on_request then 0 else v_price end,
    'on_request', v_on_request,
    'duration_minutes', greatest(15, ceil(v_minutes / 5.0)::int * 5),
    'class', v_class,
    'extras', v_keys,
    'label', left(s.name || ' — ' || coalesce(t.wash_config -> 'classes' ->> v_class, v_class)
                  || case when cardinality(v_names) > 0 then ' + ' || array_to_string(v_names, ', ') else '' end, 120)
  );
end $$;

-- One entry point for calculator prices: the tyre matrix or the wash price list.
create or replace function private.priced_quote(p_tenant uuid, p_service uuid, p_params jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  t public.tenants;
  v_key text;
begin
  select * into t from public.tenants where id = p_tenant;
  select key into v_key from public.services where id = p_service and tenant_id = p_tenant and is_active;
  if v_key is null then
    perform private.fail('404', 'SERVICE_NOT_FOUND', 'Услуга не найдена');
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(t.tire_config -> 'operations', '[]'::jsonb)) o where o ->> 'service' = v_key) then
    return private.tire_quote(p_tenant, p_service, p_params) || jsonb_build_object('kind', 'tire');
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(t.wash_config -> 'programs', '[]'::jsonb)) p where p ->> 'service' = v_key) then
    return private.wash_quote(p_tenant, p_service, p_params);
  end if;
  perform private.fail('422', 'NOT_A_PRICED_SERVICE', 'Эта услуга считается без калькулятора');
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Peak hours: may the PUBLIC book a job starting at p_start (ending at p_end)?
-- The rule is chosen by the local weekday and start time of the job.
-- ---------------------------------------------------------------------------
create or replace function private.online_allowed(p_tenant uuid, p_start timestamptz, p_end timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
           when q.r is null then true
           when q.r ->> 'mode' = 'walkin' then false
           else (select count(*) from public.bookings b
                  where b.tenant_id = p_tenant and b.source = 'client' and b.status in ('confirmed', 'arrived')
                    and b.start_at < p_end and b.occupancy_end_at > p_start) < coalesce((q.r ->> 'posts')::int, 0)
         end
  from (
    select (select x from jsonb_array_elements(t.peak_hours) x
             where x -> 'days' @> to_jsonb(extract(isodow from p_start at time zone t.timezone)::int)
               and to_char(p_start at time zone t.timezone, 'HH24:MI') >= x ->> 'from'
               and to_char(p_start at time zone t.timezone, 'HH24:MI') < x ->> 'to'
             limit 1) as r
    from public.tenants t where t.id = p_tenant
  ) q;
$$;

-- ---------------------------------------------------------------------------
-- Availability with the public flag (peak hours apply to the public only)
-- ---------------------------------------------------------------------------
create or replace function private.availability_core(p_tenant uuid, p_service uuid, p_duration int, p_from date, p_days int, p_public boolean)
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
  v_peaks boolean;
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
  v_peaks := p_public and jsonb_array_length(t.peak_hours) > 0;

  select coalesce(jsonb_agg(day_obj order by day), '[]'::jsonb) into v_days
  from (
    select c.day,
           jsonb_build_object(
             'date', c.day,
             'slots', jsonb_agg(jsonb_build_object(
               'start_at', c.start_at,
               'available', private.free_resource_count(t.id, s.id,
                              tstzrange(c.start_at, c.start_at + make_interval(mins => v_occ), '[)')) > 0
                            and (not v_peaks or private.online_allowed(t.id, c.start_at, c.start_at + make_interval(mins => v_occ)))
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

create or replace function private.availability_for(p_tenant uuid, p_service uuid, p_duration int, p_from date, p_days int)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.availability_core(p_tenant, p_service, p_duration, p_from, p_days, false);
$$;

create or replace function public.public_get_availability(p_slug text, p_service_id uuid, p_from date default null, p_days int default 7)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare t public.tenants;
begin
  t := private.tenant_by_slug(p_slug);
  perform private.enforce_rate_limit('avail:' || private.client_ip(), 120, 60);
  return private.availability_core(t.id, p_service_id, null, p_from, p_days, true);
end $$;

-- The assistant shows what a customer could book online.
create or replace function public.svc_public_availability(p_slug text, p_service_id uuid, p_from date, p_days int)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.tenants;
begin
  t := private.tenant_by_slug(p_slug);
  return private.availability_core(t.id, p_service_id, null, p_from, p_days, true);
end $$;

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
  q := private.priced_quote(t.id, p_service_id, p_params);
  return private.availability_core(t.id, p_service_id, (q ->> 'duration_minutes')::int, p_from, p_days, true)
         || jsonb_build_object('quote', q);
end $$;

create or replace function public.owner_tire_availability(
  p_tenant_id uuid, p_service_id uuid, p_params jsonb, p_from date, p_days int default 7
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q jsonb;
begin
  perform private.require_member(p_tenant_id);
  q := private.priced_quote(p_tenant_id, p_service_id, p_params);
  return private.availability_core(p_tenant_id, p_service_id, (q ->> 'duration_minutes')::int, p_from, p_days, false)
         || jsonb_build_object('quote', q);
end $$;

-- ---------------------------------------------------------------------------
-- Booking creation: priced through private.priced_quote; peak hours for the public
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
  v_kind text;
  v_service_name text;
  v_price int;
  v_price_from boolean;
  v_duration int;
  v_plate text;
  v_tire_size text;
  v_tire_source text;
  v_params jsonb;
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
    v_quote := private.priced_quote(p_tenant, s.id, p_tire);
    v_kind := v_quote ->> 'kind';
    v_service_name := v_quote ->> 'label';
    v_price := (v_quote ->> 'price')::int;
    v_price_from := false;
    v_duration := (v_quote ->> 'duration_minutes')::int;
    v_plate := private.normalize_plate(p_tire ->> 'plate');
    -- A tyre booking always needs the plate; a wash only when the studio asks for it.
    if (v_kind = 'tire' or coalesce((t.wash_config ->> 'plateRequired')::boolean, false)) and v_plate is null then
      perform private.fail('422', 'INVALID_PLATE', 'Укажите госномер (SPZ)');
    end if;
    if v_plate is not null and v_plate !~ '^[A-Z0-9]{2,10}$' then
      perform private.fail('422', 'INVALID_PLATE', 'Укажите госномер (SPZ)');
    end if;
    v_tire_size := nullif(left(btrim(coalesce(p_tire ->> 'tire_size', '')), 40), '');
    if v_kind = 'tire' then
      v_tire_source := coalesce(nullif(p_tire ->> 'tire_source', ''), 'own');
      if v_tire_source not in ('own', 'buy', 'storage') then
        perform private.fail('422', 'INVALID_TIRE_SOURCE', 'Выберите, чьи шины');
      end if;
      v_params := jsonb_build_object('vehicle', v_quote ->> 'vehicle', 'rim', v_quote ->> 'rim',
                                     'diameter', (v_quote ->> 'diameter')::int, 'wheels', (v_quote ->> 'wheels')::int,
                                     'on_request', (v_quote ->> 'on_request')::boolean);
    else
      v_tire_size := null;
      v_params := jsonb_build_object('kind', 'wash', 'class', v_quote ->> 'class', 'extras', v_quote -> 'extras',
                                     'on_request', (v_quote ->> 'on_request')::boolean);
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

  -- Peak hours limit the public only; the owner can always book.
  if p_source = 'client' and jsonb_array_length(t.peak_hours) > 0
     and not private.online_allowed(p_tenant, p_start_at, upper(v_period)) then
    perform private.fail('409', 'ONLINE_CLOSED', 'В это время запись только на месте, в живую очередь');
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
        v_plate, v_tire_size, v_tire_source, v_params)
      on conflict (tenant_id, idempotency_key) do nothing
      returning id into v_booking;

      if v_booking is null then
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
      v_booking := null;
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

-- Walk-ins price through the same entry point (tyres or wash).
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
    return private.booking_owner_json(v_existing);
  end if;
  select * into s from public.services where id = p_service and tenant_id = p_tenant and is_active;
  if not found then
    perform private.fail('404', 'SERVICE_NOT_FOUND', 'Услуга не найдена');
  end if;
  v_duration := case when p_tire is null then s.duration_minutes
                     else (private.priced_quote(p_tenant, s.id, p_tire) ->> 'duration_minutes')::int end;
  v_occ := v_duration + coalesce(s.buffer_minutes, t.default_buffer_minutes);
  v_today := (now() at time zone t.timezone)::date;

  for c in
    select x.start_at from private.slot_candidates(p_tenant, v_duration, v_today, v_today + 6) x
    where x.start_at > now() - make_interval(mins => t.slot_step_minutes)
    order by x.start_at
  loop
    if private.free_resource_count(p_tenant, s.id, tstzrange(c.start_at, c.start_at + make_interval(mins => v_occ), '[)')) > 0 then
      begin
        v_created := private.create_booking_ex(
          p_tenant, s.id, c.start_at, null, p_customer_name, p_customer_phone, p_car, p_comment,
          p_idempotency_key, 'owner', p_created_by, false, p_tire);
        return private.booking_owner_json((v_created -> 'booking' ->> 'id')::uuid);
      exception when sqlstate 'PT409' then
        null;
      end;
    end if;
  end loop;
  perform private.fail('409', 'NO_FREE_SLOT', 'В ближайшую неделю нет свободного поста на эту работу');
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Wash passes
-- ---------------------------------------------------------------------------
create table public.wash_passes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  customer_name text not null check (char_length(customer_name) between 2 and 80),
  customer_phone text not null check (customer_phone ~ '^\+\d{10,15}$'),
  plate text not null check (plate ~ '^[A-Z0-9]{2,10}$'),
  -- null = any program
  service_id uuid,
  total int not null check (total between 1 and 100),
  price int check (price is null or price between 0 and 10000000),
  sold_at date not null default current_date,
  expires_at date,
  note text not null default '' check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, service_id) references public.services (tenant_id, id) on delete restrict,
  check (expires_at is null or expires_at >= sold_at)
);
create index wash_passes_tenant_phone_idx on public.wash_passes (tenant_id, customer_phone);
create trigger wash_passes_touch before update on public.wash_passes
  for each row execute function private.touch_updated_at();

create or replace function private.wash_pass_normalize() returns trigger
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
create trigger wash_passes_normalize before insert or update on public.wash_passes
  for each row execute function private.wash_pass_normalize();

create table public.wash_pass_uses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  pass_id uuid not null,
  booking_id uuid not null unique,
  used_at timestamptz not null default now(),
  foreign key (tenant_id, pass_id) references public.wash_passes (tenant_id, id) on delete cascade,
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade
);
create index wash_pass_uses_pass_idx on public.wash_pass_uses (pass_id);

alter table public.wash_passes enable row level security;
alter table public.wash_pass_uses enable row level security;
create policy wash_passes_member_all on public.wash_passes for all to authenticated
  using (private.is_member(tenant_id)) with check (private.is_member(tenant_id));
create policy wash_pass_uses_member_select on public.wash_pass_uses for select to authenticated
  using (private.is_member(tenant_id));
grant select, insert, update, delete on public.wash_passes to authenticated;
grant select on public.wash_pass_uses to authenticated;

-- A ready booking takes one wash from the customer's pass (same phone and
-- plate, matching program, not expired, washes left; the soonest-expiring
-- first). Undoing «ready» gives it back.
create or replace function private.wash_pass_on_status() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_pass uuid;
  v_tz text;
begin
  if new.status = 'ready' and old.status <> 'ready' and new.plate is not null
     and not exists (select 1 from public.wash_pass_uses where booking_id = new.id) then
    select timezone into v_tz from public.tenants where id = new.tenant_id;
    select p.id into v_pass
    from public.wash_passes p
    where p.tenant_id = new.tenant_id and p.customer_phone = new.customer_phone and p.plate = new.plate
      and (p.service_id is null or p.service_id = new.service_id)
      and (p.expires_at is null or p.expires_at >= (now() at time zone v_tz)::date)
      and p.total > (select count(*) from public.wash_pass_uses u where u.pass_id = p.id)
    order by p.expires_at nulls last, p.sold_at, p.created_at
    limit 1
    for update;
    if v_pass is not null then
      insert into public.wash_pass_uses (tenant_id, pass_id, booking_id) values (new.tenant_id, v_pass, new.id);
    end if;
  elsif old.status = 'ready' and new.status <> 'ready' then
    delete from public.wash_pass_uses where booking_id = new.id;
  end if;
  return null;
end $$;
create trigger bookings_wash_pass after update of status on public.bookings
  for each row when (old.status is distinct from new.status and (new.status = 'ready' or old.status = 'ready'))
  execute function private.wash_pass_on_status();

-- The customer sees the washes left, only with both phone and plate.
create or replace function public.public_wash_pass_lookup(p_slug text, p_phone text, p_plate text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare t public.tenants;
begin
  t := private.tenant_by_slug(p_slug);
  perform private.enforce_rate_limit('passlookup:' || private.client_ip(), 20, 600);
  return coalesce((
    select jsonb_agg(jsonb_build_object('service_name', s.name, 'total', p.total,
                                        'remaining', p.total - (select count(*) from public.wash_pass_uses u where u.pass_id = p.id),
                                        'expires_at', p.expires_at) order by p.expires_at nulls last)
    from public.wash_passes p
    left join public.services s on s.tenant_id = p.tenant_id and s.id = p.service_id
    where p.tenant_id = t.id
      and p.plate = private.normalize_plate(p_plate)
      and p.customer_phone = private.normalize_phone(p_phone)
      and (p.expires_at is null or p.expires_at >= (now() at time zone t.timezone)::date)
      and p.total > (select count(*) from public.wash_pass_uses u where u.pass_id = p.id)
  ), '[]'::jsonb);
end $$;

create or replace function public.owner_wash_passes(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_member(p_tenant_id);
  return coalesce((
    select jsonb_agg(to_jsonb(p) || jsonb_build_object(
             'service_name', s.name,
             'used', coalesce(u.n, 0),
             'remaining', p.total - coalesce(u.n, 0),
             'last_used_at', u.last_at)
           order by (p.total - coalesce(u.n, 0) > 0) desc, p.sold_at desc)
    from public.wash_passes p
    left join public.services s on s.tenant_id = p.tenant_id and s.id = p.service_id
    left join lateral (select count(*)::int as n, max(used_at) as last_at from public.wash_pass_uses where pass_id = p.id) u on true
    where p.tenant_id = p_tenant_id
  ), '[]'::jsonb);
end $$;

-- Owner read model: which pass paid for the booking, and what is left on it.
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
    'pass', (select jsonb_build_object('pass_id', u.pass_id, 'total', wp.total,
                                       'remaining', wp.total - (select count(*) from public.wash_pass_uses x where x.pass_id = u.pass_id))
             from public.wash_pass_uses u join public.wash_passes wp on wp.id = u.pass_id
             where u.booking_id = b.id),
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
-- Peak hours: edited as a whole list
-- ---------------------------------------------------------------------------
create or replace function public.owner_set_peak_hours(p_tenant_id uuid, p_rules jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare r jsonb;
begin
  perform private.require_member(p_tenant_id);
  if jsonb_typeof(p_rules) <> 'array' or jsonb_array_length(p_rules) > 10 then
    perform private.fail('422', 'INVALID_PEAK_HOURS', 'Не больше десяти правил');
  end if;
  for r in select * from jsonb_array_elements(p_rules) loop
    if jsonb_typeof(r -> 'days') <> 'array' or jsonb_array_length(r -> 'days') = 0
       or exists (select 1 from jsonb_array_elements(r -> 'days') d where d::text !~ '^[1-7]$')
       or coalesce(r ->> 'from', '') !~ '^(?:[01]\d|2[0-3]):[0-5]\d$'
       or coalesce(r ->> 'to', '') !~ '^(?:[01]\d|2[0-3]):[0-5]\d$'
       or r ->> 'from' >= r ->> 'to'
       or coalesce(r ->> 'mode', '') not in ('walkin', 'limit')
       or (r ->> 'mode' = 'limit' and (coalesce(r ->> 'posts', '') !~ '^\d{1,2}$' or (r ->> 'posts')::int not between 1 and 20)) then
      perform private.fail('422', 'INVALID_PEAK_HOURS', 'Проверьте дни, время (ЧЧ:ММ, «с» раньше «до») и число постов');
    end if;
  end loop;
  update public.tenants
     set peak_hours = (select coalesce(jsonb_agg(jsonb_build_object(
                         'days', x -> 'days', 'from', x ->> 'from', 'to', x ->> 'to', 'mode', x ->> 'mode',
                         'posts', case when x ->> 'mode' = 'limit' then (x ->> 'posts')::int end)), '[]'::jsonb)
                       from jsonb_array_elements(p_rules) x),
         owner_edited_at = now()
   where id = p_tenant_id;
  return (select peak_hours from public.tenants where id = p_tenant_id);
end $$;

-- ---------------------------------------------------------------------------
-- Public card and the pipeline
-- ---------------------------------------------------------------------------
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
    'wash', t.wash_config,
    'peak_hours', t.peak_hours,
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
           tire_seasons = coalesce(p_config -> 'tire' -> 'seasons', '[]'::jsonb),
           wash_config = p_config -> 'wash',
           peak_hours = coalesce(p_config -> 'booking' -> 'peakHours', '[]'::jsonb)
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
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon;
grant execute on function private.is_member(uuid), private.try_uuid(text) to authenticated;

grant execute on function public.public_wash_pass_lookup(text, text, text) to anon, authenticated;
grant execute on function
  public.owner_wash_passes(uuid),
  public.owner_set_peak_hours(uuid, jsonb)
to authenticated;
