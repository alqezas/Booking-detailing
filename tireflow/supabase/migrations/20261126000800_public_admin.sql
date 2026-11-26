-- TireFlow · Public booking API (no account), self-service booking links, super-admin RPCs

-- ─────────────────────────────────────────── public business profile
create or replace function public.public_business(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid; v jsonb;
begin
  select b.id into v_id from public.businesses b
   where b.slug = lower(p_slug) and b.is_active and b.deleted_at is null;
  if v_id is null or not public.module_enabled(v_id, 'online_booking') then return null; end if;
  select jsonb_build_object(
    'id', b.id, 'slug', b.slug, 'name', b.name,
    'logo_path', s.logo_path, 'brand_color', s.brand_color, 'accent_color', s.accent_color,
    'phone', s.phone, 'email', s.email, 'website', s.website,
    'currency', s.currency, 'locale', s.public_locale, 'timezone', s.timezone,
    'prices_include_tax', s.prices_include_tax, 'horizon_days', s.booking_horizon_days,
    'branches', coalesce((select jsonb_agg(jsonb_build_object(
        'id', br.id, 'name', br.name, 'address', br.address_line, 'city', br.city,
        'phone', br.phone, 'opening_hours', br.opening_hours) order by br.sort_order)
      from public.branches br where br.business_id = b.id and br.is_active and br.deleted_at is null), '[]'),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', vc.id, 'code', vc.code, 'name', vc.name) order by vc.sort_order)
      from public.vehicle_categories vc where vc.business_id = b.id and vc.is_active), '[]'),
    'services', coalesce((select jsonb_agg(jsonb_build_object(
        'id', sv.id, 'name', sv.name, 'description', sv.description, 'unit', sv.unit,
        'base_price', sv.base_price, 'duration_min', sv.base_duration_min,
        'category', sc.name) order by sc.sort_order, sv.sort_order)
      from public.services sv left join public.service_categories sc on sc.id = sv.category_id
      where sv.business_id = b.id and sv.is_active and sv.online_bookable and sv.deleted_at is null), '[]')
  ) into v
  from public.businesses b join public.business_settings s on s.business_id = b.id
  where b.id = v_id;
  return v;
end $$;

create or replace function public.public_quote(p_slug text, p_services uuid[], p_params jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform set_config('tireflow.public_context', 'on', true);
  select id into v_id from public.businesses where slug = lower(p_slug) and is_active and deleted_at is null;
  if v_id is null or not public.module_enabled(v_id, 'online_booking') then
    raise exception 'business_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from unnest(p_services) s where not exists (
      select 1 from public.services x where x.id = s and x.business_id = v_id and x.online_bookable and x.is_active)) then
    raise exception 'service_not_bookable' using errcode = '22023';
  end if;
  return public.quote_services(v_id, p_services, p_params);
end $$;

create or replace function public.public_slots(p_slug text, p_branch uuid, p_day date, p_services uuid[], p_params jsonb)
returns table (starts_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid; v_dur int; st public.business_settings%rowtype;
begin
  perform set_config('tireflow.public_context', 'on', true);
  select id into v_id from public.businesses where slug = lower(p_slug) and is_active and deleted_at is null;
  if v_id is null or not public.module_enabled(v_id, 'online_booking') then
    raise exception 'business_not_found' using errcode = 'P0002';
  end if;
  select * into st from public.business_settings where business_id = v_id;
  if p_day < (now() at time zone st.timezone)::date or p_day > current_date + st.booking_horizon_days then
    return;
  end if;
  v_dur := (public.public_quote(p_slug, p_services, p_params) ->> 'duration_min')::int;
  return query select distinct s.starts_at from private.available_slots(
    v_id, p_branch, p_day, v_dur, p_services, nullif(p_params ->> 'vehicle_category_id', '')::uuid) s
    order by 1;
end $$;

-- Creates (or reuses by phone) the customer, books the slot and returns a one-time
-- management token. Only the SHA-256 of the token is stored.
-- p: {branch_id, service_ids, vehicle_params, starts_at, first_name, last_name, phone, email,
--     plate, note, locale, consent_marketing, client_fingerprint}
create or replace function public.public_create_booking(p_slug text, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_cust uuid;
  v_vehicle uuid;
  v_booking uuid;
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
  v_phone text := regexp_replace(coalesce(p ->> 'phone', ''), '[^0-9+]', '', 'g');
  v_plate text := nullif(upper(regexp_replace(coalesce(p ->> 'plate', ''), '[^A-Za-z0-9]', '', 'g')), '');
  v_locale public.app_locale;
begin
  perform set_config('tireflow.public_context', 'on', true);
  select id into v_id from public.businesses where slug = lower(p_slug) and is_active and deleted_at is null;
  if v_id is null or not public.module_enabled(v_id, 'online_booking') then
    raise exception 'business_not_found' using errcode = 'P0002';
  end if;
  perform private.rate_limit('book:' || v_id || ':' || coalesce(p ->> 'client_fingerprint', 'anon'), 5, interval '10 minutes');
  perform private.rate_limit('book:' || v_id || ':phone:' || v_phone, 3, interval '1 hour');

  if length(v_phone) < 8 or length(v_phone) > 16 then raise exception 'invalid_phone' using errcode = '22023'; end if;
  if coalesce(trim(p ->> 'first_name'), '') = '' then raise exception 'name_required' using errcode = '22023'; end if;
  if (p ->> 'starts_at')::timestamptz > now() + make_interval(days => (select booking_horizon_days from public.business_settings where business_id = v_id)) then
    raise exception 'too_far_ahead' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements_text(p -> 'service_ids') s where not exists (
      select 1 from public.services x where x.id = s::uuid and x.business_id = v_id and x.online_bookable and x.is_active)) then
    raise exception 'service_not_bookable' using errcode = '22023';
  end if;
  v_locale := case when p ->> 'locale' in ('cs', 'pl', 'uk', 'sk', 'de', 'en', 'ru') then (p ->> 'locale')::public.app_locale end;

  select id into v_cust from public.customers
   where business_id = v_id and phone_normalized = regexp_replace(v_phone, '[^0-9]', '', 'g')
     and deleted_at is null and merged_into is null
   order by created_at limit 1;
  if v_cust is null then
    insert into public.customers (business_id, first_name, last_name, phone, email, source, locale, preferred_channel)
    values (v_id, trim(p ->> 'first_name'), coalesce(trim(p ->> 'last_name'), ''), v_phone,
            nullif(trim(p ->> 'email'), ''), 'online', coalesce(v_locale, 'en'),
            case when nullif(trim(p ->> 'email'), '') is not null then 'email' else 'sms' end)
    returning id into v_cust;
    insert into public.customer_consents (business_id, customer_id, kind, granted, source)
    values (v_id, v_cust, 'data_processing', true, 'online_booking');
  end if;
  if (p ->> 'consent_marketing')::boolean is true then
    insert into public.customer_consents (business_id, customer_id, kind, granted, source)
    values (v_id, v_cust, 'marketing_sms', true, 'online_booking'),
           (v_id, v_cust, 'marketing_email', true, 'online_booking');
  end if;

  if v_plate is not null then
    select id into v_vehicle from public.vehicles where business_id = v_id and plate_normalized = v_plate and deleted_at is null;
    if v_vehicle is null then
      insert into public.vehicles (business_id, customer_id, make, plate, category_id, rim_diameter, has_tpms, has_runflat)
      values (v_id, v_cust, coalesce(nullif(p ->> 'make', ''), '—'), p ->> 'plate',
              nullif(p -> 'vehicle_params' ->> 'vehicle_category_id', '')::uuid,
              nullif(p -> 'vehicle_params' ->> 'rim', '')::int,
              coalesce((p -> 'vehicle_params' ->> 'tpms')::boolean, false),
              coalesce((p -> 'vehicle_params' ->> 'runflat')::boolean, false))
      returning id into v_vehicle;
    elsif not exists (select 1 from public.vehicles where id = v_vehicle and customer_id = v_cust) then
      v_vehicle := null; -- plate belongs to someone else: do not link, staff will resolve
    end if;
  end if;

  v_booking := private.insert_booking(v_id, p
      || jsonb_build_object('customer_id', v_cust, 'vehicle_id', v_vehicle,
                            'contact_name', trim(coalesce(p ->> 'first_name', '') || ' ' || coalesce(p ->> 'last_name', '')),
                            'contact_phone', v_phone, 'contact_email', nullif(trim(p ->> 'email'), ''),
                            'customer_note', left(p ->> 'note', 1000))
      - 'workstation_id' - 'employee_id' - 'status' - 'duration_min' - 'internal_note',
      'online', null);

  update public.bookings set manage_token_hash = extensions.digest(v_token, 'sha256') where id = v_booking;
  insert into public.inbox_notifications (business_id, permission, title, body, link)
  values (v_id, 'calendar.view', 'online_booking', (p ->> 'starts_at'), '/calendar?booking=' || v_booking);
  return jsonb_build_object('booking_id', v_booking, 'token', v_token);
end $$;

-- ─────────────────────────────────────────── manage a booking with the private link
create or replace function private.booking_by_token(p_token text) returns public.bookings
language sql stable security definer set search_path = '' as $$
  select * from public.bookings where manage_token_hash = extensions.digest(p_token, 'sha256');
$$;

create or replace function public.public_booking(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare bk public.bookings%rowtype; st public.business_settings%rowtype;
begin
  if length(coalesce(p_token, '')) <> 48 then return null; end if;
  bk := private.booking_by_token(p_token);
  if bk.id is null then return null; end if;
  select * into st from public.business_settings where business_id = bk.business_id;
  return jsonb_build_object(
    'status', bk.status, 'starts_at', bk.starts_at, 'ends_at', bk.ends_at,
    'quoted_total', bk.quoted_total, 'currency', st.currency, 'timezone', st.timezone,
    'plate', bk.plate_text, 'contact_name', bk.contact_name,
    'business', (select jsonb_build_object('name', b.name, 'slug', b.slug, 'phone', st.phone, 'brand_color', st.brand_color)
                   from public.businesses b where b.id = bk.business_id),
    'branch', (select jsonb_build_object('id', br.id, 'name', br.name, 'address', br.address_line, 'city', br.city)
                 from public.branches br where br.id = bk.branch_id),
    'services', (select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'price', bs.unit_price * bs.quantity)), '[]')
                   from public.booking_services bs join public.services s on s.id = bs.service_id where bs.booking_id = bk.id),
    'service_ids', (select coalesce(jsonb_agg(service_id), '[]') from public.booking_services where booking_id = bk.id),
    'vehicle_params', bk.vehicle_params,
    'can_change', bk.status in ('pending', 'confirmed')
                  and bk.starts_at > now() + make_interval(mins => st.booking_cancel_until_minutes));
end $$;

create or replace function public.public_cancel_booking(p_token text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare bk public.bookings%rowtype; st public.business_settings%rowtype;
begin
  perform private.rate_limit('manage:' || left(p_token, 12), 10, interval '10 minutes');
  bk := private.booking_by_token(p_token);
  if bk.id is null then raise exception 'booking_not_found' using errcode = 'P0002'; end if;
  select * into st from public.business_settings where business_id = bk.business_id;
  if bk.status not in ('pending', 'confirmed') or bk.starts_at <= now() + make_interval(mins => st.booking_cancel_until_minutes) then
    raise exception 'too_late_to_change' using errcode = '22023';
  end if;
  update public.bookings set status = 'cancelled', cancelled_reason = 'customer_link' where id = bk.id;
  perform private.enqueue_booking_event(bk.business_id, bk.id, 'booking_cancelled');
  perform private.offer_freed_slot(bk.business_id, bk.branch_id, (bk.starts_at at time zone st.timezone)::date);
end $$;

create or replace function public.public_reschedule_booking(p_token text, p_starts_at timestamptz) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare bk public.bookings%rowtype; st public.business_settings%rowtype; v_dur interval; v_ws uuid;
        v_services uuid[];
begin
  perform private.rate_limit('manage:' || left(p_token, 12), 10, interval '10 minutes');
  bk := private.booking_by_token(p_token);
  if bk.id is null then raise exception 'booking_not_found' using errcode = 'P0002'; end if;
  select * into st from public.business_settings where business_id = bk.business_id;
  if bk.status not in ('pending', 'confirmed') or bk.starts_at <= now() + make_interval(mins => st.booking_cancel_until_minutes)
     or p_starts_at < now() + make_interval(mins => st.booking_lead_minutes) then
    raise exception 'too_late_to_change' using errcode = '22023';
  end if;
  v_dur := bk.ends_at - bk.starts_at;
  v_services := array(select service_id from public.booking_services where booking_id = bk.id);
  -- any compatible post that is free and open at the new time (ignoring this booking itself)
  select w into v_ws from private.compatible_workstations(bk.business_id, bk.branch_id, v_services,
                                                          nullif(bk.vehicle_params ->> 'vehicle_category_id', '')::uuid) w
   where private.within_hours(w, p_starts_at, p_starts_at + v_dur, st.timezone)
     and not exists (select 1 from public.resource_occupancies o
                      where o.resource_kind = 'workstation' and o.resource_id = w
                        and o.during && tstzrange(p_starts_at, p_starts_at + v_dur, '[)')
                        and o.booking_id is distinct from bk.id)
   order by (w = bk.workstation_id) desc limit 1;
  if v_ws is null then raise exception 'slot_taken' using errcode = '23P01'; end if;
  update public.bookings set starts_at = p_starts_at, ends_at = p_starts_at + v_dur, workstation_id = v_ws,
         employee_id = case when v_ws = bk.workstation_id then employee_id end
   where id = bk.id;
  perform private.enqueue_booking_event(bk.business_id, bk.id, 'booking_rescheduled');
exception
  when exclusion_violation then raise exception 'slot_taken' using errcode = '23P01';
end $$;

-- ─────────────────────────────────────────── onboarding: everything a new tenant needs
create or replace function private.bootstrap_business(p_business uuid, p_locale public.app_locale, p_currency public.currency_code)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.business_settings (business_id, currency, crm_locale, public_locale,
      default_tax_rate_bp, timezone)
  values (p_business, p_currency, p_locale, p_locale,
      case p_currency when 'CZK' then 2100 when 'PLN' then 2300 when 'UAH' then 2000 else 2000 end,
      case p_currency when 'CZK' then 'Europe/Prague' when 'PLN' then 'Europe/Warsaw' when 'UAH' then 'Europe/Kyiv' else 'Europe/Vienna' end)
  on conflict (business_id) do nothing;

  insert into public.business_modules (business_id, module)
  select p_business, m from unnest(enum_range(null::public.module_key)) m
  on conflict do nothing;
  update public.business_modules set enabled = false
   where business_id = p_business and module in ('ai_assistant', 'corporate');

  insert into public.vehicle_categories (business_id, code, name, sort_order) values
    (p_business, 'car', 'Passenger car', 1), (p_business, 'suv', 'SUV', 2), (p_business, 'offroad', '4x4 / Off-road', 3),
    (p_business, 'van', 'Van / Minibus', 4), (p_business, 'commercial', 'Commercial', 5), (p_business, 'moto', 'Motorcycle', 6)
  on conflict do nothing;

  insert into public.payment_methods (business_id, code, name) values
    (p_business, 'cash', 'Cash'), (p_business, 'card', 'Card'), (p_business, 'transfer', 'Bank transfer'), (p_business, 'online', 'Online')
  on conflict do nothing;

  insert into public.service_categories (business_id, code, name, sort_order) values
    (p_business, 'seasonal', 'Seasonal wheel change', 1), (p_business, 'mounting', 'Tire mounting', 2),
    (p_business, 'balancing', 'Balancing', 3), (p_business, 'puncture', 'Puncture repair', 4),
    (p_business, 'repair', 'Tire repair', 5), (p_business, 'valves', 'Valve replacement', 6),
    (p_business, 'tpms', 'TPMS service', 7), (p_business, 'rims', 'Rim straightening', 8),
    (p_business, 'washing', 'Wheel washing', 9), (p_business, 'storage', 'Tire storage', 10),
    (p_business, 'sales', 'Tire sales', 11), (p_business, 'extra', 'Additional services', 12);

  insert into public.order_counters (business_id) values (p_business) on conflict do nothing;
end $$;

-- Super admin creates a tenant and invites (or attaches) the owner by user id.
create or replace function public.admin_create_business(
  p_slug text, p_name text, p_owner uuid, p_locale public.app_locale default 'en',
  p_currency public.currency_code default 'EUR', p_branch_name text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into public.businesses (slug, name) values (lower(p_slug), p_name) returning id into v_id;
  perform private.bootstrap_business(v_id, p_locale, p_currency);
  insert into public.branches (business_id, name) values (v_id, coalesce(p_branch_name, p_name));
  if p_owner is not null then
    insert into public.memberships (business_id, user_id, role, invited_by) values (v_id, p_owner, 'owner', auth.uid());
  end if;
  return v_id;
end $$;

create or replace function public.admin_set_business_active(p_business uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.businesses set is_active = p_active where id = p_business;
end $$;

create or replace function public.admin_set_module(p_business uuid, p_module public.module_key, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_platform_admin() or public.has_perm(p_business, 'business.manage')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.business_modules (business_id, module, enabled) values (p_business, p_module, p_enabled)
  on conflict (business_id, module) do update set enabled = excluded.enabled;
  perform private.audit(p_business, 'module_' || case when p_enabled then 'on' else 'off' end, 'business_modules', p_business,
                        jsonb_build_object('module', p_module));
end $$;

create or replace function public.admin_set_license(p_business uuid, p_kind text, p_valid_until date, p_max_branches int, p_max_users int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.businesses set license_kind = p_kind, license_valid_until = p_valid_until,
         max_branches = p_max_branches, max_users = p_max_users where id = p_business;
end $$;

-- Platform overview without any customer personal data: counts only.
create or replace function public.admin_list_businesses() returns table (
  id uuid, slug text, name text, is_active boolean, is_demo boolean, license_kind text,
  license_valid_until date, created_at timestamptz, members int, branches int, bookings_30d int,
  modules text[])
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select b.id, b.slug, b.name, b.is_active, b.is_demo, b.license_kind, b.license_valid_until, b.created_at,
    (select count(*)::int from public.memberships m where m.business_id = b.id and m.is_active),
    (select count(*)::int from public.branches br where br.business_id = b.id and br.deleted_at is null),
    (select count(*)::int from public.bookings bk where bk.business_id = b.id and bk.created_at > now() - interval '30 days'),
    (select coalesce(array_agg(bm.module::text order by bm.module), '{}') from public.business_modules bm where bm.business_id = b.id and bm.enabled)
  from public.businesses b where b.deleted_at is null order by b.created_at desc;
end $$;

-- Owner/manager invites a colleague who already has an account (email invites go
-- through the server action which uses the admin client to send the Supabase invite).
create or replace function public.add_member(p_business uuid, p_user uuid, p_role public.app_role) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_max int; v_count int;
begin
  perform private.require_perm(p_business, 'members.manage');
  if p_role = 'owner' and not exists (select 1 from public.memberships where business_id = p_business and user_id = auth.uid() and role = 'owner') then
    raise exception 'only_owner_can_add_owner' using errcode = '42501';
  end if;
  select max_users into v_max from public.businesses where id = p_business;
  select count(*) into v_count from public.memberships where business_id = p_business and is_active;
  if v_count >= v_max then raise exception 'user_limit_reached' using errcode = '54000'; end if;
  insert into public.memberships (business_id, user_id, role, invited_by) values (p_business, p_user, p_role, auth.uid())
  on conflict (business_id, user_id) do update set role = excluded.role, is_active = true
  returning id into v_id;
  return v_id;
end $$;

-- GDPR: anonymise a customer, keep financial rows (legal retention) without personal data.
create or replace function public.anonymize_customer(p_business uuid, p_customer uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_perm(p_business, 'customers.manage');
  if not public.has_perm(p_business, 'customers.export') then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.customers set first_name = '', last_name = '', phone = null, email = null, notes = null,
         anonymized_at = now(), preferred_channel = 'none'
   where id = p_customer and business_id = p_business;
  update public.bookings set contact_name = null, contact_phone = null, contact_email = null, customer_note = null
   where customer_id = p_customer and business_id = p_business;
  update public.notification_jobs set recipient = 'anonymized', body = '' where customer_id = p_customer and business_id = p_business;
  perform private.audit(p_business, 'anonymize', 'customers', p_customer, null);
end $$;

-- GDPR: everything stored about one customer, as JSON.
create or replace function public.export_customer(p_business uuid, p_customer uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_perm(p_business, 'customers.export');
  perform private.audit(p_business, 'export', 'customers', p_customer, null);
  return jsonb_build_object(
    'customer', (select to_jsonb(c) from public.customers c where c.id = p_customer and c.business_id = p_business),
    'consents', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.customer_consents x where x.customer_id = p_customer and x.business_id = p_business),
    'vehicles', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.vehicles x where x.customer_id = p_customer and x.business_id = p_business),
    'bookings', (select coalesce(jsonb_agg(to_jsonb(x) - 'manage_token_hash'), '[]') from public.bookings x where x.customer_id = p_customer and x.business_id = p_business),
    'work_orders', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.work_orders x where x.customer_id = p_customer and x.business_id = p_business),
    'payments', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.payments x where x.customer_id = p_customer and x.business_id = p_business),
    'tire_sets', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.tire_sets x where x.customer_id = p_customer and x.business_id = p_business));
end $$;

-- Merge duplicate customers: move everything to the survivor.
create or replace function public.merge_customers(p_business uuid, p_keep uuid, p_merge uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_perm(p_business, 'customers.manage');
  if p_keep = p_merge then raise exception 'same_customer' using errcode = '22023'; end if;
  if (select count(*) from public.customers where id in (p_keep, p_merge) and business_id = p_business and merged_into is null) <> 2 then
    raise exception 'customer_not_found' using errcode = 'P0002';
  end if;
  update public.vehicles set customer_id = p_keep where customer_id = p_merge and business_id = p_business;
  update public.bookings set customer_id = p_keep where customer_id = p_merge and business_id = p_business;
  update public.work_orders set customer_id = p_keep where customer_id = p_merge and business_id = p_business;
  update public.tire_sets set customer_id = p_keep where customer_id = p_merge and business_id = p_business;
  update public.customer_consents set customer_id = p_keep where customer_id = p_merge and business_id = p_business;
  insert into public.customer_tags (business_id, customer_id, tag_id)
    select business_id, p_keep, tag_id from public.customer_tags where customer_id = p_merge
  on conflict do nothing;
  update public.customers k set
    visits_count = k.visits_count + m.visits_count, total_spent = k.total_spent + m.total_spent,
    last_visit_at = greatest(k.last_visit_at, m.last_visit_at),
    email = coalesce(k.email, m.email), phone = coalesce(k.phone, m.phone),
    notes = concat_ws(E'\n', k.notes, m.notes)
  from public.customers m where k.id = p_keep and m.id = p_merge;
  update public.customers set merged_into = p_keep, deleted_at = now() where id = p_merge;
  perform private.audit(p_business, 'merge', 'customers', p_keep, jsonb_build_object('merged', p_merge));
end $$;
