-- Access control.
--
-- anon:          no table access at all; only the public_* functions in 0300,
--                which return sanitized data and never personal data of others.
-- authenticated: read access to its own tenants' rows (membership checked on
--                the server via tenant_members); writes to catalogue tables
--                guarded by RLS; bookings, occupancies and payments are
--                written only through owner_* functions.
-- service_role:  edge functions only (rate limits, LLM budget, outbox).

create or replace function private.is_member(p_tenant uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tenant_members m
    where m.tenant_id = p_tenant and m.user_id = (select auth.uid())
  );
$$;
revoke all on function private.is_member(uuid) from public;
grant usage on schema private to authenticated, service_role;
grant execute on function private.is_member(uuid) to authenticated, service_role;

-- Owners raise this when a call names a tenant they are not a member of.
create or replace function private.require_member(p_tenant uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not private.is_member(p_tenant) then
    raise exception 'forbidden' using errcode = 'PT403', hint = 'Нет доступа к этой студии';
  end if;
end $$;
revoke all on function private.require_member(uuid) from public;

-- tenants: members read their studios; edits go through owner_update_tenant.
create policy tenants_member_select on public.tenants
  for select to authenticated using (private.is_member(id));
grant select on public.tenants to authenticated;

create policy tenant_members_self on public.tenant_members
  for select to authenticated using (user_id = (select auth.uid()));
grant select on public.tenant_members to authenticated;

-- Catalogue tables: full CRUD for members, scoped by tenant_id. Composite FKs
-- stop a member linking rows across tenants even with a forged tenant_id.
do $$
declare t text;
begin
  foreach t in array array['resources', 'services', 'service_resources', 'schedule_exceptions', 'gallery_items', 'info_cards']
  loop
    execute format('create policy %1$s_member_all on public.%1$s for all to authenticated
                    using (private.is_member(tenant_id)) with check (private.is_member(tenant_id))', t);
    execute format('grant select, insert, update, delete on public.%1$s to authenticated', t);
  end loop;
end $$;

-- Working hours are replaced as a whole week by owner_set_working_hours.
create policy working_hours_member_select on public.working_hours
  for select to authenticated using (private.is_member(tenant_id));
grant select on public.working_hours to authenticated;

-- Operational tables: read-only for members.
create policy bookings_member_select on public.bookings
  for select to authenticated using (private.is_member(tenant_id));
create policy occupancies_member_select on public.resource_occupancies
  for select to authenticated using (private.is_member(tenant_id));
create policy payments_member_select on public.payments
  for select to authenticated using (private.is_member(tenant_id));
grant select on public.bookings, public.resource_occupancies, public.payments to authenticated;

-- booking_access, push_subscriptions, notification_jobs: no policies and no
-- grants, so neither anon nor authenticated can read tokens or endpoints.

-- Owners must not change the tenant a catalogue row belongs to, nor flip a
-- row's provenance back to "config" to make the pipeline overwrite it.
create or replace function private.guard_catalogue_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id is immutable' using errcode = 'PT422';
  end if;
  if (select auth.role()) = 'authenticated' then
    new.source := 'owner';
  end if;
  return new;
end $$;

create trigger services_guard before update on public.services
  for each row execute function private.guard_catalogue_update();
create trigger resources_guard before update on public.resources
  for each row execute function private.guard_catalogue_update();
create trigger gallery_items_guard before update on public.gallery_items
  for each row execute function private.guard_catalogue_update();
create trigger info_cards_guard before update on public.info_cards
  for each row execute function private.guard_catalogue_update();
create trigger schedule_exceptions_guard before update on public.schedule_exceptions
  for each row execute function private.guard_catalogue_update();

create or replace function private.mark_owner_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select auth.role()) = 'authenticated' then
    new.source := 'owner';
  end if;
  return new;
end $$;
create trigger services_owner_insert before insert on public.services
  for each row execute function private.mark_owner_insert();
create trigger resources_owner_insert before insert on public.resources
  for each row execute function private.mark_owner_insert();
create trigger gallery_items_owner_insert before insert on public.gallery_items
  for each row execute function private.mark_owner_insert();
create trigger info_cards_owner_insert before insert on public.info_cards
  for each row execute function private.mark_owner_insert();
create trigger schedule_exceptions_owner_insert before insert on public.schedule_exceptions
  for each row execute function private.mark_owner_insert();

-- Any owner content edit is remembered so `tenant:publish` on a live studio
-- does not silently overwrite it.
create or replace function private.note_owner_edit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  if (select auth.role()) = 'authenticated' then
    v_tenant := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
    update public.tenants set owner_edited_at = now() where id = v_tenant;
  end if;
  return null;
end $$;
do $$
declare t text;
begin
  foreach t in array array['resources', 'services', 'service_resources', 'schedule_exceptions', 'gallery_items', 'info_cards']
  loop
    execute format('create trigger %1$s_owner_edit after insert or update or delete on public.%1$s
                    for each row execute function private.note_owner_edit()', t);
  end loop;
end $$;
