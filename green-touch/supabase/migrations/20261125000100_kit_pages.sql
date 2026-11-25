-- Kit pages as designed by the owner (24.11.2026):
--  • «Очікуваний результат» section (items.expected_result);
--  • a short note per component in «Що входить до набору» (kit_components.note);
--  • «Доповніть свій догляд»: hand-picked products shown instead of «Схожі товари»;
--  • kit price rounded to whole 10 грн (2 150 − 15 % = 1 827,50 → 1 830 грн), as on her price list.

alter table public.items add column expected_result text check (length(expected_result) <= 4000);
alter table public.kit_components add column note text check (length(note) <= 1500);

create table public.item_recommendations (
  item_id uuid not null references public.items (id) on delete cascade,
  rec_id uuid not null references public.items (id) on delete cascade,
  sort int not null default 0,
  primary key (item_id, rec_id),
  check (item_id <> rec_id)
);
alter table public.item_recommendations enable row level security;
grant select, insert, update, delete on public.item_recommendations to authenticated;
create policy item_recommendations_admin on public.item_recommendations for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- Kit discount = component sum minus the kit price, where the kit price is
-- sum × (1 − bp) rounded half up to whole 10 грн (1000 kop). One rule for the
-- storefront, the admin and orders (item_state and the order engine use it).
create or replace function private.discount_kop(p_base int, p_bp int) returns int
language sql immutable set search_path = '' as $$
  select case when p_base is null then null
    else p_base - (((p_base::bigint * (10000 - p_bp) + 5000000) / 10000000) * 1000)::int end;
$$;

create or replace function public.catalog_item(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v private.item_state;
  v_item public.items;
  v_cat public.categories;
begin
  select * into v from private.item_state where slug = p_slug and status = 'published' and price_kop is not null;
  if not found then
    return null;
  end if;
  select * into v_item from public.items where id = v.id;
  select * into v_cat from public.categories where id = v.category_id;
  return private.card(v, v_cat.slug) || jsonb_build_object(
    'category_name', v_cat.name,
    'description', v_item.description,
    'inci', v_item.inci,
    'usage', v_item.usage,
    'warnings', v_item.warnings,
    'expected_result', v_item.expected_result,
    'published_at', v.published_at,
    'images', (select coalesce(jsonb_agg(jsonb_build_object('path', im.path, 'alt', im.alt) order by im.sort, im.created_at, im.id), '[]')
               from public.item_images im where im.item_id = v.id),
    'facets', (select coalesce(jsonb_agg(jsonb_build_object('group', x.group_key, 'slug', x.slug, 'label', x.label) order by x.group_key, x.sort), '[]')
               from public.item_facets f join public.facets x on x.id = f.facet_id where f.item_id = v.id),
    'components', case when v.kind = 'kit' then (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', p.id, 'slug', p.slug, 'name', p.name, 'volume', p.volume, 'qty', kc.qty, 'note', kc.note,
          'price_kop', p.price_kop, 'available', p.available,
          'is_public', p.status = 'published', 'image', private.first_image(p.id)) order by kc.sort, p.name), '[]')
        from public.kit_components kc join private.item_state p on p.id = kc.product_id where kc.kit_id = v.id)
      else null end,
    'in_kits', (select coalesce(jsonb_agg(jsonb_build_object('slug', k.slug, 'name', k.name, 'price_kop', k.price_kop)), '[]')
               from public.kit_components kc join private.item_state k on k.id = kc.kit_id
               where kc.product_id = v.id and k.status = 'published' and k.price_kop is not null),
    'recommendations', (select coalesce(jsonb_agg(private.card(r, c.slug) order by ir.sort, r.name), '[]')
               from public.item_recommendations ir
               join private.item_state r on r.id = ir.rec_id
               join public.categories c on c.id = r.category_id
               where ir.item_id = v.id and r.status = 'published' and r.price_kop is not null),
    'related', (select coalesce(jsonb_agg(private.card(r, v_cat.slug) order by r.sort, r.name), '[]') from (
        select * from private.item_state r
        where r.category_id = v.category_id and r.id <> v.id and r.status = 'published' and r.price_kop is not null
        order by r.sort, r.name limit 4) r)
  );
end $$;

-- Admin: kit composition now keeps a note per component.
create or replace function public.admin_set_kit_components(p_kit uuid, p_components jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_admin();
  if jsonb_array_length(coalesce(p_components, '[]')) > 20 then raise exception 'TOO_MANY_COMPONENTS'; end if;
  delete from public.kit_components where kit_id = p_kit;
  insert into public.kit_components (kit_id, product_id, qty, sort, note)
  select p_kit, (e ->> 'id')::uuid, (e ->> 'qty')::int, (row_number() over ())::int, nullif(btrim(e ->> 'note'), '')
  from jsonb_array_elements(coalesce(p_components, '[]')) e;
end $$;

-- Admin: «Доповніть свій догляд» list, in the given order.
create function public.admin_set_recommendations(p_item uuid, p_items uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_admin();
  if coalesce(array_length(p_items, 1), 0) > 12 then raise exception 'TOO_MANY_RECOMMENDATIONS'; end if;
  delete from public.item_recommendations where item_id = p_item;
  insert into public.item_recommendations (item_id, rec_id, sort)
  select p_item, x.id, min(x.ord)::int from unnest(coalesce(p_items, '{}')) with ordinality as x(id, ord)
  where x.id <> p_item group by x.id;
end $$;
grant execute on function public.admin_set_recommendations(uuid, uuid[]) to authenticated;
revoke execute on function public.admin_set_recommendations(uuid, uuid[]) from public, anon;
