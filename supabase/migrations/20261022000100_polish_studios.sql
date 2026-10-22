-- Polish studios (first: Detailing Studio MS, Bydgoszcz).
--   * PLN and pl-PL in the list of currencies and interface languages;
--   * demo bookings and closed-day labels in Polish.

alter table public.tenants drop constraint tenants_currency_check;
alter table public.tenants add constraint tenants_currency_check
  check (currency in ('RUB', 'KZT', 'BYN', 'EUR', 'USD', 'CZK', 'PLN'));
alter table public.tenants drop constraint tenants_locale_check;
alter table public.tenants add constraint tenants_locale_check check (locale in ('ru-RU', 'cs-CZ', 'pl-PL'));

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
           faq = coalesce(p_config -> 'faq', '[]'::jsonb)
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
    elsif p_config ->> 'locale' = 'pl-PL' then
      update public.schedule_exceptions set note = 'Zamknięte'
       where tenant_id = v_tenant and source = 'config' and note = 'Выходной';
    end if;
  end if;
  return r;
end $$;

create or replace function public.svc_seed_demo_bookings(p_slug text) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  t public.tenants;
  v_today date;
  v_services uuid[];
  v_count int := 0;
  v_cs boolean;
  v_pl boolean;
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
  v_pl := t.locale = 'pl-PL';
  if v_pl then
    v_names := array['Demo: Piotr', 'Demo: Anna', 'Demo: Tomasz', 'Demo: Katarzyna', 'Demo: Michał', 'Demo: Magdalena', 'Demo: Krzysztof', 'Demo: Agnieszka'];
    v_cars := array['Toyota Corolla', 'Škoda Octavia', 'Volkswagen Golf', 'BMW X5', 'Toyota RAV4', 'Audi A4', 'Opel Astra', 'Kia Sportage'];
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
      where (extract(hour from c.start_at at time zone t.timezone) in (10, 14) and v_day < 0
             or extract(hour from c.start_at at time zone t.timezone) = 10 and v_day >= 0 and v_day % 2 = 1)
        and extract(minute from c.start_at at time zone t.timezone) = 0
    loop
      i := i + 1;
      begin
        v_res := private.create_booking(
          t.id, v_services[1 + (i % array_length(v_services, 1))], v_slot.start_at, null,
          v_names[1 + (i % 8)], case when v_cs then '+42070000' when v_pl then '+4850000' else '+7900000' end || lpad((1000 + i)::text, 4, '0'), v_cars[1 + (i % 8)],
          case when v_cs then 'Ukázková rezervace' when v_pl then 'Rezerwacja przykładowa' else 'Демонстрационная запись' end, 'demo-' || t.id || '-' || i, 'demo', null, false);
        v_booking := (v_res -> 'booking' ->> 'id')::uuid;
        v_count := v_count + 1;
        if v_day < 0 then
          update public.bookings set status = 'ready', arrived_at = start_at, ready_at = end_at where id = v_booking;
          insert into public.payments (tenant_id, booking_id, kind, amount, method, paid_at, note, idempotency_key)
          select t.id, b.id, 'payment', b.price, case when i % 2 = 0 then 'card' else 'cash' end::public.payment_method,
                 b.end_at, case when v_cs then 'Ukázková platba' when v_pl then 'Płatność przykładowa' else 'Демо-оплата' end, 'demo-pay-' || b.id
          from public.bookings b where b.id = v_booking and b.price > 0;
        end if;
      exception when sqlstate 'PT409' then
        null; -- slot already used by another demo row
      end;
    end loop;
  end loop;
  return v_count;
end $$;
