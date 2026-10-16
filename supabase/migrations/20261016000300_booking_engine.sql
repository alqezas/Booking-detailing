-- Availability and the public (no-account) booking flow.
--
-- Model: a service occupies ONE suitable bay for one continuous range
--   [start, start + duration + buffer)
-- which may span several days. Working hours only decide when a car can be
-- accepted: a start must be a slot inside an open interval of its local day,
-- and a service shorter than a day must also finish before that interval
-- closes. Occupancy is stored in resource_occupancies, whose EXCLUDE
-- constraint is the single arbiter of conflicts — two concurrent requests for
-- the same bay and time cannot both commit.

-- ---------------------------------------------------------------------------
-- Errors: PostgREST maps SQLSTATE PTxyz to HTTP status xyz. The message is a
-- stable machine code; the hint is the human text shown in the UI.
-- ---------------------------------------------------------------------------
create or replace function private.fail(p_status text, p_code text, p_hint text) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception '%', p_code using errcode = 'PT' || p_status, hint = p_hint;
end $$;

-- ---------------------------------------------------------------------------
-- Rate limiting: one atomic upsert per hit on a fixed window counter.
-- ---------------------------------------------------------------------------
create or replace function private.client_ip() returns text
language plpgsql stable set search_path = '' as $$
declare
  h json;
  ip text;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    h := null;
  end;
  ip := coalesce(h ->> 'cf-connecting-ip', split_part(h ->> 'x-forwarded-for', ',', 1), h ->> 'x-real-ip');
  return coalesce(nullif(trim(ip), ''), 'unknown');
end $$;

create or replace function private.rate_limit_hit(p_key text, p_limit int, p_window_seconds int) returns boolean
language sql volatile security definer set search_path = '' as $$
  insert into private.rate_counters as rc (key, window_start, hits)
  values (p_key, to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds), 1)
  on conflict (key, window_start) do update set hits = rc.hits + 1
  returning rc.hits <= p_limit;
$$;

create or replace function private.enforce_rate_limit(p_key text, p_limit int, p_window_seconds int) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.rate_limit_hit(p_key, p_limit, p_window_seconds) then
    perform private.fail('429', 'RATE_LIMITED', 'Слишком много запросов. Попробуйте через несколько минут.');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Slot generation
-- ---------------------------------------------------------------------------
create or replace function private.service_occupancy_minutes(p_service uuid) returns int
language sql stable set search_path = '' as $$
  select s.duration_minutes + coalesce(s.buffer_minutes, t.default_buffer_minutes)
  from public.services s join public.tenants t on t.id = s.tenant_id
  where s.id = p_service;
$$;

-- Every possible start for a service of p_duration minutes between two local
-- dates (inclusive), in the tenant's time zone. DST is handled by
-- "local timestamp AT TIME ZONE tz".
create or replace function private.slot_candidates(p_tenant uuid, p_duration int, p_from date, p_to date)
returns table (day date, start_at timestamptz)
language sql stable set search_path = '' as $$
  with t as (
    select timezone, slot_step_minutes as step from public.tenants where id = p_tenant
  ),
  days as (
    select g::date as day from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g
  ),
  intervals as (
    select d.day,
           (extract(epoch from coalesce(ex.opens, wh.opens)) / 60)::int as open_min,
           (extract(epoch from coalesce(ex.closes, wh.closes)) / 60)::int as close_min
    from days d
    left join public.schedule_exceptions ex on ex.tenant_id = p_tenant and ex.day = d.day
    left join public.working_hours wh
           on wh.tenant_id = p_tenant and ex.id is null and wh.weekday = extract(isodow from d.day)
    where not coalesce(ex.is_closed, false)
      and coalesce(ex.opens, wh.opens) is not null
  )
  select i.day, ((i.day::timestamp + make_interval(mins => m)) at time zone t.timezone) as start_at
  from intervals i
  cross join t
  cross join lateral generate_series(i.open_min, i.close_min - 1, t.step) as m
  where p_duration >= 1440 or m + p_duration <= i.close_min
  order by 2;
$$;

-- Bays that can take the service, in a stable preference order.
create or replace function private.eligible_resources(p_service uuid)
returns table (resource_id uuid)
language sql stable set search_path = '' as $$
  select r.id
  from public.service_resources sr
  join public.resources r on r.tenant_id = sr.tenant_id and r.id = sr.resource_id
  where sr.service_id = p_service and r.is_active
  order by r.sort, r.name, r.id;
$$;

create or replace function private.free_resource_count(p_tenant uuid, p_service uuid, p_period tstzrange)
returns int
language sql stable set search_path = '' as $$
  select count(*)::int
  from private.eligible_resources(p_service) e
  where not exists (
    select 1 from public.resource_occupancies o
    where o.tenant_id = p_tenant and o.resource_id = e.resource_id and o.period && p_period
  );
$$;

-- Starts the public may book: not earlier than now + lead, inside the horizon.
create or replace function private.bookable_window(p_tenant uuid)
returns tstzrange
language sql stable set search_path = '' as $$
  select tstzrange(now() + make_interval(mins => min_lead_minutes),
                   now() + make_interval(days => horizon_days), '[)')
  from public.tenants where id = p_tenant;
$$;

-- ---------------------------------------------------------------------------
-- Booking capability tokens
-- ---------------------------------------------------------------------------
-- Deterministic per (booking, idempotency key): a retried request with the
-- same key gets the same token back, while the database only stores its hash.
create or replace function private.booking_token(p_booking uuid, p_idempotency_key text) returns text
language sql stable security definer set search_path = '' as $$
  select rtrim(translate(encode(extensions.hmac(
           p_booking::text || ':' || p_idempotency_key,
           (select value from private.app_secrets where name = 'booking_token_hmac'),
           'sha256'), 'base64'), '+/', '-_'), '=');
$$;

create or replace function private.token_hash(p_token text) returns bytea
language sql immutable set search_path = '' as $$
  select extensions.digest(p_token, 'sha256');
$$;

-- ---------------------------------------------------------------------------
-- Notification outbox helpers (used by every booking state change)
-- ---------------------------------------------------------------------------
create or replace function private.sync_reminder_jobs(p_booking uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v_status public.tenant_status;
  v_run timestamptz;
begin
  select * into b from public.bookings where id = p_booking;
  if not found then return; end if;

  -- Any pending reminder for a different start (or a cancelled booking) is void.
  update public.notification_jobs
     set status = 'cancelled', last_error = 'booking changed', lease_until = null
   where booking_id = p_booking and status in ('pending', 'processing')
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

-- ---------------------------------------------------------------------------
-- Public read models
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

create or replace function private.tenant_by_slug(p_slug text) returns public.tenants
language plpgsql stable security definer set search_path = '' as $$
declare t public.tenants;
begin
  select * into t from public.tenants where slug = lower(p_slug) and status in ('preview', 'live');
  if not found then
    perform private.fail('404', 'TENANT_NOT_FOUND', 'Студия не найдена');
  end if;
  return t;
end $$;

-- Everything the public page needs, in one cacheable call. Contains no
-- personal data: no bookings, no customers, no payments.
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
    'map_url', t.map_url,
    'lat', t.lat,
    'lng', t.lng,
    'telegram', t.telegram,
    'whatsapp', t.whatsapp,
    'email', t.email,
    'logo_path', t.logo_path,
    'hero_path', t.hero_path,
    'assistant_enabled', t.assistant_enabled,
    'booking', jsonb_build_object(
      'slot_step_minutes', t.slot_step_minutes,
      'min_lead_minutes', t.min_lead_minutes,
      'horizon_days', t.horizon_days,
      'cancel_cutoff_hours', t.cancel_cutoff_hours
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
      select jsonb_agg(jsonb_build_object('id', g.id, 'image_path', g.image_path, 'caption', g.caption,
                                          'updated_at', g.updated_at) order by g.sort, g.created_at)
      from public.gallery_items g where g.tenant_id = t.id
    ), '[]'::jsonb)
  );
end $$;

-- Slots for one service over up to 14 local days. Taken slots are returned
-- with available = false so the UI can show them explicitly.
create or replace function private.availability(p_tenant uuid, p_service uuid, p_from date, p_days int)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  t public.tenants;
  s public.services;
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
  v_occ := private.service_occupancy_minutes(s.id);
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
    from private.slot_candidates(t.id, s.duration_minutes, v_from, v_to) c
    where c.start_at <@ v_window
    group by c.day
  ) d;

  return jsonb_build_object(
    'timezone', t.timezone,
    'service', jsonb_build_object('id', s.id, 'name', s.name, 'duration_minutes', s.duration_minutes,
                                  'price', s.price, 'price_from', s.price_from),
    'from', v_from,
    'to', v_to,
    'horizon_end', upper(v_window),
    'days', v_days
  );
end $$;

create or replace function public.public_get_availability(p_slug text, p_service_id uuid, p_from date default null, p_days int default 7)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare t public.tenants;
begin
  t := private.tenant_by_slug(p_slug);
  perform private.enforce_rate_limit('avail:' || private.client_ip(), 120, 60);
  return private.availability(t.id, p_service_id, p_from, p_days);
end $$;

-- ---------------------------------------------------------------------------
-- Booking creation (shared by the public flow and the owner cabinet)
-- ---------------------------------------------------------------------------
create or replace function private.normalize_phone(p text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(coalesce(p, ''), '[\s()\-]', '', 'g');
$$;

create or replace function private.create_booking(
  p_tenant uuid,
  p_service uuid,
  p_start_at timestamptz,
  p_resource uuid,          -- null = any suitable bay
  p_customer_name text,
  p_customer_phone text,
  p_car text,
  p_comment text,
  p_idempotency_key text,
  p_source text,
  p_created_by uuid,
  p_enforce_schedule boolean
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

  v_fingerprint := encode(extensions.digest(concat_ws('|', p_service, p_start_at, v_phone), 'sha256'), 'hex');

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

  v_buffer := coalesce(s.buffer_minutes, t.default_buffer_minutes);
  v_occ := s.duration_minutes + v_buffer;
  v_period := tstzrange(p_start_at, p_start_at + make_interval(mins => v_occ), '[)');

  if p_enforce_schedule then
    if not (p_start_at <@ private.bookable_window(p_tenant)) then
      perform private.fail('422', 'OUTSIDE_BOOKING_WINDOW', 'Это время уже недоступно для записи');
    end if;
    if not exists (
      select 1 from private.slot_candidates(p_tenant, s.duration_minutes,
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
    where p_resource is null or e.resource_id = p_resource
  loop
    begin
      insert into public.bookings (
        tenant_id, service_id, resource_id, start_at, end_at, occupancy_end_at,
        service_name, price, price_from, duration_minutes, buffer_minutes,
        customer_name, customer_phone, car, comment, source, is_demo,
        idempotency_key, request_fingerprint, created_by)
      values (
        p_tenant, s.id, v_resource, p_start_at, p_start_at + make_interval(mins => s.duration_minutes), upper(v_period),
        s.name, s.price, s.price_from, s.duration_minutes, v_buffer,
        v_name, v_phone, v_car, v_comment, p_source, t.status = 'preview' or p_source = 'demo',
        p_idempotency_key, v_fingerprint, p_created_by)
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

create or replace function public.public_create_booking(
  p_slug text,
  p_service_id uuid,
  p_start_at timestamptz,
  p_customer_name text,
  p_customer_phone text,
  p_car text,
  p_comment text default '',
  p_idempotency_key text default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  t public.tenants;
  v_ip text := private.client_ip();
begin
  t := private.tenant_by_slug(p_slug);
  perform private.enforce_rate_limit('book:ip:' || v_ip, 8, 600);
  -- Per-studio ceiling: holds even if a client forges its forwarding headers.
  perform private.enforce_rate_limit('book:tenant:' || t.id, 120, 3600);
  perform private.enforce_rate_limit('book:phone:' || t.id || ':' || private.normalize_phone(p_customer_phone), 6, 86400);
  return private.create_booking(t.id, p_service_id, p_start_at, null, p_customer_name, p_customer_phone,
                                p_car, p_comment, p_idempotency_key, 'client', null, true);
end $$;

-- ---------------------------------------------------------------------------
-- Customer access by token
-- ---------------------------------------------------------------------------
create or replace function private.booking_by_token(p_slug text, p_token text) returns public.bookings
language plpgsql stable security definer set search_path = '' as $$
declare b public.bookings;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{40,64}$' then
    perform private.fail('404', 'BOOKING_NOT_FOUND', 'Запись не найдена');
  end if;
  select b2.* into b
  from public.booking_access a
  join public.bookings b2 on b2.id = a.booking_id and b2.tenant_id = a.tenant_id
  join public.tenants t on t.id = a.tenant_id
  where a.token_hash = private.token_hash(p_token) and t.slug = lower(p_slug);
  if not found then
    perform private.fail('404', 'BOOKING_NOT_FOUND', 'Запись не найдена');
  end if;
  return b;
end $$;

create or replace function public.public_get_booking(p_slug text, p_token text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare b public.bookings;
begin
  perform private.enforce_rate_limit('lookup:' || private.client_ip(), 60, 600);
  b := private.booking_by_token(p_slug, p_token);
  return private.public_booking_json(b.id);
end $$;

create or replace function private.cancel_booking(p_booking uuid, p_by text, p_reason text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = p_by,
         cancel_reason = nullif(left(btrim(coalesce(p_reason, '')), 300), '')
   where id = p_booking;
  delete from public.resource_occupancies where booking_id = p_booking;
  perform private.sync_reminder_jobs(p_booking);
end $$;

create or replace function public.public_cancel_booking(p_slug text, p_token text, p_reason text default null)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  b public.bookings;
  v_cutoff int;
begin
  perform private.enforce_rate_limit('cancel:' || private.client_ip(), 10, 600);
  b := private.booking_by_token(p_slug, p_token);
  -- Lock the row so a concurrent owner action cannot interleave.
  select * into b from public.bookings where id = b.id for update;
  if b.status = 'cancelled' then
    return private.public_booking_json(b.id); -- idempotent
  end if;
  select cancel_cutoff_hours into v_cutoff from public.tenants where id = b.tenant_id;
  if b.status <> 'confirmed' then
    perform private.fail('409', 'CANNOT_CANCEL', 'Машина уже в работе — отмена через студию по телефону');
  end if;
  if now() >= b.start_at - make_interval(hours => v_cutoff) then
    perform private.fail('409', 'CANCEL_TOO_LATE',
      format('Отменить онлайн можно не позднее чем за %s ч. Позвоните в студию.', v_cutoff));
  end if;
  perform private.cancel_booking(b.id, 'client', p_reason);
  return private.public_booking_json(b.id);
end $$;

-- Web Push subscription for one booking (customer, by token).
create or replace function public.public_save_push_subscription(
  p_slug text, p_token text, p_endpoint text, p_p256dh text, p_auth text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare b public.bookings;
begin
  perform private.enforce_rate_limit('push:' || private.client_ip(), 20, 600);
  b := private.booking_by_token(p_slug, p_token);
  if p_endpoint !~ '^https://' or char_length(p_endpoint) > 1000
     or coalesce(char_length(p_p256dh), 0) not between 20 and 200
     or coalesce(char_length(p_auth), 0) not between 8 and 100 then
    perform private.fail('422', 'INVALID_SUBSCRIPTION', 'Браузер вернул неверную подписку');
  end if;
  insert into public.push_subscriptions (tenant_id, booking_id, endpoint, p256dh, auth)
  values (b.tenant_id, b.id, p_endpoint, p_p256dh, p_auth)
  on conflict (booking_id, endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth;
  perform private.sync_reminder_jobs(b.id);
  return private.public_booking_json(b.id);
end $$;

grant execute on function
  public.public_get_tenant(text),
  public.public_get_availability(text, uuid, date, int),
  public.public_create_booking(text, uuid, timestamptz, text, text, text, text, text),
  public.public_get_booking(text, text),
  public.public_cancel_booking(text, text, text),
  public.public_save_push_subscription(text, text, text, text, text)
to anon, authenticated;
