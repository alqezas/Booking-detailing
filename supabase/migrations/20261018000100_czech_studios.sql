-- Czech studios (first: JH Auto Detailing, Tišnov).
--   * CZK and an explicit list of interface languages;
--   * legal_address — the registered office («sídlo») when it differs from
--     the workshop where cars are brought (tenants.address);
--   * gallery_items.before_path — optional «before» photo shown next to the result;
--   * the studio language in reminder jobs, so pushes are written in it.

alter table public.tenants drop constraint tenants_currency_check;
alter table public.tenants add constraint tenants_currency_check
  check (currency in ('RUB', 'KZT', 'BYN', 'EUR', 'USD', 'CZK'));
alter table public.tenants add constraint tenants_locale_check check (locale in ('ru-RU', 'cs-CZ'));
alter table public.tenants add column legal_address text
  check (legal_address is null or char_length(legal_address) between 5 and 200);

alter table public.gallery_items add column before_path text
  check (before_path is null or char_length(before_path) between 1 and 500);

-- ---------------------------------------------------------------------------
-- Public studio card: + legal_address, + gallery before_path
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
    'email', t.email,
    'logo_path', t.logo_path,
    'hero_path', t.hero_path,
    'assistant_enabled', t.assistant_enabled,
    'booking', jsonb_build_object(
      'slot_step_minutes', t.slot_step_minutes,
      'min_lead_minutes', t.min_lead_minutes,
      'horizon_days', t.horizon_days,
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
-- Owner edits: legal_address becomes editable
-- ---------------------------------------------------------------------------
create or replace function public.owner_update_tenant(p_tenant_id uuid, p_patch jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  k text;
  allowed text[] := array['name', 'short_name', 'tagline', 'description', 'phone', 'address', 'legal_address', 'map_url',
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
    legal_address = case when p_patch ? 'legal_address' then nullif(p_patch ->> 'legal_address', '') else t.legal_address end,
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

-- ---------------------------------------------------------------------------
-- Publishing: the original sync stays as is (moved to private); the public
-- entry point adds the new fields when content is synced.
-- ---------------------------------------------------------------------------
alter function public.svc_sync_tenant(jsonb, text, boolean) rename to sync_tenant_core;
alter function public.sync_tenant_core(jsonb, text, boolean) set schema private;
revoke execute on function private.sync_tenant_core(jsonb, text, boolean) from public, anon, authenticated;

create or replace function public.svc_sync_tenant(p_config jsonb, p_config_hash text, p_sync_content boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  r jsonb := private.sync_tenant_core(p_config, p_config_hash, p_sync_content);
  v_tenant uuid := (r ->> 'tenant_id')::uuid;
begin
  if (r ->> 'content_synced')::boolean then
    update public.tenants
       set legal_address = nullif(p_config -> 'contacts' ->> 'legalAddress', '')
     where id = v_tenant;
    update public.gallery_items g
       set before_path = nullif(x ->> 'before', '')
      from jsonb_array_elements(coalesce(p_config -> 'gallery', '[]'::jsonb)) x
     where g.tenant_id = v_tenant and g.source = 'config' and g.config_key = x ->> 'image'
       and g.before_path is distinct from nullif(x ->> 'before', '');
    -- Closed dates from the config are labelled in the studio language.
    if p_config ->> 'locale' = 'cs-CZ' then
      update public.schedule_exceptions set note = 'Zavřeno'
       where tenant_id = v_tenant and source = 'config' and note = 'Выходной';
    end if;
  end if;
  return r;
end $$;
revoke execute on function public.svc_sync_tenant(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.svc_sync_tenant(jsonb, text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- Reminder jobs carry the studio language
-- ---------------------------------------------------------------------------
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
    'booking', jsonb_build_object('id', b.id, 'status', b.status, 'start_at', b.start_at,
                                  'service_name', b.service_name, 'is_demo', b.is_demo),
    'tenant', jsonb_build_object('slug', t.slug, 'name', t.name, 'status', t.status,
                                 'timezone', t.timezone, 'address', t.address, 'locale', t.locale),
    'subscriptions', coalesce((select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
                               from public.push_subscriptions s where s.booking_id = b.id), '[]'::jsonb)
  )), '[]'::jsonb) into v
  from claimed c
  join public.bookings b on b.id = c.booking_id
  join public.tenants t on t.id = c.tenant_id;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Demo bookings of a preview speak the studio language
-- ---------------------------------------------------------------------------
create or replace function public.svc_seed_demo_bookings(p_slug text) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  t public.tenants;
  v_today date;
  v_services uuid[];
  v_count int := 0;
  v_cs boolean;
  v_names text[] := array['Демо: Алексей', 'Демо: Марина', 'Демо: Игорь', 'Демо: Ольга', 'Демо: Сергей',
                                   'Демо: Дарья', 'Демо: Павел', 'Демо: Екатерина'];
  v_cars text[] := array['BMW X5', 'Kia Rio', 'Toyota Camry', 'Mercedes GLE', 'Škoda Octavia',
                                  'Hyundai Creta', 'Volkswagen Tiguan', 'Lada Vesta'];
  v_day int;
  v_slot record;
  v_res jsonb;
  v_booking uuid;
  i int := 0;
begin
  select * into t from public.tenants where slug = p_slug;
  if not found or t.status <> 'preview' then
    raise exception 'demo bookings only for an existing preview tenant';
  end if;
  v_cs := t.locale = 'cs-CZ';
  if v_cs then
    v_names := array['Demo: Jan', 'Demo: Petra', 'Demo: Tomáš', 'Demo: Lucie', 'Demo: Martin', 'Demo: Tereza', 'Demo: Jakub', 'Demo: Kateřina'];
    v_cars := array['Škoda Octavia', 'Škoda Kodiaq', 'Volkswagen Golf', 'BMW X5', 'Toyota RAV4', 'Hyundai i30', 'Ford Focus', 'Kia Ceed'];
  end if;
  delete from public.bookings where tenant_id = t.id and is_demo;
  v_today := (now() at time zone t.timezone)::date;
  select array_agg(id order by duration_minutes) into v_services
  from public.services s where s.tenant_id = t.id and s.is_active and s.duration_minutes < 1440
    and exists (select 1 from private.eligible_resources(s.id));
  if v_services is null then return 0; end if;

  for v_day in -6..6 loop
    -- one or two bookings per open day, at the first free slots after 10:00
    for v_slot in
      select c.start_at from private.slot_candidates(t.id, 120, v_today + v_day, v_today + v_day) c
      where extract(hour from c.start_at at time zone t.timezone) in (10, 14)
        and extract(minute from c.start_at at time zone t.timezone) = 0
    loop
      i := i + 1;
      begin
        v_res := private.create_booking(
          t.id, v_services[1 + (i % array_length(v_services, 1))], v_slot.start_at, null,
          v_names[1 + (i % 8)], case when v_cs then '+42070000' else '+7900000' end || lpad((1000 + i)::text, 4, '0'), v_cars[1 + (i % 8)],
          case when v_cs then 'Ukázková rezervace' else 'Демонстрационная запись' end, 'demo-' || t.id || '-' || i, 'demo', null, false);
        v_booking := (v_res -> 'booking' ->> 'id')::uuid;
        v_count := v_count + 1;
        if v_day < 0 then
          update public.bookings set status = 'ready', arrived_at = start_at, ready_at = end_at where id = v_booking;
          insert into public.payments (tenant_id, booking_id, kind, amount, method, paid_at, note, idempotency_key)
          select t.id, b.id, 'payment', b.price, case when i % 2 = 0 then 'card' else 'cash' end::public.payment_method,
                 b.end_at, case when v_cs then 'Ukázková platba' else 'Демо-оплата' end, 'demo-pay-' || b.id
          from public.bookings b where b.id = v_booking;
        end if;
      exception when sqlstate 'PT409' then
        null; -- slot already used by another demo row
      end;
    end loop;
  end loop;
  return v_count;
end $$;
