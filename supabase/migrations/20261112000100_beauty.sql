-- Beauty studios (nails, hair, brows, massage, barbers), built on the same engine.
--
-- Additive only; car studios behave exactly as before:
--   * tenants.kind 'beauty'; bookings.car may be empty (required for car studios
--     only, checked in create_booking_ex);
--   * resources are masters or places (chair, cabinet): role, title, bio, photo;
--     a master may have an own weekly shift (custom_hours + resource_hours) and
--     own days off / special hours (resource_exceptions). Studio hours generate
--     the start candidates, the shift of the master narrows them: the service
--     itself (without the cleanup buffer) must fit into one shift interval;
--   * service_addons: options of one service («removal +15 min / +100»). The
--     quote (private.addons_quote) sums price and minutes on the server; the
--     booking snapshots the chosen options with their prices in tire_params
--     (kind = addons), so later price edits never change an agreed booking;
--   * the client picks a master or «any free master» (p_resource null);
--   * public_reschedule_booking: atomic move by the customer's token, inside
--     the cancellation deadline; a failed move leaves the booking untouched;
--   * Telegram: tenants.telegram_chat_id + outbox jobs tg_new / tg_cancel /
--     tg_moved for actions of the customer. Preview studios and demo bookings
--     get jobs in state «skipped» (never sent). The dispatcher is woken at
--     commit (pg_net) and by the per-minute cron;
--   * statistics: upcoming bookings separately, optional filter by master.

alter table public.tenants drop constraint tenants_kind_check;
alter table public.tenants add constraint tenants_kind_check
  check (kind in ('detailing', 'autoservice', 'tireservice', 'carwash', 'beauty'));
alter table public.tenants add column telegram_chat_id text
  check (telegram_chat_id is null or telegram_chat_id ~ '^(-?\d{5,20}|@[A-Za-z0-9_]{5,32})$');
comment on column public.tenants.telegram_chat_id is 'Owner chat for instant Telegram notifications; visible to members only (never in public_get_tenant)';

alter table public.bookings drop constraint bookings_car_check;
alter table public.bookings add constraint bookings_car_check check (char_length(car) <= 80);

alter table public.info_cards drop constraint info_cards_icon_check;
alter table public.info_cards add constraint info_cards_icon_check
  check (icon in ('shield', 'sparkle', 'clock', 'drop', 'car', 'wrench', 'medal', 'sun', 'coffee', 'credit-card',
                  'tire', 'snowflake', 'warehouse', 'spray', 'ticket', 'timer',
                  'scissors', 'hand', 'flower', 'leaf', 'heart', 'eye', 'gift', 'map-pin', 'calendar'));

-- ---------------------------------------------------------------------------
-- Masters: profile and own schedule
-- ---------------------------------------------------------------------------
alter table public.resources
  add column role text not null default 'place' check (role in ('place', 'master')),
  add column title text not null default '' check (char_length(title) <= 60),
  add column bio text not null default '' check (char_length(bio) <= 300),
  add column photo_path text check (photo_path is null or char_length(photo_path) <= 500),
  add column custom_hours boolean not null default false;

create table public.resource_hours (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  resource_id uuid not null,
  weekday smallint not null check (weekday between 1 and 7),
  opens time not null,
  closes time not null,
  check (opens < closes),
  foreign key (tenant_id, resource_id) references public.resources (tenant_id, id) on delete cascade
);
create index resource_hours_resource_idx on public.resource_hours (resource_id, weekday);
create index resource_hours_tenant_idx on public.resource_hours (tenant_id);

create table public.resource_exceptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  resource_id uuid not null,
  day date not null,
  is_closed boolean not null default true,
  opens time,
  closes time,
  note text check (note is null or char_length(note) <= 120),
  source public.content_source not null default 'owner',
  unique (resource_id, day),
  check (is_closed or (opens is not null and closes is not null and opens < closes)),
  foreign key (tenant_id, resource_id) references public.resources (tenant_id, id) on delete cascade
);
create index resource_exceptions_tenant_idx on public.resource_exceptions (tenant_id, day);

-- ---------------------------------------------------------------------------
-- Add-ons of a service
-- ---------------------------------------------------------------------------
create table public.service_addons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  service_id uuid not null,
  key text not null check (key ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  name text not null check (char_length(name) between 2 and 60),
  price int not null check (price between 0 and 1000000),
  duration_minutes int not null check (duration_minutes between 0 and 240),
  is_active boolean not null default true,
  sort int not null default 0,
  source public.content_source not null default 'owner',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_id, key),
  unique (tenant_id, id),
  foreign key (tenant_id, service_id) references public.services (tenant_id, id) on delete cascade
);
create index service_addons_tenant_idx on public.service_addons (tenant_id);
create trigger service_addons_touch before update on public.service_addons
  for each row execute function private.touch_updated_at();

alter table public.resource_hours enable row level security;
alter table public.resource_exceptions enable row level security;
alter table public.service_addons enable row level security;

-- Members manage add-ons and master days off directly (RLS); the weekly shift
-- is replaced as a whole by owner_set_resource_hours.
create policy service_addons_member_all on public.service_addons for all to authenticated
  using (private.is_member(tenant_id)) with check (private.is_member(tenant_id));
create policy resource_exceptions_member_all on public.resource_exceptions for all to authenticated
  using (private.is_member(tenant_id)) with check (private.is_member(tenant_id));
create policy resource_hours_member_select on public.resource_hours for select to authenticated
  using (private.is_member(tenant_id));
grant select, insert, update, delete on public.service_addons, public.resource_exceptions to authenticated;
grant select on public.resource_hours to authenticated;

create trigger service_addons_guard before update on public.service_addons
  for each row execute function private.guard_catalogue_update();
create trigger resource_exceptions_guard before update on public.resource_exceptions
  for each row execute function private.guard_catalogue_update();
create trigger service_addons_owner_insert before insert on public.service_addons
  for each row execute function private.mark_owner_insert();
create trigger resource_exceptions_owner_insert before insert on public.resource_exceptions
  for each row execute function private.mark_owner_insert();
create trigger service_addons_owner_edit after insert or update or delete on public.service_addons
  for each row execute function private.note_owner_edit();
create trigger resource_exceptions_owner_edit after insert or update or delete on public.resource_exceptions
  for each row execute function private.note_owner_edit();

-- ---------------------------------------------------------------------------
-- Does the resource work for the whole service [p_start, p_start + p_minutes)?
-- Studio hours already produced the candidate; this narrows it to the master's
-- own day (exception first, then the weekly shift when custom_hours is on).
-- ---------------------------------------------------------------------------
create or replace function private.resource_works(p_resource uuid, p_start timestamptz, p_minutes int)
returns boolean
language sql stable set search_path = '' as $$
  with r as (
    select res.id, res.custom_hours, t.timezone,
           (p_start at time zone t.timezone) as local_start,
           (p_start at time zone t.timezone)::date as day
    from public.resources res join public.tenants t on t.id = res.tenant_id
    where res.id = p_resource
  ),
  x as (
    select e.* from public.resource_exceptions e, r where e.resource_id = r.id and e.day = r.day
  )
  select case
    when not exists (select 1 from r) then false
    when exists (select 1 from x) then
      exists (select 1 from x, r
              where not x.is_closed
                and r.local_start::time >= x.opens
                and r.local_start + make_interval(mins => p_minutes) <= r.day + x.closes)
    when not (select custom_hours from r) then true
    else exists (
      select 1 from public.resource_hours h, r
      where h.resource_id = r.id and h.weekday = extract(isodow from r.day)
        and r.local_start::time >= h.opens
        and r.local_start + make_interval(mins => p_minutes) <= r.day + h.closes)
  end;
$$;

-- Free suitable resources for a service at a start (any, or only p_resource).
create or replace function private.free_resources_at(
  p_tenant uuid, p_service uuid, p_resource uuid, p_start timestamptz, p_minutes int, p_occ_minutes int
) returns table (resource_id uuid)
language sql stable set search_path = '' as $$
  select e.resource_id
  from private.eligible_resources(p_service) e
  where (p_resource is null or e.resource_id = p_resource)
    and private.resource_open_on(e.resource_id, p_start)
    and private.resource_works(e.resource_id, p_start, p_minutes)
    and not exists (
      select 1 from public.resource_occupancies o
      where o.tenant_id = p_tenant and o.resource_id = e.resource_id
        and o.period && tstzrange(p_start, p_start + make_interval(mins => p_occ_minutes), '[)')
    );
$$;

-- ---------------------------------------------------------------------------
-- Add-on quote: the same rules as addonsQuote() in supabase/functions/_shared/beauty.ts
-- ---------------------------------------------------------------------------
create or replace function private.addons_quote(p_tenant uuid, p_service uuid, p_params jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.services;
  v_keys text[];
  v_items jsonb;
  v_found int;
  v_price int;
  v_minutes int;
begin
  select * into s from public.services where id = p_service and tenant_id = p_tenant and is_active;
  if not found then
    perform private.fail('404', 'SERVICE_NOT_FOUND', 'Услуга не найдена');
  end if;
  if p_params ? 'addons' and jsonb_typeof(p_params -> 'addons') <> 'array' then
    perform private.fail('422', 'INVALID_ADDONS', 'Проверьте выбранные опции');
  end if;
  select coalesce(array_agg(distinct k order by k), '{}') into v_keys
  from jsonb_array_elements_text(coalesce(p_params -> 'addons', '[]'::jsonb)) k;
  if array_length(v_keys, 1) > 10 then
    perform private.fail('422', 'INVALID_ADDONS', 'Слишком много опций');
  end if;

  select count(*), coalesce(sum(a.price), 0), coalesce(sum(a.duration_minutes), 0),
         coalesce(jsonb_agg(jsonb_build_object('key', a.key, 'name', a.name, 'price', a.price,
                                               'duration_minutes', a.duration_minutes) order by a.sort, a.key), '[]'::jsonb)
    into v_found, v_price, v_minutes, v_items
  from public.service_addons a
  where a.tenant_id = p_tenant and a.service_id = s.id and a.is_active and a.key = any(v_keys);
  if v_found <> coalesce(array_length(v_keys, 1), 0) then
    perform private.fail('422', 'ADDON_NOT_FOUND', 'Одна из опций больше недоступна. Выберите заново.');
  end if;

  return jsonb_build_object(
    'kind', 'addons',
    'label', s.name,
    'base_price', s.price,
    'price', s.price + v_price,
    'price_from', s.price_from,
    'on_request', false,
    'base_minutes', s.duration_minutes,
    'duration_minutes', s.duration_minutes + v_minutes,
    'addons', v_items
  );
end $$;

-- One entry point for calculator prices: tyres, wash, or service add-ons.
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
  if p_params ->> 'kind' = 'addons' then
    return private.addons_quote(p_tenant, p_service, p_params);
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
-- Availability for one resource or any suitable one. availability_core keeps
-- its signature (all existing callers) and now also respects master shifts.
-- ---------------------------------------------------------------------------
create or replace function private.availability_v2(
  p_tenant uuid, p_service uuid, p_duration int, p_resource uuid, p_from date, p_days int, p_public boolean
) returns jsonb
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
  if p_resource is not null
     and not exists (select 1 from private.eligible_resources(s.id) e where e.resource_id = p_resource) then
    perform private.fail('422', 'RESOURCE_NOT_SUITABLE', 'Этот мастер не выполняет эту услугу');
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
               'available', exists (select 1 from private.free_resources_at(t.id, s.id, p_resource, c.start_at, v_duration, v_occ))
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
    'resource_id', p_resource,
    'from', v_from,
    'to', v_to,
    'horizon_end', upper(v_window),
    'days', v_days
  );
end $$;

create or replace function private.availability_core(p_tenant uuid, p_service uuid, p_duration int, p_from date, p_days int, p_public boolean)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.availability_v2(p_tenant, p_service, p_duration, null, p_from, p_days, p_public);
$$;

-- Normalised beauty params: sorted unique add-on keys and the master choice.
create or replace function private.beauty_params(p_addons jsonb, p_resource uuid) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'kind', 'addons',
    'addons', coalesce((select jsonb_agg(distinct k order by k)
                        from jsonb_array_elements_text(case when jsonb_typeof(p_addons) = 'array' then p_addons else '[]'::jsonb end) k), '[]'::jsonb),
    'master', p_resource
  );
$$;

create or replace function public.public_get_beauty_availability(
  p_slug text, p_service_id uuid, p_addons jsonb default '[]', p_resource_id uuid default null,
  p_from date default null, p_days int default 7
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  t public.tenants;
  q jsonb;
begin
  t := private.tenant_by_slug(p_slug);
  perform private.enforce_rate_limit('avail:' || private.client_ip(), 120, 60);
  q := private.addons_quote(t.id, p_service_id, private.beauty_params(p_addons, null));
  return private.availability_v2(t.id, p_service_id, (q ->> 'duration_minutes')::int, p_resource_id, p_from, p_days, true)
         || jsonb_build_object('quote', q);
end $$;

-- The assistant: same data, no rate limit (the edge function limits itself).
create or replace function public.svc_beauty_availability(
  p_slug text, p_service_id uuid, p_addons jsonb, p_resource_id uuid, p_from date, p_days int
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  t public.tenants;
  q jsonb;
begin
  t := private.tenant_by_slug(p_slug);
  q := private.addons_quote(t.id, p_service_id, private.beauty_params(p_addons, null));
  return private.availability_v2(t.id, p_service_id, (q ->> 'duration_minutes')::int, p_resource_id, p_from, p_days, true)
         || jsonb_build_object('quote', q);
end $$;

create or replace function public.owner_beauty_availability(
  p_tenant_id uuid, p_service_id uuid, p_addons jsonb, p_resource_id uuid, p_from date, p_days int default 7
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q jsonb;
begin
  perform private.require_member(p_tenant_id);
  q := private.addons_quote(p_tenant_id, p_service_id, private.beauty_params(p_addons, null));
  return private.availability_v2(p_tenant_id, p_service_id, (q ->> 'duration_minutes')::int, p_resource_id, p_from, p_days, false)
         || jsonb_build_object('quote', q);
end $$;

-- ---------------------------------------------------------------------------
-- Booking creation. Changes against the car-wash version:
--   * car is required for car studios only;
--   * kind = addons params (beauty): price/duration from addons_quote, the
--     chosen options and the master choice snapshotted in tire_params;
--   * with the schedule enforced, the resource must work for the whole service
--     (master shifts and days off).
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
  if t.kind <> 'beauty' and char_length(v_car) not between 2 and 80 then
    perform private.fail('422', 'INVALID_CAR', 'Укажите марку и модель автомобиля');
  end if;
  if char_length(v_car) > 80 then
    perform private.fail('422', 'INVALID_CAR', 'Слишком длинное значение');
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
    v_price_from := coalesce((v_quote ->> 'price_from')::boolean, false);
    v_duration := (v_quote ->> 'duration_minutes')::int;
    if v_kind = 'addons' then
      v_params := jsonb_build_object('kind', 'addons', 'addons', v_quote -> 'addons',
                                     'base_price', (v_quote ->> 'base_price')::int,
                                     'base_minutes', (v_quote ->> 'base_minutes')::int,
                                     'master_choice', case when p_resource is null then 'any' else 'specific' end);
    else
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
      perform private.fail('422', 'NOT_A_SLOT', 'Студия не принимает в это время');
    end if;
  end if;

  -- Peak hours limit the public only; the owner can always book.
  if p_source = 'client' and jsonb_array_length(t.peak_hours) > 0
     and not private.online_allowed(p_tenant, p_start_at, upper(v_period)) then
    perform private.fail('409', 'ONLINE_CLOSED', 'В это время запись только на месте, в живую очередь');
  end if;

  if p_resource is not null
     and not exists (select 1 from private.eligible_resources(s.id) e where e.resource_id = p_resource) then
    perform private.fail('422', 'RESOURCE_NOT_SUITABLE', 'Этот мастер или бокс не подходит для услуги');
  end if;

  for v_resource in
    select e.resource_id from private.eligible_resources(s.id) e
    where (p_resource is null or e.resource_id = p_resource)
      and private.resource_open_on(e.resource_id, p_start_at)
      and (not p_enforce_schedule or private.resource_works(e.resource_id, p_start_at, v_duration))
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

create or replace function public.public_create_beauty_booking(
  p_slug text,
  p_service_id uuid,
  p_start_at timestamptz,
  p_resource_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_comment text,
  p_idempotency_key text,
  p_addons jsonb default '[]'
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
  return private.create_booking_ex(t.id, p_service_id, p_start_at, p_resource_id, p_customer_name, p_customer_phone,
                                   '', p_comment, p_idempotency_key, 'client', null, true,
                                   private.beauty_params(p_addons, p_resource_id));
end $$;

create or replace function public.owner_create_beauty_booking(
  p_tenant_id uuid,
  p_service_id uuid,
  p_start_at timestamptz,
  p_resource_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_comment text,
  p_addons jsonb,
  p_idempotency_key text,
  p_respect_schedule boolean default true
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare r jsonb;
begin
  perform private.require_member(p_tenant_id);
  r := private.create_booking_ex(p_tenant_id, p_service_id, p_start_at, p_resource_id, p_customer_name, p_customer_phone,
                                 '', p_comment, p_idempotency_key, 'owner', (select auth.uid()), p_respect_schedule,
                                 private.beauty_params(p_addons, p_resource_id));
  return private.booking_owner_json((r -> 'booking' ->> 'id')::uuid);
end $$;

-- ---------------------------------------------------------------------------
-- Moving a booking. One core for the owner and the customer: the occupancy row
-- is updated in place inside a subtransaction per candidate resource, so the
-- booking either moves in full or stays exactly where it was.
--   p_keep_resource: the customer chose this master, only that one is tried.
-- ---------------------------------------------------------------------------
create or replace function private.reschedule_core(
  p_booking uuid, p_start_at timestamptz, p_resource uuid, p_respect_schedule boolean, p_keep_resource boolean, p_actor uuid
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  b public.bookings;
  t public.tenants;
  v_period tstzrange;
  v_resource uuid;
  v_done boolean := false;
begin
  select * into b from public.bookings where id = p_booking;
  select * into t from public.tenants where id = b.tenant_id;
  v_period := tstzrange(p_start_at, p_start_at + make_interval(mins => b.duration_minutes + b.buffer_minutes), '[)');

  if p_respect_schedule and not exists (
    select 1 from private.slot_candidates(b.tenant_id, b.duration_minutes,
                                          (p_start_at at time zone t.timezone)::date,
                                          (p_start_at at time zone t.timezone)::date) c
    where c.start_at = p_start_at
  ) then
    perform private.fail('422', 'NOT_A_SLOT', 'Студия не принимает в это время');
  end if;

  if p_resource is not null
     and not exists (select 1 from private.eligible_resources(b.service_id) e where e.resource_id = p_resource) then
    perform private.fail('422', 'RESOURCE_NOT_SUITABLE', 'Этот мастер или бокс не подходит для услуги');
  end if;

  -- Prefer the current resource, then the other suitable ones.
  for v_resource in
    select e.resource_id from private.eligible_resources(b.service_id) e
    where (p_resource is null or e.resource_id = p_resource)
      and (not p_keep_resource or e.resource_id = b.resource_id)
      and (not p_respect_schedule or private.resource_works(e.resource_id, p_start_at, b.duration_minutes))
    order by (e.resource_id = b.resource_id) desc
  loop
    begin
      update public.resource_occupancies set resource_id = v_resource, period = v_period
       where booking_id = b.id;
      if not found then
        insert into public.resource_occupancies (tenant_id, resource_id, booking_id, kind, period, created_by)
        values (b.tenant_id, v_resource, b.id, 'booking', v_period, p_actor);
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
      null; -- try the next resource; this subtransaction left the original intact
    end;
  end loop;

  if not v_done then
    perform private.fail('409', 'SLOT_TAKEN', 'Это время занято. Запись осталась на прежнем месте.');
  end if;
  perform private.sync_reminder_jobs(b.id);
end $$;

create or replace function public.owner_reschedule_booking(
  p_booking_id uuid,
  p_start_at timestamptz,
  p_resource_id uuid default null,
  p_respect_schedule boolean default true
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare b public.bookings;
begin
  b := private.lock_owner_booking(p_booking_id);
  if b.status not in ('confirmed', 'arrived') then
    perform private.fail('409', 'CANNOT_RESCHEDULE', 'Перенести можно только активную запись');
  end if;
  perform private.reschedule_core(b.id, p_start_at, p_resource_id, p_respect_schedule, false, (select auth.uid()));
  return private.booking_owner_json(b.id);
end $$;

-- The customer moves their own booking by its token, under the same deadline
-- as an online cancellation. Moving to the current time is a no-op (retry-safe).
create or replace function public.public_reschedule_booking(p_slug text, p_token text, p_start_at timestamptz)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  b public.bookings;
  t public.tenants;
begin
  perform private.enforce_rate_limit('move:' || private.client_ip(), 10, 600);
  b := private.booking_by_token(p_slug, p_token);
  select * into b from public.bookings where id = b.id for update;
  select * into t from public.tenants where id = b.tenant_id;
  if b.status <> 'confirmed' then
    perform private.fail('409', 'CANNOT_RESCHEDULE', 'Эту запись уже нельзя перенести онлайн — позвоните в студию');
  end if;
  if b.start_at = p_start_at then
    return private.public_booking_json(b.id);
  end if;
  if now() >= b.start_at - make_interval(hours => t.cancel_cutoff_hours) then
    perform private.fail('409', 'RESCHEDULE_TOO_LATE',
      format('Перенести онлайн можно не позднее чем за %s ч. Позвоните в студию.', t.cancel_cutoff_hours));
  end if;
  if not (p_start_at <@ private.bookable_window(t.id)) then
    perform private.fail('422', 'OUTSIDE_BOOKING_WINDOW', 'Это время уже недоступно для записи');
  end if;
  if jsonb_array_length(t.peak_hours) > 0
     and not private.online_allowed(t.id, p_start_at, p_start_at + make_interval(mins => b.duration_minutes + b.buffer_minutes)) then
    perform private.fail('409', 'ONLINE_CLOSED', 'В это время запись только на месте');
  end if;
  perform set_config('app.moved_by', 'client', true);
  perform private.reschedule_core(b.id, p_start_at, null, true,
                                  coalesce(b.tire_params ->> 'master_choice', 'any') = 'specific', null);
  return private.public_booking_json(b.id);
end $$;

-- Free start times for moving a booking (same service, duration and master rule).
create or replace function public.public_reschedule_options(p_slug text, p_token text, p_from date default null, p_days int default 7)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  b public.bookings;
  v_keep boolean;
begin
  perform private.enforce_rate_limit('avail:' || private.client_ip(), 120, 60);
  b := private.booking_by_token(p_slug, p_token);
  v_keep := coalesce(b.tire_params ->> 'master_choice', 'any') = 'specific';
  return private.availability_v2(b.tenant_id, b.service_id, b.duration_minutes,
                                 case when v_keep then b.resource_id end, p_from, p_days, true);
end $$;

-- ---------------------------------------------------------------------------
-- Owner: master schedule and notifications
-- ---------------------------------------------------------------------------
create or replace function public.owner_set_resource_hours(
  p_tenant_id uuid, p_resource_id uuid, p_custom boolean, p_hours jsonb
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare h jsonb;
begin
  perform private.require_member(p_tenant_id);
  if not exists (select 1 from public.resources where id = p_resource_id and tenant_id = p_tenant_id) then
    perform private.fail('404', 'RESOURCE_NOT_FOUND', 'Мастер не найден');
  end if;
  if jsonb_typeof(coalesce(p_hours, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_hours, '[]'::jsonb)) > 21 then
    perform private.fail('422', 'INVALID_HOURS', 'Проверьте часы работы');
  end if;
  delete from public.resource_hours where resource_id = p_resource_id;
  for h in select * from jsonb_array_elements(coalesce(p_hours, '[]'::jsonb)) loop
    begin
      insert into public.resource_hours (tenant_id, resource_id, weekday, opens, closes)
      values (p_tenant_id, p_resource_id, (h ->> 'weekday')::smallint, (h ->> 'opens')::time, (h ->> 'closes')::time);
    exception when others then
      perform private.fail('422', 'INVALID_HOURS', 'Проверьте часы работы: открытие раньше закрытия');
    end;
  end loop;
  update public.resources set custom_hours = coalesce(p_custom, false) where id = p_resource_id;
end $$;

create or replace function public.owner_set_telegram(p_tenant_id uuid, p_chat_id text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v text := nullif(btrim(coalesce(p_chat_id, '')), '');
begin
  perform private.require_member(p_tenant_id);
  if v is not null and v !~ '^(-?\d{5,20}|@[A-Za-z0-9_]{5,32})$' then
    perform private.fail('422', 'INVALID_TELEGRAM_CHAT', 'Chat ID: число (например 123456789 или -1001234567890) или @канал');
  end if;
  update public.tenants set telegram_chat_id = v where id = p_tenant_id;
  return public.owner_notification_status(p_tenant_id);
end $$;

-- Honest delivery state for the cabinet: the last Telegram jobs and why.
create or replace function public.owner_notification_status(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_member(p_tenant_id);
  return jsonb_build_object(
    'telegram_chat_id', (select telegram_chat_id from public.tenants where id = p_tenant_id),
    'tenant_status', (select status from public.tenants where id = p_tenant_id),
    'recent', coalesce((
      select jsonb_agg(x order by x.created_at desc) from (
        select j.kind, j.status, j.last_error, j.sent_at, j.created_at
        from public.notification_jobs j
        where j.tenant_id = p_tenant_id and j.kind like 'tg\_%'
        order by j.id desc limit 5
      ) x
    ), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Telegram outbox
-- ---------------------------------------------------------------------------
alter table public.notification_jobs drop constraint notification_jobs_kind_check;
alter table public.notification_jobs add constraint notification_jobs_kind_check
  check (kind in ('reminder_24h', 'tg_new', 'tg_cancel', 'tg_moved'));

-- Reminders only: a cancel or a move must not void the owner's Telegram notices.
create or replace function private.sync_reminder_jobs(p_booking uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v_status public.tenant_status;
  v_run timestamptz;
begin
  select * into b from public.bookings where id = p_booking;
  if not found then return; end if;

  update public.notification_jobs
     set status = 'cancelled', last_error = 'booking changed', lease_until = null
   where booking_id = p_booking and kind = 'reminder_24h' and status in ('pending', 'processing')
     and (b.status <> 'confirmed' or booking_start_at <> b.start_at);

  if b.status <> 'confirmed' then return; end if;
  if not exists (select 1 from public.push_subscriptions where booking_id = p_booking) then return; end if;

  select status into v_status from public.tenants where id = b.tenant_id;
  v_run := b.start_at - interval '24 hours';

  insert into public.notification_jobs (tenant_id, booking_id, kind, run_at, status, dedupe_key, booking_start_at, last_error)
  values (
    b.tenant_id, b.id, 'reminder_24h', greatest(v_run, now()),
    case when v_status <> 'live' or b.is_demo then 'skipped'::public.notification_status
         when v_run < now() then 'skipped'::public.notification_status
         else 'pending'::public.notification_status end,
    'reminder_24h:' || b.id || ':' || extract(epoch from b.start_at)::bigint,
    b.start_at,
    case when v_status <> 'live' or b.is_demo then 'preview: notifications disabled'
         when v_run < now() then 'less than 24h before start' end
  )
  on conflict (dedupe_key) do nothing;
end $$;

create or replace function private.enqueue_telegram(p_booking uuid, p_kind text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  b public.bookings;
  t public.tenants;
  v_skip boolean;
  v_id bigint;
begin
  select * into b from public.bookings where id = p_booking;
  select * into t from public.tenants where id = b.tenant_id;
  if t.telegram_chat_id is null then return; end if;
  v_skip := t.status <> 'live' or b.is_demo;
  insert into public.notification_jobs (tenant_id, booking_id, kind, run_at, status, dedupe_key, booking_start_at, last_error, max_attempts)
  values (b.tenant_id, b.id, p_kind, now(),
          case when v_skip then 'skipped'::public.notification_status else 'pending'::public.notification_status end,
          p_kind || ':' || b.id || case when p_kind = 'tg_moved' then ':' || extract(epoch from b.start_at)::bigint else '' end,
          b.start_at,
          case when v_skip then 'preview: notifications disabled' end,
          8)
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  -- Wake the dispatcher at commit; the per-minute cron is the safety net.
  if v_id is not null and not v_skip then
    begin
      perform private.trigger_notification_dispatch();
    exception when others then
      null; -- pg_net unavailable: cron delivers within a minute
    end;
  end if;
end $$;

create or replace function private.bookings_telegram() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.source = 'client' then
      perform private.enqueue_telegram(new.id, 'tg_new');
    end if;
  elsif new.status = 'cancelled' and old.status <> 'cancelled' and new.cancelled_by = 'client' then
    perform private.enqueue_telegram(new.id, 'tg_cancel');
  elsif new.start_at <> old.start_at and current_setting('app.moved_by', true) = 'client' then
    perform private.enqueue_telegram(new.id, 'tg_moved');
  end if;
  return null;
end $$;
create trigger bookings_telegram after insert or update of status, start_at on public.bookings
  for each row execute function private.bookings_telegram();

-- The claim also carries what a Telegram message needs (service role only).
create or replace function public.svc_claim_notification_jobs(p_worker text, p_limit int default 20, p_lease_seconds int default 120)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v jsonb;
begin
  with due as (
    select j.id from public.notification_jobs j
    where (j.status = 'pending' and j.run_at <= now())
       or (j.status = 'processing' and j.lease_until < now())
    order by j.run_at
    limit p_limit
    for update skip locked
  ), claimed as (
    update public.notification_jobs j
       set status = 'processing', attempts = j.attempts + 1, locked_by = p_worker,
           lease_until = now() + make_interval(secs => p_lease_seconds)
      from due where j.id = due.id
    returning j.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'kind', c.kind, 'attempts', c.attempts, 'max_attempts', c.max_attempts,
    'booking_start_at', c.booking_start_at,
    'booking', jsonb_build_object('id', b.id, 'status', b.status, 'start_at', b.start_at, 'end_at', b.end_at,
                                  'service_name', b.service_name, 'is_demo', b.is_demo, 'price', b.price,
                                  'price_from', b.price_from, 'cancel_reason', b.cancel_reason,
                                  'addons', case when b.tire_params ->> 'kind' = 'addons' then b.tire_params -> 'addons' else '[]'::jsonb end,
                                  'master_choice', b.tire_params ->> 'master_choice',
                                  'resource_name', r.name,
                                  'customer_name', case when c.kind like 'tg\_%' then b.customer_name end,
                                  'customer_phone', case when c.kind like 'tg\_%' then b.customer_phone end,
                                  'comment', case when c.kind like 'tg\_%' then b.comment end),
    'tenant', jsonb_build_object('slug', t.slug, 'name', t.name, 'status', t.status, 'currency', t.currency,
                                 'timezone', t.timezone, 'address', t.address, 'locale', t.locale,
                                 'telegram_chat_id', case when c.kind like 'tg\_%' then t.telegram_chat_id end),
    'subscriptions', case when c.kind = 'reminder_24h' then coalesce((
                       select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
                       from public.push_subscriptions s where s.booking_id = b.id), '[]'::jsonb) else '[]'::jsonb end
  )), '[]'::jsonb) into v
  from claimed c
  join public.bookings b on b.id = c.booking_id
  join public.resources r on r.tenant_id = b.tenant_id and r.id = b.resource_id
  join public.tenants t on t.id = c.tenant_id;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Statistics: upcoming bookings separately; optional filter by master.
-- arrivals / completed / no_show / received never mix with future value.
-- ---------------------------------------------------------------------------
create or replace function private.stats_for(p_tenant uuid, p_period text, p_anchor date, p_resource uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text;
  pb record;
  r jsonb;
begin
  select timezone into v_tz from public.tenants where id = p_tenant;
  select * into pb from private.period_bounds(v_tz, p_period, p_anchor);
  select jsonb_build_object(
    'period', p_period, 'timezone', v_tz, 'resource_id', p_resource,
    'from_date', pb.from_date, 'to_date', pb.to_date, 'from_at', pb.from_at, 'to_at', pb.to_at,
    'bookings', (select count(*) from public.bookings b where b.tenant_id = p_tenant and (p_resource is null or b.resource_id = p_resource)
                   and b.start_at >= pb.from_at and b.start_at < pb.to_at and b.status <> 'cancelled'),
    'upcoming', (select count(*) from public.bookings b where b.tenant_id = p_tenant and (p_resource is null or b.resource_id = p_resource)
                   and b.start_at >= greatest(pb.from_at, now()) and b.start_at < pb.to_at and b.status = 'confirmed'),
    'upcoming_value', coalesce((select sum(price) from public.bookings b where b.tenant_id = p_tenant and (p_resource is null or b.resource_id = p_resource)
                   and b.start_at >= greatest(pb.from_at, now()) and b.start_at < pb.to_at and b.status = 'confirmed'), 0),
    'cancelled', (select count(*) from public.bookings b where b.tenant_id = p_tenant and (p_resource is null or b.resource_id = p_resource)
                   and b.cancelled_at >= pb.from_at and b.cancelled_at < pb.to_at),
    'no_show', (select count(*) from public.bookings b where b.tenant_id = p_tenant and (p_resource is null or b.resource_id = p_resource)
                   and b.status = 'no_show' and b.start_at >= pb.from_at and b.start_at < pb.to_at),
    'arrivals', (select count(*) from public.bookings b where b.tenant_id = p_tenant and (p_resource is null or b.resource_id = p_resource)
                   and b.arrived_at >= pb.from_at and b.arrived_at < pb.to_at),
    'completed', (select count(*) from public.bookings b where b.tenant_id = p_tenant and (p_resource is null or b.resource_id = p_resource)
                   and b.ready_at >= pb.from_at and b.ready_at < pb.to_at),
    'received', coalesce((select sum(p.amount) from public.payments p join public.bookings b on b.id = p.booking_id
                   where p.tenant_id = p_tenant and (p_resource is null or b.resource_id = p_resource)
                   and p.kind = 'payment' and p.paid_at >= pb.from_at and p.paid_at < pb.to_at), 0),
    'refunded', coalesce((select sum(p.amount) from public.payments p join public.bookings b on b.id = p.booking_id
                   where p.tenant_id = p_tenant and (p_resource is null or b.resource_id = p_resource)
                   and p.kind = 'refund' and p.paid_at >= pb.from_at and p.paid_at < pb.to_at), 0),
    'expected_value', coalesce((select sum(price) from public.bookings b where b.tenant_id = p_tenant and (p_resource is null or b.resource_id = p_resource)
                   and b.start_at >= pb.from_at and b.start_at < pb.to_at and b.status not in ('cancelled', 'no_show')), 0)
  ) into r;
  return r || jsonb_build_object('net_received', (r ->> 'received')::bigint - (r ->> 'refunded')::bigint);
end $$;

create or replace function private.stats(p_tenant uuid, p_period text, p_anchor date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.stats_for(p_tenant, p_period, p_anchor, null);
$$;

create or replace function public.owner_stats_for(p_tenant_id uuid, p_period text, p_anchor date, p_resource_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_member(p_tenant_id);
  return private.stats_for(p_tenant_id, p_period, p_anchor, p_resource_id);
end $$;

-- Free windows in a period (owner assistant: «how many free slots this week?»).
-- Counted per service as start times with at least one free suitable resource.
create or replace function private.free_slot_summary(p_tenant uuid, p_period text, p_anchor date, p_resource uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  t public.tenants;
  pb record;
  v_from date;
  v_days int;
  s record;
  a jsonb;
  v_items jsonb := '[]'::jsonb;
begin
  select * into t from public.tenants where id = p_tenant;
  select * into pb from private.period_bounds(t.timezone, p_period, p_anchor);
  v_from := greatest(pb.from_date, (now() at time zone t.timezone)::date);
  v_days := least((pb.to_date - v_from) + 1, 14);
  if v_days < 1 then
    return jsonb_build_object('from_date', pb.from_date, 'to_date', pb.to_date, 'services', '[]'::jsonb);
  end if;
  for s in
    select sv.id, sv.name from public.services sv
    where sv.tenant_id = p_tenant and sv.is_active and sv.duration_minutes < 1440
      and exists (select 1 from private.eligible_resources(sv.id) e where p_resource is null or e.resource_id = p_resource)
    order by sv.sort, sv.name limit 12
  loop
    a := private.availability_v2(p_tenant, s.id, null,
                                 case when exists (select 1 from private.eligible_resources(s.id) e where e.resource_id = p_resource) then p_resource end,
                                 v_from, v_days, false);
    v_items := v_items || jsonb_build_object(
      'service_id', s.id, 'service_name', s.name,
      'free_starts', (select count(*) from jsonb_array_elements(a -> 'days') d, jsonb_array_elements(d -> 'slots') x
                      where (x ->> 'available')::boolean and (x ->> 'start_at')::timestamptz > now()),
      'first_free', (select min((x ->> 'start_at')::timestamptz) from jsonb_array_elements(a -> 'days') d, jsonb_array_elements(d -> 'slots') x
                      where (x ->> 'available')::boolean and (x ->> 'start_at')::timestamptz > now()));
  end loop;
  return jsonb_build_object('from_date', v_from, 'to_date', pb.to_date, 'timezone', t.timezone, 'services', v_items);
end $$;

create or replace function public.owner_free_slot_summary(p_tenant_id uuid, p_period text, p_anchor date, p_resource_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_member(p_tenant_id);
  return private.free_slot_summary(p_tenant_id, p_period, p_anchor, p_resource_id);
end $$;

-- ---------------------------------------------------------------------------
-- Read models
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
        'duration_minutes', s.duration_minutes,
        'resource_ids', (select coalesce(jsonb_agg(e.resource_id), '[]'::jsonb) from private.eligible_resources(s.id) e),
        'addons', coalesce((select jsonb_agg(jsonb_build_object('key', a.key, 'name', a.name, 'price', a.price,
                                                                'duration_minutes', a.duration_minutes) order by a.sort, a.key)
                            from public.service_addons a where a.service_id = s.id and a.is_active), '[]'::jsonb)
      ) order by s.sort, s.name)
      from public.services s
      where s.tenant_id = t.id and s.is_active
        and exists (select 1 from private.eligible_resources(s.id))
    ), '[]'::jsonb),
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'key', r.key, 'name', r.name, 'role', r.role,
                                          'title', r.title, 'bio', r.bio, 'photo_path', r.photo_path) order by r.sort, r.name)
      from public.resources r where r.tenant_id = t.id and r.is_active
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

create or replace function private.public_booking_json(p_booking uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id,
    'status', b.status,
    'service_id', b.service_id,
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
    'resource_role', r.role,
    'is_demo', b.is_demo,
    'cancel_deadline', b.start_at - make_interval(hours => t.cancel_cutoff_hours),
    'can_cancel', b.status = 'confirmed' and now() < b.start_at - make_interval(hours => t.cancel_cutoff_hours),
    'can_reschedule', b.status = 'confirmed' and now() < b.start_at - make_interval(hours => t.cancel_cutoff_hours),
    'cancel_cutoff_hours', t.cancel_cutoff_hours,
    'reminder', (
      select jsonb_build_object('status', j.status, 'run_at', j.run_at, 'note', j.last_error)
      from public.notification_jobs j
      where j.booking_id = b.id and j.booking_start_at = b.start_at and j.kind = 'reminder_24h'
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

-- ---------------------------------------------------------------------------
-- Pipeline: masters, shifts, add-ons and the Telegram chat from business.json
-- ---------------------------------------------------------------------------
alter function public.svc_sync_tenant(jsonb, text, boolean) rename to sync_tenant_wash;
alter function public.sync_tenant_wash(jsonb, text, boolean) set schema private;
revoke execute on function private.sync_tenant_wash(jsonb, text, boolean) from public, anon, authenticated;

create or replace function public.svc_sync_tenant(p_config jsonb, p_config_hash text, p_sync_content boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  r jsonb := private.sync_tenant_wash(p_config, p_config_hash, p_sync_content);
  v_tenant uuid := (r ->> 'tenant_id')::uuid;
  x jsonb;
  s jsonb;
  a jsonb;
  v_res uuid;
  v_service uuid;
  v_idx int;
  v_weekdays constant text[] := array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
begin
  if not (r ->> 'content_synced')::boolean then
    return r;
  end if;

  update public.tenants
     set telegram_chat_id = coalesce(nullif(p_config -> 'notifications' ->> 'telegramChatId', ''), telegram_chat_id)
   where id = v_tenant;

  -- Masters and places: profile, shift and days off from the config.
  for x in select * from jsonb_array_elements(coalesce(p_config -> 'resources', '[]'::jsonb)) loop
    select id into v_res from public.resources
     where tenant_id = v_tenant and key = x ->> 'key' and source = 'config';
    continue when v_res is null;
    update public.resources
       set role = coalesce(x ->> 'role', 'place'),
           title = coalesce(x ->> 'title', ''),
           bio = coalesce(x ->> 'bio', ''),
           photo_path = nullif(x ->> 'photo', ''),
           custom_hours = x ? 'hours'
     where id = v_res;
    delete from public.resource_hours where resource_id = v_res;
    if x ? 'hours' then
      for v_idx in 1..7 loop
        insert into public.resource_hours (tenant_id, resource_id, weekday, opens, closes)
        select v_tenant, v_res, v_idx, (iv ->> 0)::time, (iv ->> 1)::time
        from jsonb_array_elements(coalesce(x -> 'hours' -> v_weekdays[v_idx], '[]'::jsonb)) iv;
      end loop;
    end if;
    delete from public.resource_exceptions where resource_id = v_res and source = 'config';
    insert into public.resource_exceptions (tenant_id, resource_id, day, is_closed, note, source)
    select v_tenant, v_res, d::date, true, null, 'config'
    from jsonb_array_elements_text(coalesce(x -> 'daysOff', '[]'::jsonb)) d
    on conflict (resource_id, day) do nothing;
  end loop;

  -- Add-ons per service (owner-made add-ons stay; removed config ones are hidden).
  for s in select * from jsonb_array_elements(coalesce(p_config -> 'services', '[]'::jsonb)) loop
    select id into v_service from public.services where tenant_id = v_tenant and key = s ->> 'key';
    continue when v_service is null;
    v_idx := 0;
    for a in select * from jsonb_array_elements(coalesce(s -> 'addons', '[]'::jsonb)) loop
      v_idx := v_idx + 1;
      insert into public.service_addons (tenant_id, service_id, key, name, price, duration_minutes, sort, is_active, source)
      values (v_tenant, v_service, a ->> 'key', a ->> 'name', (a ->> 'price')::int, coalesce((a ->> 'minutes')::int, 0), v_idx, true, 'config')
      on conflict (service_id, key) do update
        set name = excluded.name, price = excluded.price, duration_minutes = excluded.duration_minutes,
            sort = excluded.sort, is_active = true
        where public.service_addons.source = 'config';
    end loop;
    update public.service_addons set is_active = false
     where service_id = v_service and source = 'config'
       and key not in (select y ->> 'key' from jsonb_array_elements(coalesce(s -> 'addons', '[]'::jsonb)) y);
  end loop;

  if p_config ->> 'locale' = 'uk-UA' then
    update public.resource_exceptions set note = 'Вихідний' where tenant_id = v_tenant and source = 'config' and note is null;
  elsif p_config ->> 'locale' = 'cs-CZ' then
    update public.resource_exceptions set note = 'Volno' where tenant_id = v_tenant and source = 'config' and note is null;
  elsif p_config ->> 'locale' = 'pl-PL' then
    update public.resource_exceptions set note = 'Wolne' where tenant_id = v_tenant and source = 'config' and note is null;
  else
    update public.resource_exceptions set note = 'Выходной' where tenant_id = v_tenant and source = 'config' and note is null;
  end if;
  return r;
end $$;

-- Demo bookings of a beauty preview: people instead of cars, add-ons included.
alter function public.svc_seed_demo_bookings(text) rename to seed_demo_cars;
alter function public.seed_demo_cars(text) set schema private;
revoke execute on function private.seed_demo_cars(text) from public, anon, authenticated;

create or replace function public.svc_seed_demo_bookings(p_slug text) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  t public.tenants;
  v_today date;
  v_count int := 0;
  v_names text[];
  v_note text;
  v_pay text;
  v_day int;
  v_hour int;
  v_service record;
  v_res jsonb;
  v_booking uuid;
  v_addons jsonb;
  v_start timestamptz;
  v_minutes int;
  v_master uuid;
  i int := 0;
begin
  select * into t from public.tenants where slug = p_slug;
  if not found or t.status <> 'preview' then
    raise exception 'demo bookings only for an existing preview tenant';
  end if;
  if t.kind <> 'beauty' then
    return private.seed_demo_cars(p_slug);
  end if;
  v_names := case t.locale
    when 'uk-UA' then array['Демо: Олена', 'Демо: Ірина', 'Демо: Марія', 'Демо: Оксана', 'Демо: Наталія', 'Демо: Юлія', 'Демо: Катерина', 'Демо: Анна']
    when 'cs-CZ' then array['Demo: Petra', 'Demo: Lucie', 'Demo: Tereza', 'Demo: Kateřina', 'Demo: Jana', 'Demo: Eva', 'Demo: Martina', 'Demo: Anna']
    when 'pl-PL' then array['Demo: Anna', 'Demo: Kasia', 'Demo: Ola', 'Demo: Magda', 'Demo: Ewa', 'Demo: Monika', 'Demo: Asia', 'Demo: Zosia']
    else array['Демо: Анна', 'Демо: Мария', 'Демо: Ольга', 'Демо: Дарья', 'Демо: Екатерина', 'Демо: Ирина', 'Демо: Полина', 'Демо: Алина'] end;
  v_note := case t.locale when 'uk-UA' then 'Демонстраційний запис' when 'cs-CZ' then 'Ukázková rezervace'
                          when 'pl-PL' then 'Rezerwacja demonstracyjna' else 'Демонстрационная запись' end;
  v_pay := case t.locale when 'uk-UA' then 'Демо-оплата' when 'cs-CZ' then 'Ukázková platba'
                         when 'pl-PL' then 'Płatność demo' else 'Демо-оплата' end;
  delete from public.bookings where tenant_id = t.id and is_demo;
  v_today := (now() at time zone t.timezone)::date;

  for v_day in -6..6 loop
    -- two bookings per open day at 11:00 and 15:00, leaving most of the day free
    foreach v_hour in array array[11, 15] loop
      i := i + 1;
      select s.id, s.duration_minutes into v_service
      from public.services s where s.tenant_id = t.id and s.is_active and s.duration_minutes < 600
        and exists (select 1 from private.eligible_resources(s.id))
      order by md5(s.id::text || i::text) limit 1;
      exit when v_service.id is null;
      select coalesce(jsonb_agg(a.key), '[]'::jsonb) into v_addons
      from (select key from public.service_addons where service_id = v_service.id and is_active order by sort limit (i % 2)) a;
      v_start := ((v_today + v_day)::timestamp + make_interval(hours => v_hour)) at time zone t.timezone;
      v_minutes := (private.addons_quote(t.id, v_service.id, private.beauty_params(v_addons, null)) ->> 'duration_minutes')::int;
      -- Past days too, so the schedule is checked here instead of by the booking window:
      -- a real start candidate of the studio and a master whose shift covers the service.
      continue when not exists (select 1 from private.slot_candidates(t.id, v_minutes, v_today + v_day, v_today + v_day) c
                                where c.start_at = v_start);
      select e.resource_id into v_master from private.eligible_resources(v_service.id) e
       where private.resource_works(e.resource_id, v_start, v_minutes)
       order by md5(e.resource_id::text || i::text) limit 1;
      continue when v_master is null;
      begin
        v_res := private.create_booking_ex(
          t.id, v_service.id, v_start, v_master,
          v_names[1 + (i % 8)],
          case t.locale when 'uk-UA' then '+38050000' when 'cs-CZ' then '+42070000' when 'pl-PL' then '+48500000' else '+7900000' end
            || lpad((1000 + i)::text, 4, '0'),
          '', v_note, 'demo-' || t.id || '-' || i, 'demo', null, false,
          private.beauty_params(v_addons, null));
        v_booking := (v_res -> 'booking' ->> 'id')::uuid;
        v_count := v_count + 1;
        if v_day < 0 then
          if i % 7 = 3 then
            update public.bookings set status = 'no_show' where id = v_booking;
            delete from public.resource_occupancies where booking_id = v_booking;
          else
            update public.bookings set status = 'ready', arrived_at = start_at, ready_at = end_at where id = v_booking;
            insert into public.payments (tenant_id, booking_id, kind, amount, method, paid_at, note, idempotency_key)
            select t.id, b.id, 'payment', b.price, case when i % 2 = 0 then 'card' else 'cash' end::public.payment_method,
                   b.end_at, v_pay, 'demo-pay-' || b.id
            from public.bookings b where b.id = v_booking;
          end if;
        end if;
      exception when sqlstate 'PT409' or sqlstate 'PT422' then
        null; -- closed that day, outside a shift or already used by another demo row
      end;
    end loop;
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon;
grant execute on function private.is_member(uuid), private.try_uuid(text) to authenticated;

revoke execute on function
  public.svc_sync_tenant(jsonb, text, boolean),
  public.svc_seed_demo_bookings(text),
  public.svc_claim_notification_jobs(text, int, int),
  public.svc_beauty_availability(text, uuid, jsonb, uuid, date, int)
from public, anon, authenticated;
grant execute on function
  public.svc_sync_tenant(jsonb, text, boolean),
  public.svc_seed_demo_bookings(text),
  public.svc_claim_notification_jobs(text, int, int),
  public.svc_beauty_availability(text, uuid, jsonb, uuid, date, int)
to service_role;

revoke execute on function
  public.public_get_beauty_availability(text, uuid, jsonb, uuid, date, int),
  public.public_create_beauty_booking(text, uuid, timestamptz, uuid, text, text, text, text, jsonb),
  public.public_reschedule_booking(text, text, timestamptz),
  public.public_reschedule_options(text, text, date, int)
from public;
grant execute on function
  public.public_get_beauty_availability(text, uuid, jsonb, uuid, date, int),
  public.public_create_beauty_booking(text, uuid, timestamptz, uuid, text, text, text, text, jsonb),
  public.public_reschedule_booking(text, text, timestamptz),
  public.public_reschedule_options(text, text, date, int)
to anon, authenticated;

revoke execute on function
  public.owner_beauty_availability(uuid, uuid, jsonb, uuid, date, int),
  public.owner_create_beauty_booking(uuid, uuid, timestamptz, uuid, text, text, text, jsonb, text, boolean),
  public.owner_set_resource_hours(uuid, uuid, boolean, jsonb),
  public.owner_set_telegram(uuid, text),
  public.owner_notification_status(uuid),
  public.owner_stats_for(uuid, text, date, uuid),
  public.owner_free_slot_summary(uuid, text, date, uuid)
from public, anon;
grant execute on function
  public.owner_beauty_availability(uuid, uuid, jsonb, uuid, date, int),
  public.owner_create_beauty_booking(uuid, uuid, timestamptz, uuid, text, text, text, jsonb, text, boolean),
  public.owner_set_resource_hours(uuid, uuid, boolean, jsonb),
  public.owner_set_telegram(uuid, text),
  public.owner_notification_status(uuid),
  public.owner_stats_for(uuid, text, date, uuid),
  public.owner_free_slot_summary(uuid, text, date, uuid)
to authenticated, service_role;
