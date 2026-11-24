-- Beauty demo bookings: no demo payment for services quoted on request
-- (price 0). The guard from 20261018000500 was lost when the beauty version
-- replaced svc_seed_demo_bookings, so seeding a studio with a free
-- consultation failed on payments_amount_check.

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
            from public.bookings b where b.id = v_booking and b.price > 0;
          end if;
        end if;
      exception when sqlstate 'PT409' or sqlstate 'PT422' then
        null; -- closed that day, outside a shift or already used by another demo row
      end;
    end loop;
  end loop;
  return v_count;
end $$;

revoke execute on function public.svc_seed_demo_bookings(text) from public, anon, authenticated;
grant execute on function public.svc_seed_demo_bookings(text) to service_role;
