-- TireFlow · Row Level Security on every table, least-privilege grants, realtime, storage

-- ─────────────────────────────────────────── enable RLS everywhere in public
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('alter table public.%I force row level security', t.tablename);
  end loop;
end $$;

-- Anonymous visitors never touch tables directly; the public booking page uses RPCs.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

-- Writes to these tables go only through SECURITY DEFINER RPCs, which keep
-- invariants (journals, totals, occupancy). Clients may only read them.
do $$
declare t text;
begin
  foreach t in array array[
    'audit_logs', 'idempotency_keys', 'public_rate_limits', 'order_counters', 'permissions', 'role_permissions',
    'platform_admins', 'business_modules', 'memberships', 'bookings', 'booking_services', 'resource_occupancies',
    'work_orders', 'work_order_items', 'work_order_status_history', 'payments', 'inventory_movements',
    'inventory_stock', 'tire_sets', 'tire_set_items', 'tire_storage_contracts', 'tire_storage_movements',
    'notification_jobs', 'notification_logs', 'support_access_grants', 'businesses'
  ] loop
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
  end loop;
end $$;

-- A few safe columns stay directly editable.
grant update (internal_note, customer_note) on public.bookings to authenticated;
grant update (damage_notes, customer_note, internal_note, mileage_km, employee_id, workstation_id, due_date)
  on public.work_orders to authenticated;
grant update (manufacturer, model, notes, condition, load_index, speed_index) on public.tire_sets to authenticated;
grant update (dot, tread_mm, damage, photo_paths) on public.tire_set_items to authenticated;
grant update (name) on public.businesses to authenticated;
revoke update on public.storage_locations from authenticated;
grant update (capacity_sets, is_active) on public.storage_locations to authenticated;

-- ─────────────────────────────────────────── policy generator for the standard shape
-- read: member with p_read (or any member when null); write: member with p_write.
create or replace function private.std_policies(p_table text, p_read text, p_write text, p_module text default null)
returns void language plpgsql as $$
declare
  v_mod text := case when p_module is null then 'true'
                     else format('public.module_enabled(business_id, %L::public.module_key)', p_module) end;
  v_read text := case when p_read is null then 'public.is_member(business_id)'
                      else format('public.has_perm(business_id, %L)', p_read) end;
begin
  execute format('create policy %I on public.%I for select to authenticated using (%s and %s)',
                 p_table || '_select', p_table, v_read, v_mod);
  if p_write is not null then
    execute format('create policy %I on public.%I for insert to authenticated with check (public.has_perm(business_id, %L) and %s)',
                   p_table || '_insert', p_table, p_write, v_mod);
    execute format('create policy %I on public.%I for update to authenticated using (public.has_perm(business_id, %L) and %s) with check (public.has_perm(business_id, %L))',
                   p_table || '_update', p_table, p_write, v_mod, p_write);
    execute format('create policy %I on public.%I for delete to authenticated using (public.has_perm(business_id, %L) and %s)',
                   p_table || '_delete', p_table, p_write, v_mod);
  end if;
end $$;

select private.std_policies('business_settings', null, 'business.manage');
select private.std_policies('business_modules', null, null);
select private.std_policies('branches', null, 'business.manage');
select private.std_policies('branch_closures', null, 'calendar.manage');
select private.std_policies('corporate_customers', 'customers.view', 'customers.manage', 'corporate');
select private.std_policies('customers', 'customers.view', 'customers.manage');
select private.std_policies('customer_consents', 'customers.view', 'customers.manage');
select private.std_policies('tags', null, 'customers.manage');
select private.std_policies('customer_tags', 'customers.view', 'customers.manage');
select private.std_policies('vehicle_categories', null, 'services.manage');
select private.std_policies('vehicles', 'customers.view', 'customers.manage');
select private.std_policies('employees', 'calendar.view', 'employees.manage');
select private.std_policies('employee_schedules', 'calendar.view', 'employees.manage');
select private.std_policies('employee_absences', 'calendar.view', 'employees.manage');
select private.std_policies('workstations', null, 'business.manage');
select private.std_policies('workstation_schedules', null, 'business.manage');
select private.std_policies('service_categories', null, 'services.manage');
select private.std_policies('services', null, 'services.manage');
select private.std_policies('service_workstations', null, 'services.manage');
select private.std_policies('pricing_rules', null, 'services.manage');
select private.std_policies('duration_rules', null, 'services.manage');
select private.std_policies('bookings', 'calendar.view', 'calendar.manage');
select private.std_policies('booking_services', 'calendar.view', null);
select private.std_policies('resource_occupancies', 'calendar.view', null);
select private.std_policies('waiting_list', 'calendar.view', 'calendar.manage');
select private.std_policies('suppliers', 'inventory.view', 'inventory.manage');
select private.std_policies('warehouses', null, 'business.manage');
select private.std_policies('products', 'inventory.view', 'inventory.manage', 'inventory');
select private.std_policies('inventory_movements', 'inventory.view', null, 'inventory');
select private.std_policies('inventory_stock', 'inventory.view', null, 'inventory');
select private.std_policies('work_orders', 'orders.view_all', 'orders.manage');
select private.std_policies('work_order_items', 'orders.view_all', null);
select private.std_policies('work_order_status_history', 'orders.view_all', null);
select private.std_policies('payment_methods', null, 'business.manage');
select private.std_policies('expenses', 'finance.view', 'finance.manage', 'finance');
select private.std_policies('storage_locations', 'tire_hotel.view', 'tire_hotel.manage', 'tire_hotel');
select private.std_policies('tire_sets', 'tire_hotel.view', 'tire_hotel.manage', 'tire_hotel');
select private.std_policies('tire_set_items', 'tire_hotel.view', 'tire_hotel.manage', 'tire_hotel');
select private.std_policies('tire_storage_contracts', 'tire_hotel.view', null, 'tire_hotel');
select private.std_policies('tire_storage_movements', 'tire_hotel.view', null, 'tire_hotel');
select private.std_policies('notification_channels', 'notifications.manage', 'notifications.manage');
select private.std_policies('notification_templates', 'notifications.manage', 'notifications.manage');
select private.std_policies('marketing_campaigns', 'notifications.manage', 'notifications.manage');
select private.std_policies('notification_jobs', 'notifications.manage', null);
select private.std_policies('notification_logs', 'notifications.manage', null);
select private.std_policies('documents', null, 'orders.manage');
select private.std_policies('attachments', null, null);
select private.std_policies('audit_logs', 'audit.view', null);
select private.std_policies('support_access_grants', 'business.manage', null);

-- payments: finance readers, plus managers who take payments
create policy payments_select on public.payments for select to authenticated
  using (public.has_perm(business_id, 'finance.view') or public.has_perm(business_id, 'finance.manage'));

-- attachments: any active member may upload; delete only by the uploader or a manager
create policy attachments_insert on public.attachments for insert to authenticated
  with check (public.is_member(business_id) and uploaded_by = auth.uid());
create policy attachments_delete on public.attachments for delete to authenticated
  using (public.is_member(business_id) and (uploaded_by = auth.uid() or public.has_perm(business_id, 'orders.manage')));

-- businesses
create policy businesses_select on public.businesses for select to authenticated
  using (public.is_member(id) or public.is_platform_admin());
create policy businesses_update on public.businesses for update to authenticated
  using (public.has_perm(id, 'business.manage')) with check (public.has_perm(id, 'business.manage'));

-- memberships: colleagues see each other (for names on the calendar)
create policy memberships_select on public.memberships for select to authenticated
  using (user_id = auth.uid() or public.is_member(business_id));

-- profiles: own row, and colleagues' names
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or exists (
    select 1 from public.memberships m1 join public.memberships m2 on m1.business_id = m2.business_id
     where m1.user_id = auth.uid() and m1.is_active and m2.user_id = profiles.id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke insert, delete on public.profiles from authenticated;

create policy platform_admins_select on public.platform_admins for select to authenticated using (user_id = auth.uid());
create policy permissions_select on public.permissions for select to authenticated using (true);
create policy role_permissions_select on public.role_permissions for select to authenticated using (true);

create policy inbox_select on public.inbox_notifications for select to authenticated
  using (public.is_member(business_id) and (user_id = auth.uid()
         or (user_id is null and (permission is null or public.has_perm(business_id, permission)))));
create policy inbox_update on public.inbox_notifications for update to authenticated
  using (public.is_member(business_id) and (user_id = auth.uid() or user_id is null));
revoke insert, delete on public.inbox_notifications from authenticated;
revoke update on public.inbox_notifications from authenticated;
grant update (read_at) on public.inbox_notifications to authenticated;

create policy push_own on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- the view inherits RLS of customer_consents (security_invoker)
grant select on public.customer_consent_state to authenticated;

-- ─────────────────────────────────────────── function execute privileges
-- PostgreSQL grants EXECUTE to PUBLIC by default. Lock everything down, then open
-- the staff RPCs to signed-in users and only the public_* RPCs to anon.
revoke execute on all functions in schema public from public, anon;
alter default privileges in schema public revoke execute on functions from public;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.claim_notification_jobs(text, int) from authenticated;
revoke execute on function public.complete_notification_job(uuid, boolean, text, text, text, boolean) from authenticated;
revoke execute on function public.schedule_periodic_notifications() from authenticated;
grant execute on function public.public_business(text) to anon;
grant execute on function public.public_quote(text, uuid[], jsonb) to anon;
grant execute on function public.public_slots(text, uuid, date, uuid[], jsonb) to anon;
grant execute on function public.public_create_booking(text, jsonb) to anon;
grant execute on function public.public_booking(text) to anon;
grant execute on function public.public_cancel_booking(text) to anon;
grant execute on function public.public_reschedule_booking(text, timestamptz) to anon;
grant execute on all functions in schema public to service_role;

-- ─────────────────────────────────────────── realtime: only the tables the UI listens to
alter publication supabase_realtime add table public.bookings, public.work_orders, public.inbox_notifications;

-- ─────────────────────────────────────────── storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('public-assets', 'public-assets', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']),
  ('private-files', 'private-files', false, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

-- Object path convention: <business_id>/<entity>/<uuid>.<ext>
create policy "public assets readable" on storage.objects for select
  using (bucket_id = 'public-assets');
create policy "public assets managed by business" on storage.objects for insert to authenticated
  with check (bucket_id = 'public-assets'
              and public.has_perm(((storage.foldername(name))[1])::uuid, 'business.manage'));
create policy "public assets deletable by business" on storage.objects for delete to authenticated
  using (bucket_id = 'public-assets'
         and public.has_perm(((storage.foldername(name))[1])::uuid, 'business.manage'));

create policy "private files readable by members" on storage.objects for select to authenticated
  using (bucket_id = 'private-files' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "private files uploadable by members" on storage.objects for insert to authenticated
  with check (bucket_id = 'private-files' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "private files deletable by managers" on storage.objects for delete to authenticated
  using (bucket_id = 'private-files' and public.has_perm(((storage.foldername(name))[1])::uuid, 'orders.manage'));
