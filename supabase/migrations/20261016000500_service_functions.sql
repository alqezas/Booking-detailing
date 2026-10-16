-- Server-only functions (service_role): the tenant pipeline, shared rate
-- limits, the LLM budget and the notification outbox. None of these are
-- executable by anon or authenticated.

-- ---------------------------------------------------------------------------
-- Tenant pipeline
-- ---------------------------------------------------------------------------
-- Upsert a studio from a validated business.json payload (image paths already
-- resolved by scripts/tenant-publish.ts). Rules:
--  * a new slug creates a tenant in 'preview';
--  * content rows are matched by key; rows the owner created or edited
--    (source = 'owner') are never overwritten or deleted;
--  * config services/bays that disappeared are deactivated, not deleted, so
--    booking history keeps its references;
--  * bookings, payments and owner uploads are never touched;
--  * on a live studio content is synced only when p_sync_content is true.
create or replace function public.svc_sync_tenant(p_config jsonb, p_config_hash text, p_sync_content boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  c jsonb := p_config;
  v_slug text := c ->> 'slug';
  t public.tenants;
  v_created boolean := false;
  v_sync boolean;
  v_day text;
  v_idx int;
  r jsonb;
  s jsonb;
  g jsonb;
  v_service uuid;
  v_weekdays constant text[] := array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
begin
  select * into t from public.tenants where slug = v_slug for update;
  if not found then
    insert into public.tenants (slug, kind, name, timezone, accent_color, phone, address)
    values (v_slug, c ->> 'kind', c ->> 'name', c ->> 'timezone', c ->> 'accentColor',
            c -> 'contacts' ->> 'phone', c -> 'contacts' ->> 'address')
    returning * into t;
    v_created := true;
  end if;

  v_sync := v_created or t.status = 'preview' or p_sync_content;

  if v_sync then
    update public.tenants set
      kind = c ->> 'kind',
      name = c ->> 'name',
      short_name = c ->> 'shortName',
      tagline = coalesce(c ->> 'tagline', ''),
      description = coalesce(c ->> 'description', ''),
      timezone = c ->> 'timezone',
      currency = coalesce(c ->> 'currency', 'RUB'),
      locale = coalesce(c ->> 'locale', 'ru-RU'),
      accent_color = c ->> 'accentColor',
      phone = c -> 'contacts' ->> 'phone',
      address = c -> 'contacts' ->> 'address',
      map_url = c -> 'contacts' ->> 'mapUrl',
      lat = (c -> 'contacts' ->> 'lat')::double precision,
      lng = (c -> 'contacts' ->> 'lng')::double precision,
      telegram = c -> 'contacts' ->> 'telegram',
      whatsapp = c -> 'contacts' ->> 'whatsapp',
      email = c -> 'contacts' ->> 'email',
      logo_path = c -> 'images' ->> 'logo',
      hero_path = c -> 'images' ->> 'hero',
      slot_step_minutes = (c -> 'booking' ->> 'slotStepMinutes')::int,
      min_lead_minutes = (c -> 'booking' ->> 'minLeadMinutes')::int,
      horizon_days = (c -> 'booking' ->> 'horizonDays')::int,
      cancel_cutoff_hours = (c -> 'booking' ->> 'cancelCutoffHours')::int,
      default_buffer_minutes = (c -> 'booking' ->> 'defaultBufferMinutes')::int,
      assistant_enabled = coalesce((c -> 'assistant' ->> 'enabled')::boolean, true),
      owner_edited_at = null
    where id = t.id;

    -- Bays
    v_idx := 0;
    for r in select * from jsonb_array_elements(c -> 'resources') loop
      v_idx := v_idx + 1;
      insert into public.resources (tenant_id, key, name, sort, is_active, source)
      values (t.id, r ->> 'key', r ->> 'name', v_idx, true, 'config')
      on conflict (tenant_id, key) do update
        set name = excluded.name, sort = excluded.sort, is_active = true
        where public.resources.source = 'config';
    end loop;
    update public.resources set is_active = false
     where tenant_id = t.id and source = 'config'
       and key not in (select x ->> 'key' from jsonb_array_elements(c -> 'resources') x);

    -- Services and their bays
    v_idx := 0;
    for s in select * from jsonb_array_elements(c -> 'services') loop
      v_idx := v_idx + 1;
      insert into public.services (tenant_id, key, name, description, category, price, price_from,
                                   duration_minutes, buffer_minutes, sort, is_active, source)
      values (t.id, s ->> 'key', s ->> 'name', coalesce(s ->> 'description', ''), coalesce(s ->> 'category', 'Услуги'),
              (s ->> 'price')::int, coalesce((s ->> 'priceFrom')::boolean, false), (s ->> 'durationMinutes')::int,
              (s ->> 'bufferMinutes')::int, v_idx, true, 'config')
      on conflict (tenant_id, key) do update
        set name = excluded.name, description = excluded.description, category = excluded.category,
            price = excluded.price, price_from = excluded.price_from, duration_minutes = excluded.duration_minutes,
            buffer_minutes = excluded.buffer_minutes, sort = excluded.sort, is_active = true
        where public.services.source = 'config'
      returning id into v_service;

      if v_service is not null then
        delete from public.service_resources where service_id = v_service;
        insert into public.service_resources (tenant_id, service_id, resource_id)
        select t.id, v_service, res.id
        from jsonb_array_elements_text(s -> 'resources') k
        join public.resources res on res.tenant_id = t.id and res.key = k;
      end if;
    end loop;
    update public.services set is_active = false
     where tenant_id = t.id and source = 'config'
       and key not in (select x ->> 'key' from jsonb_array_elements(c -> 'services') x);

    -- Weekly hours
    delete from public.working_hours where tenant_id = t.id;
    for v_idx in 1..7 loop
      v_day := v_weekdays[v_idx];
      insert into public.working_hours (tenant_id, weekday, opens, closes)
      select t.id, v_idx, (iv ->> 0)::time, (iv ->> 1)::time
      from jsonb_array_elements(coalesce(c -> 'hours' -> v_day, '[]'::jsonb)) iv;
    end loop;

    -- Days off from the config (owner-added exceptions stay)
    delete from public.schedule_exceptions where tenant_id = t.id and source = 'config';
    insert into public.schedule_exceptions (tenant_id, day, is_closed, note, source)
    select t.id, d::date, true, 'Выходной', 'config'
    from jsonb_array_elements_text(coalesce(c -> 'closedDates', '[]'::jsonb)) d
    on conflict (tenant_id, day) do nothing;

    -- Info cards (owner-edited cards stay)
    v_idx := 0;
    for r in select * from jsonb_array_elements(c -> 'infoCards') loop
      v_idx := v_idx + 1;
      insert into public.info_cards (tenant_id, position, icon, title, text, source)
      values (t.id, v_idx, r ->> 'icon', r ->> 'title', r ->> 'text', 'config')
      on conflict (tenant_id, position) do update
        set icon = excluded.icon, title = excluded.title, text = excluded.text
        where public.info_cards.source = 'config';
    end loop;

    -- Gallery: config items keyed by image path; owner photos stay in place.
    v_idx := 0;
    for g in select * from jsonb_array_elements(coalesce(c -> 'gallery', '[]'::jsonb)) loop
      v_idx := v_idx + 1;
      insert into public.gallery_items (tenant_id, image_path, caption, sort, source, config_key)
      values (t.id, g ->> 'image', coalesce(g ->> 'caption', ''), v_idx * 10, 'config', g ->> 'image')
      on conflict (tenant_id, config_key) do update
        set image_path = excluded.image_path, caption = excluded.caption, sort = excluded.sort
        where public.gallery_items.source = 'config';
    end loop;
    delete from public.gallery_items
     where tenant_id = t.id and source = 'config'
       and config_key not in (select x ->> 'image' from jsonb_array_elements(coalesce(c -> 'gallery', '[]'::jsonb)) x);
  end if;

  update public.tenants set config_hash = p_config_hash, published_at = now(),
                            owner_edited_at = case when v_sync then null else owner_edited_at end
   where id = t.id;
  select * into t from public.tenants where id = t.id;

  return jsonb_build_object('tenant_id', t.id, 'slug', t.slug, 'status', t.status,
                            'created', v_created, 'content_synced', v_sync);
end $$;

-- Demo bookings for a preview: clearly flagged, spread over the past and the
-- coming week so the cabinet and the statistics have something to show.
create or replace function public.svc_seed_demo_bookings(p_slug text) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  t public.tenants;
  v_today date;
  v_services uuid[];
  v_count int := 0;
  v_names constant text[] := array['Демо: Алексей', 'Демо: Марина', 'Демо: Игорь', 'Демо: Ольга', 'Демо: Сергей',
                                   'Демо: Дарья', 'Демо: Павел', 'Демо: Екатерина'];
  v_cars constant text[] := array['BMW X5', 'Kia Rio', 'Toyota Camry', 'Mercedes GLE', 'Škoda Octavia',
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
          v_names[1 + (i % 8)], '+7900000' || lpad((1000 + i)::text, 4, '0'), v_cars[1 + (i % 8)],
          'Демонстрационная запись', 'demo-' || t.id || '-' || i, 'demo', null, false);
        v_booking := (v_res -> 'booking' ->> 'id')::uuid;
        v_count := v_count + 1;
        if v_day < 0 then
          update public.bookings set status = 'ready', arrived_at = start_at, ready_at = end_at where id = v_booking;
          insert into public.payments (tenant_id, booking_id, kind, amount, method, paid_at, note, idempotency_key)
          select t.id, b.id, 'payment', b.price, case when i % 2 = 0 then 'card' else 'cash' end::public.payment_method,
                 b.end_at, 'Демо-оплата', 'demo-pay-' || b.id
          from public.bookings b where b.id = v_booking;
        end if;
      exception when sqlstate 'PT409' then
        null; -- slot already used by another demo row
      end;
    end loop;
  end loop;
  return v_count;
end $$;

-- Live activation: purge everything flagged as demo, then open the studio.
create or replace function public.svc_activate_tenant(p_slug text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  t public.tenants;
  v_deleted int;
begin
  select * into t from public.tenants where slug = p_slug for update;
  if not found then
    raise exception 'tenant % not found', p_slug;
  end if;
  delete from public.bookings where tenant_id = t.id and is_demo;
  get diagnostics v_deleted = row_count;
  update public.tenants set status = 'live', activated_at = coalesce(activated_at, now()) where id = t.id;
  return jsonb_build_object('slug', t.slug, 'status', 'live', 'demo_bookings_removed', v_deleted);
end $$;

create or replace function public.svc_add_member(p_slug text, p_user_id uuid, p_role text default 'owner') returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.tenant_members (tenant_id, user_id, role)
  select id, p_user_id, p_role from public.tenants where slug = p_slug
  on conflict (tenant_id, user_id) do update set role = excluded.role;
$$;

-- ---------------------------------------------------------------------------
-- Shared counters for edge functions
-- ---------------------------------------------------------------------------
create or replace function public.svc_rate_limit_hit(p_key text, p_limit int, p_window_seconds int) returns boolean
language sql volatile security definer set search_path = '' as $$
  select private.rate_limit_hit(p_key, p_limit, p_window_seconds);
$$;

-- Atomically reserve LLM tokens against a per-tenant and a global daily cap.
-- Either both counters move or neither does.
create or replace function public.svc_llm_reserve(p_tenant_id uuid, p_tokens int, p_tenant_limit bigint, p_global_limit bigint)
returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_day date := (now() at time zone 'UTC')::date;
  v_ok boolean;
begin
  begin
    insert into private.llm_usage as u (scope, day, requests, tokens)
    values ('tenant:' || p_tenant_id, v_day, 1, p_tokens)
    on conflict (scope, day) do update set requests = u.requests + 1, tokens = u.tokens + excluded.tokens
      where u.tokens + excluded.tokens <= p_tenant_limit
    returning true into v_ok;
    if v_ok is null or p_tokens > p_tenant_limit then
      raise exception 'budget' using errcode = 'P0B01';
    end if;
    v_ok := null;
    insert into private.llm_usage as u (scope, day, requests, tokens)
    values ('global', v_day, 1, p_tokens)
    on conflict (scope, day) do update set requests = u.requests + 1, tokens = u.tokens + excluded.tokens
      where u.tokens + excluded.tokens <= p_global_limit
    returning true into v_ok;
    if v_ok is null or p_tokens > p_global_limit then
      raise exception 'budget' using errcode = 'P0B01';
    end if;
  exception when sqlstate 'P0B01' then
    return false;
  end;
  return true;
end $$;

-- Replace a reservation with the real usage once the model answered.
create or replace function public.svc_llm_settle(p_tenant_id uuid, p_reserved int, p_actual int) returns void
language sql volatile security definer set search_path = '' as $$
  update private.llm_usage set tokens = greatest(0, tokens - p_reserved + p_actual)
  where day = (now() at time zone 'UTC')::date and scope in ('tenant:' || p_tenant_id, 'global');
$$;

create or replace function public.svc_llm_usage(p_tenant_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(scope, jsonb_build_object('requests', requests, 'tokens', tokens)), '{}'::jsonb)
  from private.llm_usage
  where day = (now() at time zone 'UTC')::date and scope in ('tenant:' || p_tenant_id, 'global');
$$;

-- Tenant + public catalogue lookups for the assistants (no personal data).
create or replace function public.svc_public_availability(p_slug text, p_service_id uuid, p_from date, p_days int)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.tenants;
begin
  t := private.tenant_by_slug(p_slug);
  return private.availability(t.id, p_service_id, p_from, p_days);
end $$;

-- ---------------------------------------------------------------------------
-- Notification outbox
-- ---------------------------------------------------------------------------
create or replace function public.svc_check_cron_secret(p_secret text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.app_secrets where name = 'cron_secret' and value = p_secret);
$$;

-- Claim due jobs with a lease. A crashed worker's jobs become claimable again
-- once the lease expires; SKIP LOCKED keeps parallel workers apart.
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
                                 'timezone', t.timezone, 'address', t.address),
    'subscriptions', coalesce((select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
                               from public.push_subscriptions s where s.booking_id = b.id), '[]'::jsonb)
  )), '[]'::jsonb) into v
  from claimed c
  join public.bookings b on b.id = c.booking_id
  join public.tenants t on t.id = c.tenant_id;
  return v;
end $$;

-- Finish a claimed job. Only the worker holding the lease may complete it.
-- p_outcome: 'sent' | 'retry' | 'failed' | 'cancelled'
create or replace function public.svc_complete_notification_job(
  p_job_id bigint, p_worker text, p_outcome text, p_error text default null, p_gone_endpoints text[] default '{}'
) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare j public.notification_jobs;
begin
  select * into j from public.notification_jobs where id = p_job_id for update;
  if not found or j.status <> 'processing' or j.locked_by is distinct from p_worker then
    return false; -- lease lost: someone else owns the job now
  end if;
  delete from public.push_subscriptions where booking_id = j.booking_id and endpoint = any(p_gone_endpoints);
  update public.notification_jobs set
    status = case
      when p_outcome = 'sent' then 'sent'
      when p_outcome = 'cancelled' then 'cancelled'
      when p_outcome = 'failed' or j.attempts >= j.max_attempts then 'failed'
      else 'pending' end::public.notification_status,
    run_at = case when p_outcome = 'retry' then now() + make_interval(secs => 60 * power(2, j.attempts)::int) else run_at end,
    sent_at = case when p_outcome = 'sent' then now() else null end,
    last_error = left(p_error, 500),
    lease_until = null,
    locked_by = null
  where id = j.id;
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- Scheduling (pg_cron + pg_net)
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function private.trigger_notification_dispatch() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.notification_jobs
                 where (status = 'pending' and run_at <= now()) or (status = 'processing' and lease_until < now())) then
    return; -- nothing due: do not wake the edge function
  end if;
  perform net.http_post(
    url := (select value from private.app_config where name = 'functions_url') || '/notify-dispatch',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-cron-secret', (select value from private.app_secrets where name = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
end $$;

create or replace function private.cleanup() returns void
language sql security definer set search_path = '' as $$
  delete from private.rate_counters where window_start < now() - interval '2 days';
  delete from private.llm_usage where day < (now() at time zone 'UTC')::date - 60;
  delete from public.notification_jobs where status in ('sent', 'cancelled', 'skipped', 'failed')
    and updated_at < now() - interval '90 days';
$$;

select cron.schedule('notify-dispatch', '* * * * *', $$select private.trigger_notification_dispatch()$$);
select cron.schedule('studio-cleanup', '17 3 * * *', $$select private.cleanup()$$);

-- ---------------------------------------------------------------------------
-- Storage: one public bucket; the first path segment is the tenant id and
-- only that tenant's members may write there.
-- ---------------------------------------------------------------------------
create or replace function private.try_uuid(p text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;
grant execute on function private.try_uuid(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tenant-media', 'tenant-media', true, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
                               allowed_mime_types = excluded.allowed_mime_types;

create policy tenant_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'tenant-media' and private.is_member(private.try_uuid((storage.foldername(name))[1])));
create policy tenant_media_update on storage.objects for update to authenticated
  using (bucket_id = 'tenant-media' and private.is_member(private.try_uuid((storage.foldername(name))[1])))
  with check (bucket_id = 'tenant-media' and private.is_member(private.try_uuid((storage.foldername(name))[1])));
create policy tenant_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'tenant-media' and private.is_member(private.try_uuid((storage.foldername(name))[1])));
create policy tenant_media_select on storage.objects for select to authenticated
  using (bucket_id = 'tenant-media' and private.is_member(private.try_uuid((storage.foldername(name))[1])));

-- ---------------------------------------------------------------------------
-- Final privilege sweep
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon;
grant execute on function private.is_member(uuid), private.try_uuid(text) to authenticated;

revoke execute on function
  public.svc_sync_tenant(jsonb, text, boolean),
  public.svc_seed_demo_bookings(text),
  public.svc_activate_tenant(text),
  public.svc_add_member(text, uuid, text),
  public.svc_rate_limit_hit(text, int, int),
  public.svc_llm_reserve(uuid, int, bigint, bigint),
  public.svc_llm_settle(uuid, int, int),
  public.svc_llm_usage(uuid),
  public.svc_public_availability(text, uuid, date, int),
  public.svc_check_cron_secret(text),
  public.svc_claim_notification_jobs(text, int, int),
  public.svc_complete_notification_job(bigint, text, text, text, text[])
from public, anon, authenticated;

grant execute on function
  public.svc_sync_tenant(jsonb, text, boolean),
  public.svc_seed_demo_bookings(text),
  public.svc_activate_tenant(text),
  public.svc_add_member(text, uuid, text),
  public.svc_rate_limit_hit(text, int, int),
  public.svc_llm_reserve(uuid, int, bigint, bigint),
  public.svc_llm_settle(uuid, int, int),
  public.svc_llm_usage(uuid),
  public.svc_public_availability(text, uuid, date, int),
  public.svc_check_cron_secret(text),
  public.svc_claim_notification_jobs(text, int, int),
  public.svc_complete_notification_job(bigint, text, text, text, text[])
to service_role;
