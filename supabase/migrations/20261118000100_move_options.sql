-- Free start times for moving an existing booking.
--
-- Before this, the move picker (owner and client) asked the generic
-- availability, which
--   * counted the booking's own occupancy as busy, so a booking could not be
--     shifted by half an hour on the same day, and
--   * (owner) used the bare service duration, ignoring chosen add-ons and the
--     booking's own buffer, so some offered times then failed with SLOT_TAKEN.
-- Now both pickers use the booking's own duration and buffer and ignore its
-- own occupancy, the same rules reschedule_core applies when it moves it.

-- Free suitable resources at a start, optionally ignoring one booking.
create or replace function private.free_resources_at_excl(
  p_tenant uuid, p_service uuid, p_resource uuid, p_start timestamptz, p_minutes int, p_occ_minutes int, p_exclude uuid
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
        and (p_exclude is null or o.booking_id is distinct from p_exclude)
        and o.period && tstzrange(p_start, p_start + make_interval(mins => p_occ_minutes), '[)')
    );
$$;

create or replace function private.free_resources_at(
  p_tenant uuid, p_service uuid, p_resource uuid, p_start timestamptz, p_minutes int, p_occ_minutes int
) returns table (resource_id uuid)
language sql stable set search_path = '' as $$
  select * from private.free_resources_at_excl(p_tenant, p_service, p_resource, p_start, p_minutes, p_occ_minutes, null);
$$;

-- availability_v2 plus: an explicit buffer and a booking whose occupancy is ignored.
create or replace function private.availability_v3(
  p_tenant uuid, p_service uuid, p_duration int, p_resource uuid, p_from date, p_days int, p_public boolean,
  p_buffer int, p_exclude uuid
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
  v_occ := v_duration + coalesce(p_buffer, s.buffer_minutes, t.default_buffer_minutes);
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
               'available', exists (select 1 from private.free_resources_at_excl(t.id, s.id, p_resource, c.start_at, v_duration, v_occ, p_exclude))
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

create or replace function private.availability_v2(
  p_tenant uuid, p_service uuid, p_duration int, p_resource uuid, p_from date, p_days int, p_public boolean
) returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.availability_v3(p_tenant, p_service, p_duration, p_resource, p_from, p_days, p_public, null, null);
$$;

-- Client: free times for moving their booking (by token).
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
  return private.availability_v3(b.tenant_id, b.service_id, b.duration_minutes,
                                 case when v_keep then b.resource_id end, p_from, p_days, true,
                                 b.buffer_minutes, b.id);
end $$;

-- Owner: free times for moving a booking (any suitable resource, like owner_reschedule_booking).
create or replace function public.owner_move_options(p_booking_id uuid, p_from date default null, p_days int default 7)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking_id;
  if not found then
    perform private.fail('404', 'BOOKING_NOT_FOUND', 'Запись не найдена');
  end if;
  perform private.require_member(b.tenant_id);
  return private.availability_v3(b.tenant_id, b.service_id, b.duration_minutes, null, p_from, p_days, false,
                                 b.buffer_minutes, b.id);
end $$;

revoke execute on all functions in schema private from public, anon;
grant execute on function private.is_member(uuid), private.try_uuid(text) to authenticated;

revoke execute on function public.public_reschedule_options(text, text, date, int) from public;
grant execute on function public.public_reschedule_options(text, text, date, int) to anon, authenticated;

revoke execute on function public.owner_move_options(uuid, date, int) from public, anon;
grant execute on function public.owner_move_options(uuid, date, int) to authenticated, service_role;
