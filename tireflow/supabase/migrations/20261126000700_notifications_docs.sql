-- TireFlow · Notifications queue, campaigns, documents, attachments

create table public.notification_channels (
  business_id uuid not null references public.businesses (id) on delete cascade,
  channel text not null check (channel in ('email', 'sms', 'whatsapp', 'telegram', 'web_push', 'in_app')),
  provider text not null default 'test' check (provider in ('test', 'resend', 'smtp', 'twilio', 'smsapi', 'whatsapp_cloud', 'telegram_bot', 'web_push')),
  is_enabled boolean not null default false,
  -- secrets never live here: config holds non-secret settings; secrets go to Supabase Vault
  config jsonb not null default '{}'::jsonb,
  vault_secret_name text,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (business_id, channel)
);

create table public.notification_templates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  event text not null check (event in (
    'booking_confirmed', 'booking_reminder_24h', 'booking_reminder_2h', 'booking_rescheduled',
    'booking_cancelled', 'order_ready', 'payment_reminder', 'storage_ending', 'seasonal_invite',
    'revisit_offer', 'review_request', 'waitlist_offer', 'campaign')),
  channel text not null check (channel in ('email', 'sms', 'whatsapp', 'telegram', 'web_push', 'in_app')),
  locale public.app_locale not null,
  subject text,
  body text not null check (length(body) between 1 and 4000),
  is_marketing boolean not null default false,
  unique (business_id, event, channel, locale),
  unique (business_id, id)
);

create table public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  channel text not null check (channel in ('email', 'sms', 'whatsapp', 'telegram')),
  segment jsonb not null default '{}'::jsonb,
  -- per-locale bodies: {"cs": "...", "en": "..."}
  bodies jsonb not null,
  subject jsonb,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
  scheduled_at timestamptz,
  sent_count int not null default 0,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (business_id, id)
);

create table public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  event text not null,
  channel text not null,
  customer_id uuid,
  recipient text not null,
  locale public.app_locale not null default 'en',
  subject text,
  body text not null,
  is_marketing boolean not null default false,
  -- dedupe: the same event for the same entity is queued once
  dedupe_key text not null,
  entity_type text,
  entity_id uuid,
  campaign_id uuid,
  run_at timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued', 'processing', 'sent', 'failed', 'dead', 'skipped')),
  attempts int not null default 0,
  max_attempts int not null default 5,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (business_id, dedupe_key),
  foreign key (business_id, customer_id) references public.customers (business_id, id) on delete set null (customer_id),
  foreign key (business_id, campaign_id) references public.marketing_campaigns (business_id, id) on delete set null (campaign_id)
);
create index notification_jobs_due_idx on public.notification_jobs (run_at) where status = 'queued';

create table public.notification_logs (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  job_id uuid references public.notification_jobs (id) on delete set null,
  status text not null,
  provider text,
  detail text,
  created_at timestamptz not null default now()
);

-- In-CRM notifications for staff
create table public.inbox_notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade, -- null = all staff with permission
  permission text,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index inbox_notifications_idx on public.inbox_notifications (business_id, created_at desc);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────── templating & enqueue
create or replace function private.render(p_body text, p_vars jsonb) returns text
language plpgsql immutable as $$
declare k text; v text; r text := p_body;
begin
  for k, v in select key, value from jsonb_each_text(p_vars) loop
    r := replace(r, '{{' || k || '}}', coalesce(v, ''));
  end loop;
  return r;
end $$;

create or replace function private.has_marketing_consent(p_customer uuid, p_channel text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select granted from public.customer_consents
     where customer_id = p_customer
       and kind = case p_channel when 'email' then 'marketing_email' when 'sms' then 'marketing_sms' else 'marketing_messenger' end
     order by recorded_at desc limit 1), false);
$$;

-- Queue one message for a customer using the business template. Silently skips when
-- there is no template, no address, or (for marketing) no consent.
create or replace function private.enqueue(
  p_business uuid, p_event text, p_customer uuid, p_vars jsonb, p_dedupe text,
  p_entity_type text, p_entity_id uuid, p_run_at timestamptz default now(),
  p_fallback_phone text default null, p_fallback_email text default null, p_locale public.app_locale default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  c public.customers%rowtype;
  t public.notification_templates%rowtype;
  v_channel text;
  v_recipient text;
  v_locale public.app_locale;
  v_id uuid;
begin
  if p_customer is not null then
    select * into c from public.customers where id = p_customer and business_id = p_business and anonymized_at is null;
  end if;
  if c.preferred_channel = 'none' then return null; end if;
  v_locale := coalesce(p_locale, c.locale, (select public_locale from public.business_settings where business_id = p_business));

  -- preferred channel first, then SMS, then email: the first one with a template and an address wins
  for v_channel in
    select ch from unnest(array[nullif(case c.preferred_channel when 'phone' then 'sms' else c.preferred_channel end, ''), 'sms', 'email'])
      with ordinality u(ch, ord) where ch is not null order by ord
  loop
    v_recipient := case v_channel when 'email' then coalesce(c.email::text, p_fallback_email) else coalesce(c.phone, p_fallback_phone) end;
    continue when v_recipient is null;
    select * into t from public.notification_templates
     where business_id = p_business and event = p_event and channel = v_channel
     order by (locale = v_locale) desc, (locale = 'en') desc limit 1;
    exit when found;
  end loop;
  if t.id is null or v_recipient is null then return null; end if;
  if t.is_marketing and (p_customer is null or not private.has_marketing_consent(p_customer, v_channel)) then
    return null;
  end if;

  insert into public.notification_jobs (business_id, event, channel, customer_id, recipient, locale, subject, body,
      is_marketing, dedupe_key, entity_type, entity_id, run_at)
  values (p_business, p_event, v_channel, p_customer, v_recipient, t.locale,
      private.render(coalesce(t.subject, ''), p_vars), private.render(t.body, p_vars),
      t.is_marketing, p_dedupe, p_entity_type, p_entity_id, p_run_at)
  on conflict (business_id, dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end $$;

create or replace function private.booking_vars(p_booking uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'business', b.name,
    'name', coalesce(nullif(trim(c.first_name), ''), bk.contact_name, ''),
    'date', to_char(bk.starts_at at time zone s.timezone, 'DD.MM.YYYY'),
    'time', to_char(bk.starts_at at time zone s.timezone, 'HH24:MI'),
    'branch', br.name,
    'address', coalesce(br.address_line, '') || ' ' || coalesce(br.city, ''),
    'plate', coalesce(bk.plate_text, ''))
  from public.bookings bk
  join public.businesses b on b.id = bk.business_id
  join public.business_settings s on s.business_id = bk.business_id
  join public.branches br on br.id = bk.branch_id
  left join public.customers c on c.id = bk.customer_id
  where bk.id = p_booking;
$$;

create or replace function private.enqueue_booking_event(p_business uuid, p_booking uuid, p_event text)
returns void language plpgsql security definer set search_path = '' as $$
declare bk public.bookings%rowtype; v_vars jsonb;
begin
  select * into bk from public.bookings where id = p_booking;
  v_vars := private.booking_vars(p_booking);
  perform private.enqueue(p_business, p_event, bk.customer_id, v_vars,
    p_event || ':' || p_booking || ':' || extract(epoch from bk.starts_at)::bigint,
    'booking', p_booking, now(), bk.contact_phone, bk.contact_email);
  -- reminders are (re)queued relative to the current start; dedupe keys include the start
  if p_event in ('booking_confirmed', 'booking_rescheduled') then
    perform private.enqueue(p_business, 'booking_reminder_24h', bk.customer_id, v_vars,
      'r24:' || p_booking || ':' || extract(epoch from bk.starts_at)::bigint,
      'booking', p_booking, bk.starts_at - interval '24 hours', bk.contact_phone, bk.contact_email);
    perform private.enqueue(p_business, 'booking_reminder_2h', bk.customer_id, v_vars,
      'r2:' || p_booking || ':' || extract(epoch from bk.starts_at)::bigint,
      'booking', p_booking, bk.starts_at - interval '2 hours', bk.contact_phone, bk.contact_email);
  end if;
end $$;

create or replace function private.enqueue_order_event(p_business uuid, p_order uuid, p_event text)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.work_orders%rowtype;
begin
  select * into o from public.work_orders where id = p_order;
  perform private.enqueue(p_business, p_event, o.customer_id,
    jsonb_build_object('business', (select name from public.businesses where id = p_business),
                       'order', o.number,
                       'total', (o.total / 100.0)::text || ' ' || o.currency::text),
    p_event || ':' || p_order, 'work_order', p_order);
end $$;

-- When a slot frees up, offer it to the first matching entries on the waiting list.
create or replace function private.offer_freed_slot(p_business uuid, p_branch uuid, p_day date)
returns void language plpgsql security definer set search_path = '' as $$
declare w record;
begin
  for w in select * from public.waiting_list
            where business_id = p_business and branch_id = p_branch and status = 'waiting'
              and p_day between earliest and latest
            order by created_at limit 3 for update skip locked loop
    perform private.enqueue(p_business, 'waitlist_offer', w.customer_id,
      jsonb_build_object('date', to_char(p_day, 'DD.MM.YYYY'), 'name', coalesce(w.contact_name, '')),
      'wl:' || w.id || ':' || p_day, 'waiting_list', w.id, now(), w.contact_phone, null);
    update public.waiting_list set status = 'offered', offered_at = now() where id = w.id;
  end loop;
end $$;

-- ─────────────────────────────────────────── worker side (called by the Edge Function with the secret key)
-- Claims a batch with SKIP LOCKED so parallel workers never send the same job twice.
create or replace function public.claim_notification_jobs(p_worker text, p_limit int default 50)
returns setof public.notification_jobs
language plpgsql security definer set search_path = '' as $$
begin
  -- recover jobs whose worker died mid-flight
  update public.notification_jobs set status = 'queued', locked_at = null, locked_by = null
   where status = 'processing' and locked_at < now() - interval '10 minutes';
  return query
  update public.notification_jobs j set status = 'processing', locked_at = now(), locked_by = p_worker, attempts = j.attempts + 1
   where j.id in (
     select id from public.notification_jobs
      where status = 'queued' and run_at <= now()
      order by run_at limit least(p_limit, 200)
      for update skip locked)
  returning j.*;
end $$;

create or replace function public.complete_notification_job(
  p_job uuid, p_ok boolean, p_provider text, p_detail text default null, p_message_id text default null, p_retryable boolean default true
) returns void language plpgsql security definer set search_path = '' as $$
declare j public.notification_jobs%rowtype;
begin
  select * into j from public.notification_jobs where id = p_job for update;
  if not found then return; end if;
  if p_ok then
    update public.notification_jobs set status = 'sent', sent_at = now(), provider_message_id = p_message_id,
           locked_at = null, last_error = null where id = p_job;
  elsif p_retryable and j.attempts < j.max_attempts then
    -- exponential backoff: 1, 2, 4, 8 … minutes
    update public.notification_jobs set status = 'queued', locked_at = null, last_error = p_detail,
           run_at = now() + make_interval(mins => power(2, j.attempts - 1)::int) where id = p_job;
  else
    -- dead letter: kept for inspection, never retried automatically
    update public.notification_jobs set status = 'dead', locked_at = null, last_error = p_detail where id = p_job;
  end if;
  insert into public.notification_logs (business_id, job_id, status, provider, detail)
  values (j.business_id, p_job, case when p_ok then 'sent' else 'failed' end, p_provider, p_detail);
end $$;

revoke execute on function public.claim_notification_jobs(text, int) from public, anon, authenticated;
revoke execute on function public.complete_notification_job(uuid, boolean, text, text, text, boolean) from public, anon, authenticated;

-- Periodic scheduler for storage-ending and seasonal reminders. Runs once for all tenants.
create or replace function public.schedule_periodic_notifications() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; v_n int := 0;
begin
  for r in
    select c.business_id, c.id, ts.customer_id, c.ends_on, ts.code
      from public.tire_storage_contracts c
      join public.tire_sets ts on ts.id = c.tire_set_id
     where c.status = 'active' and c.ends_on between current_date and current_date + 14
  loop
    if private.enqueue(r.business_id, 'storage_ending', r.customer_id,
         jsonb_build_object('date', to_char(r.ends_on, 'DD.MM.YYYY'), 'code', r.code),
         'storage_ending:' || r.id, 'storage_contract', r.id) is not null then
      v_n := v_n + 1;
    end if;
  end loop;
  delete from public.idempotency_keys where created_at < now() - interval '30 days';
  delete from public.public_rate_limits where window_start < now() - interval '1 day';
  return v_n;
end $$;
revoke execute on function public.schedule_periodic_notifications() from public, anon, authenticated;

-- ─────────────────────────────────────────── documents & attachments
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind text not null check (kind in ('work_order', 'payment_receipt', 'storage_contract', 'storage_receipt', 'tire_label', 'report')),
  entity_id uuid not null,
  number text,
  locale public.app_locale not null,
  storage_path text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index documents_entity_idx on public.documents (business_id, entity_id);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  entity_type text not null check (entity_type in ('vehicle', 'work_order', 'tire_set', 'tire_set_item', 'customer')),
  entity_id uuid not null,
  label text check (label in ('before', 'after', 'damage', 'tire', 'document', 'other')),
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes int not null check (size_bytes between 1 and 10485760),
  uploaded_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index attachments_entity_idx on public.attachments (business_id, entity_type, entity_id);

-- ─────────────────────────────────────────── public rate limiting (no Redis needed)
create table public.public_rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (bucket, window_start)
);

create or replace function private.rate_limit(p_bucket text, p_max int, p_window interval)
returns void language plpgsql security definer set search_path = '' as $$
declare v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / extract(epoch from p_window)) * extract(epoch from p_window));
        v_hits int;
begin
  insert into public.public_rate_limits (bucket, window_start, hits) values (p_bucket, v_start, 1)
  on conflict (bucket, window_start) do update set hits = public.public_rate_limits.hits + 1
  returning hits into v_hits;
  if v_hits > p_max then raise exception 'rate_limited' using errcode = '54000'; end if;
end $$;
