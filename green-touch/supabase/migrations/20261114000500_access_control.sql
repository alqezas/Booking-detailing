-- Row Level Security, grants, owner operations, Storage and background jobs.
-- Anonymous visitors: dictionaries + read-only catalog RPCs. Never orders or payments.
-- Admin = a row in public.admins (created by the setup script; no public sign-up).

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all tables in schema private from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;

grant usage on schema private to anon, authenticated, service_role;
grant execute on function private.is_admin() to anon, authenticated, service_role;

alter table public.admins enable row level security;
alter table public.categories enable row level security;
alter table public.facets enable row level security;
alter table public.items enable row level security;
alter table public.item_facets enable row level security;
alter table public.item_images enable row level security;
alter table public.kit_components enable row level security;
alter table public.home_picks enable row level security;
alter table public.shop_settings enable row level security;
alter table public.pages enable row level security;
alter table public.orders enable row level security;
alter table public.order_lines enable row level security;
alter table public.order_line_components enable row level security;
alter table public.payment_attempts enable row level security;
alter table public.payment_events enable row level security;
alter table public.outbox enable row level security;
alter table public.outbox_effects enable row level security;
alter table public.order_timeline enable row level security;
alter table private.rate_limits enable row level security;

-- Public dictionaries
grant select on public.categories, public.facets to anon, authenticated;
create policy categories_read on public.categories for select to anon, authenticated using (true);
create policy facets_read on public.facets for select to anon, authenticated using (true);

-- A signed-in user can see whether they are an admin (their own row only).
grant select on public.admins to authenticated;
create policy admins_self on public.admins for select to authenticated using (user_id = (select auth.uid()));

-- Owner-managed catalog and content: full access for admins only.
grant select, insert, update, delete on public.items, public.item_facets, public.item_images,
  public.kit_components, public.home_picks, public.shop_settings, public.pages to authenticated;
grant insert, update, delete on public.categories, public.facets to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['items', 'item_facets', 'item_images', 'kit_components', 'home_picks', 'shop_settings', 'pages'] loop
    execute format('create policy %I on public.%I for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()))', t || '_admin', t);
  end loop;
  foreach t in array array['categories', 'facets'] loop
    execute format('create policy %I on public.%I for insert to authenticated with check ((select private.is_admin()))', t || '_admin_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()))', t || '_admin_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select private.is_admin()))', t || '_admin_del', t);
  end loop;
end $$;

-- Orders and payments: admins read; nobody writes directly (owner actions go through RPCs).
grant select on public.orders, public.order_lines, public.order_line_components,
  public.payment_attempts, public.payment_events, public.outbox, public.order_timeline to authenticated;
do $$
declare
  t text;
begin
  foreach t in array array['orders', 'order_lines', 'order_line_components', 'payment_attempts', 'payment_events', 'outbox', 'order_timeline'] loop
    execute format('create policy %I on public.%I for select to authenticated using ((select private.is_admin()))', t || '_admin_read', t);
  end loop;
end $$;
-- The owner sees orders but not the guest token hash or the request fingerprint.
revoke select on public.orders from authenticated;
grant select (id, number, first_name, last_name, phone, email, comment, delivery_method, np_settlement_ref, np_city_ref,
  np_settlement_name, np_area, np_warehouse_ref, np_warehouse_number, np_warehouse_name, np_warehouse_type_ref,
  subtotal_kop, discount_kop, total_kop, currency, payment_status, paid_attempt_id, paid_at, fulfillment_status,
  needs_review, review_reasons, ttn, owner_note, created_at, updated_at) on public.orders to authenticated;

-- ── Owner operations ─────────────────────────────────────────────────────────
create function private.assert_admin() returns void
language plpgsql stable set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
end $$;

-- Fulfilment only. Payment status is never writable here: only provider events change it.
create function public.admin_update_order(p_order uuid, p_fulfillment text, p_ttn text default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.orders;
begin
  perform private.assert_admin();
  select * into v from public.orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if p_fulfillment not in ('new', 'processing', 'packed', 'shipped', 'delivered', 'cancelled') then
    raise exception 'BAD_STATUS';
  end if;
  if p_fulfillment in ('processing', 'packed', 'shipped', 'delivered') and (v.payment_status <> 'paid' or v.needs_review) then
    raise exception 'NOT_READY_TO_SHIP' using detail = 'Оплата не підтверджена LiqPay або замовлення потребує перевірки';
  end if;
  if p_fulfillment = 'shipped' and coalesce(nullif(p_ttn, ''), v.ttn) is null then
    raise exception 'TTN_REQUIRED';
  end if;
  update public.orders
    set fulfillment_status = p_fulfillment,
        ttn = coalesce(nullif(regexp_replace(coalesce(p_ttn, ''), '\s', '', 'g'), ''), ttn),
        owner_note = coalesce(p_note, owner_note)
  where id = p_order;
  if p_fulfillment = 'cancelled' and v.fulfillment_status <> 'cancelled' then
    if v.payment_status = 'paid' then
      perform private.add_review(p_order, 'cancelled_after_payment');
    end if;
  end if;
  insert into public.order_timeline (order_id, event, details)
  values (p_order, 'owner.fulfillment', jsonb_build_object('from', v.fulfillment_status, 'to', p_fulfillment, 'ttn', p_ttn, 'by', (select auth.uid())));
  return jsonb_build_object('ok', true);
end $$;

create function public.admin_resolve_review(p_order uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_admin();
  if coalesce(length(btrim(p_note)), 0) < 3 then raise exception 'NOTE_REQUIRED'; end if;
  update public.orders set needs_review = false, owner_note = left(p_note, 2000) where id = p_order and needs_review;
  if not found then raise exception 'NOTHING_TO_RESOLVE'; end if;
  insert into public.order_timeline (order_id, event, details)
  values (p_order, 'owner.review_resolved', jsonb_build_object('note', left(p_note, 500), 'by', (select auth.uid())));
  return jsonb_build_object('ok', true);
end $$;

create function public.admin_set_item_facets(p_item uuid, p_facets smallint[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_admin();
  delete from public.item_facets where item_id = p_item and facet_id <> all (coalesce(p_facets, '{}'));
  insert into public.item_facets (item_id, facet_id)
  select p_item, unnest(coalesce(p_facets, '{}')) on conflict do nothing;
end $$;

-- p_components: [{"id": uuid, "qty": int}]
create function public.admin_set_kit_components(p_kit uuid, p_components jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_admin();
  if jsonb_array_length(coalesce(p_components, '[]')) > 20 then raise exception 'TOO_MANY_COMPONENTS'; end if;
  delete from public.kit_components where kit_id = p_kit;
  insert into public.kit_components (kit_id, product_id, qty, sort)
  select p_kit, (e ->> 'id')::uuid, (e ->> 'qty')::int, (row_number() over ())::int
  from jsonb_array_elements(coalesce(p_components, '[]')) e;
end $$;

create function public.admin_set_home_picks(p_items uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_admin();
  delete from public.home_picks;
  insert into public.home_picks (item_id, sort)
  select x.id, x.ord::int from unnest(coalesce(p_items, '{}')) with ordinality as x(id, ord);
end $$;

create function public.admin_retry_outbox(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_admin();
  update public.outbox set status = 'pending', attempts = 0, available_at = now(), last_error = null
  where id = p_id and status = 'dead';
end $$;

-- Owner's admin item list with live price/availability (kits after discount).
create function public.admin_items() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'kind', s.kind, 'slug', s.slug, 'name', s.name, 'volume', s.volume, 'status', s.status,
      'category', c.slug, 'price_kop', s.price_kop, 'base_kop', s.base_kop, 'available', s.available,
      'orderable', s.orderable,
      'images', (select count(*) from public.item_images im where im.item_id = s.id),
      'facets', (select count(*) from public.item_facets f where f.item_id = s.id),
      'components', (select count(*) from public.kit_components k where k.kit_id = s.id),
      'home_pick', exists (select 1 from public.home_picks h where h.item_id = s.id)
    ) order by c.sort, s.sort, s.name), '[]')
    from private.item_state s join public.categories c on c.id = s.category_id);
end $$;

-- What the owner still has to provide before launch (computed, never invented).
create function public.admin_launch_checklist() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_admin();
  return jsonb_build_object(
    'published_items', (select count(*) from public.items where status = 'published'),
    'without_photos', (select count(*) from public.items i where i.status = 'published' and not exists (select 1 from public.item_images im where im.item_id = i.id)),
    'without_facets', (select count(*) from public.items i where i.status = 'published' and not exists (select 1 from public.item_facets f where f.item_id = i.id)),
    'without_description', (select count(*) from public.items where status = 'published' and coalesce(description, '') = ''),
    'without_inci', (select count(*) from public.items where status = 'published' and kind <> 'kit' and coalesce(inci, '') = ''),
    'without_usage', (select count(*) from public.items where status = 'published' and coalesce(usage, '') = ''),
    'kits_published', (select count(*) from public.items where kind = 'kit' and status = 'published'),
    'kits_draft', (select count(*) from public.items where kind = 'kit' and status = 'draft'),
    'samples', (select count(*) from public.items where kind = 'sample'),
    'pages_need_review', (select coalesce(jsonb_agg(title order by slug), '[]') from public.pages where needs_review),
    'contacts_missing', (select coalesce(jsonb_agg(k), '[]') from public.shop_settings s, jsonb_each(s.value) e(k, v)
                         where s.key = 'contacts' and (v = 'null'::jsonb or v = '""'::jsonb)),
    'orders_need_review', (select count(*) from public.orders where needs_review),
    'outbox_dead', (select count(*) from public.outbox where status = 'dead')
  );
end $$;

create function public.am_i_admin() returns boolean
language sql stable security definer set search_path = '' as $$ select private.is_admin(); $$;

grant execute on function public.admin_update_order(uuid, text, text, text), public.admin_resolve_review(uuid, text),
  public.admin_set_item_facets(uuid, smallint[]), public.admin_set_kit_components(uuid, jsonb),
  public.admin_set_home_picks(uuid[]), public.admin_retry_outbox(bigint), public.admin_items(),
  public.admin_launch_checklist(), public.am_i_admin() to authenticated;

-- ── Storage: public product photos, writable by admins only ──────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catalog', 'catalog', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy catalog_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'catalog' and (select private.is_admin()) and name ~ '^(items|brand)/[0-9a-z-]{1,36}/[A-Za-z0-9._-]{1,120}$');
create policy catalog_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'catalog' and (select private.is_admin()))
  with check (bucket_id = 'catalog' and (select private.is_admin()));
create policy catalog_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'catalog' and (select private.is_admin()));

-- ── Background jobs (pg_cron) ────────────────────────────────────────────────
-- Payment reconciliation and outbox delivery need HTTP, so cron wakes the `jobs` Edge Function through pg_net with a shared
-- secret kept in Vault (names gt_jobs_url, gt_jobs_secret; see SETUP.md).
create extension if not exists pg_cron;
create extension if not exists pg_net;

create function private.wake_jobs() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'gt_jobs_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'gt_jobs_secret';
  if v_url is null or v_secret is null then
    return; -- not configured yet: nothing is lost, outbox rows wait
  end if;
  perform net.http_post(url := v_url, body := '{"task":"all"}'::jsonb,
    headers := jsonb_build_object('content-type', 'application/json', 'x-jobs-secret', v_secret),
    timeout_milliseconds := 55000);
end $$;

select cron.schedule('gt-wake-jobs', '* * * * *', 'select private.wake_jobs()');
