-- Pricing, availability and the public catalog API (read-only, published items only).

-- Kit discount: basis points of the component sum, rounded half up to a whole kopeck.
-- price = base − discount. One rule for the storefront, the admin and orders.
create function private.discount_kop(p_base int, p_bp int) returns int
language sql immutable set search_path = '' as $$
  select case when p_base is null then null else ((p_base::bigint * p_bp + 5000) / 10000)::int end;
$$;
grant execute on function private.discount_kop(int, int) to anon, authenticated, service_role;

create function private.like_escape(p text) returns text
language sql immutable set search_path = '' as $$
  select replace(replace(replace(p, '\', '\\'), '%', '\%'), '_', '\_');
$$;

-- Current state of every item: price after the kit discount and whether it can be ordered.
-- Everything is made to order, so «available» means only: the owner accepts orders for it
-- (and, for a kit, for every component).
create view private.item_state with (security_barrier) as
with kits as (
  select c.kit_id,
    sum(c.qty * p.price_kop)::int as base_kop,
    bool_and(p.status <> 'archived' and p.orderable) as all_ok,
    count(*)::int as n
  from public.kit_components c
  join public.items p on p.id = c.product_id
  group by c.kit_id
)
select b.id, b.kind, b.category_id, b.slug, b.name, b.volume, b.status, b.published_at, b.sort,
  b.short_purpose, b.orderable, b.kit_discount_bp,
  case when b.kind = 'kit' then k.base_kop else b.price_kop end as base_kop,
  case when b.kind = 'kit' then b.kit_discount_bp else 0 end as discount_bp,
  case when b.kind = 'kit' then private.discount_kop(k.base_kop, b.kit_discount_bp) else 0 end as discount_kop,
  case when b.kind = 'kit' then k.base_kop - private.discount_kop(k.base_kop, b.kit_discount_bp) else b.price_kop end as price_kop,
  case
    when b.kind = 'kit' then b.orderable and coalesce(k.n, 0) > 0 and coalesce(k.all_ok, false)
    else b.orderable
  end as available
from public.items b
left join kits k on k.kit_id = b.id;

-- Paid sales in the last 30 days (by qty). «Популярні» = this, then a stable order.
create view private.item_popularity as
select l.item_id, sum(l.qty)::int as sold
from public.order_lines l
join public.orders o on o.id = l.order_id
where o.payment_status = 'paid' and o.paid_at >= now() - interval '30 days' and l.item_id is not null
group by l.item_id;

create function private.first_image(p_item uuid) returns text
language sql stable set search_path = '' as $$
  select path from public.item_images where item_id = p_item order by sort, created_at, id limit 1;
$$;

create function private.card(s private.item_state, p_category_slug text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', s.id, 'kind', s.kind, 'slug', s.slug, 'name', s.name, 'volume', s.volume,
    'category', p_category_slug, 'short_purpose', s.short_purpose,
    'price_kop', s.price_kop, 'base_kop', s.base_kop, 'discount_bp', s.discount_bp,
    'available', s.available, 'image', private.first_image(s.id));
$$;

-- ── Catalog search ───────────────────────────────────────────────────────────
-- Between groups: AND. Inside a group: OR. A category matches only items of that
-- category (a kit is not a «Крем» because it contains one). EXISTS per group
-- keeps many-to-many joins from duplicating rows.
-- Price bounds are inclusive kopecks on the purchase price (kits after discount).
create function public.catalog_search(
  p_category text default null,
  p_skin text[] default null,
  p_need text[] default null,
  p_purpose text[] default null,
  p_age text[] default null,
  p_season text[] default null,
  p_min_kop int default null,
  p_max_kop int default null,
  p_q text default null,
  p_sort text default 'popular',
  p_page int default 1,
  p_page_size int default 24
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_q text := nullif(left(btrim(coalesce(p_q, '')), 80), '');
  v_size int := least(greatest(coalesce(p_page_size, 24), 1), 48);
  v_page int := least(greatest(coalesce(p_page, 1), 1), 500);
  v_total int;
  v_items jsonb;
begin
  if p_sort is not null and p_sort not in ('popular', 'new', 'price_asc', 'price_desc') then
    raise exception 'BAD_SORT';
  end if;
  if coalesce(cardinality(p_skin), 0) + coalesce(cardinality(p_need), 0) + coalesce(cardinality(p_purpose), 0)
     + coalesce(cardinality(p_age), 0) + coalesce(cardinality(p_season), 0) > 60 then
    raise exception 'TOO_MANY_FILTERS';
  end if;

  with filtered as (
    select s, c.slug as category_slug, coalesce(pop.sold, 0) as sold
    from private.item_state s
    join public.categories c on c.id = s.category_id
    left join private.item_popularity pop on pop.item_id = s.id
    where s.status = 'published'
      and s.price_kop is not null
      and (p_category is null or c.slug = p_category)
      and (v_q is null or s.name ilike '%' || private.like_escape(v_q) || '%')
      and (p_min_kop is null or s.price_kop >= p_min_kop)
      and (p_max_kop is null or s.price_kop <= p_max_kop)
      and (coalesce(cardinality(p_skin), 0) = 0 or exists (
        select 1 from public.item_facets f join public.facets x on x.id = f.facet_id
        where f.item_id = s.id and x.group_key = 'skin_type' and x.slug = any (p_skin)))
      and (coalesce(cardinality(p_need), 0) = 0 or exists (
        select 1 from public.item_facets f join public.facets x on x.id = f.facet_id
        where f.item_id = s.id and x.group_key = 'skin_need' and x.slug = any (p_need)))
      and (coalesce(cardinality(p_purpose), 0) = 0 or exists (
        select 1 from public.item_facets f join public.facets x on x.id = f.facet_id
        where f.item_id = s.id and x.group_key = 'kit_purpose' and x.slug = any (p_purpose)))
      and (coalesce(cardinality(p_age), 0) = 0 or exists (
        select 1 from public.item_facets f join public.facets x on x.id = f.facet_id
        where f.item_id = s.id and x.group_key in ('age_product', 'age_kit') and x.slug = any (p_age)))
      and (coalesce(cardinality(p_season), 0) = 0 or exists (
        select 1 from public.item_facets f join public.facets x on x.id = f.facet_id
        where f.item_id = s.id and x.group_key = 'season' and x.slug = any (p_season)))
  ), counted as (
    select count(*)::int as n from filtered
  ), page as (
    select f.*, row_number() over (order by
      case when coalesce(p_sort, 'popular') = 'popular' then f.sold end desc nulls last,
      case when p_sort = 'new' then (f.s).published_at end desc nulls last,
      case when p_sort = 'price_asc' then (f.s).price_kop end asc nulls last,
      case when p_sort = 'price_desc' then (f.s).price_kop end desc nulls last,
      (f.s).sort asc, (f.s).name asc, (f.s).id asc) as rn
    from filtered f
  )
  select (select n from counted),
    coalesce(jsonb_agg(private.card(p.s, p.category_slug) order by p.rn), '[]'::jsonb)
  into v_total, v_items
  from page p
  where p.rn > (v_page - 1) * v_size and p.rn <= v_page * v_size;

  return jsonb_build_object('total', coalesce(v_total, 0), 'page', v_page, 'page_size', v_size, 'items', v_items);
end $$;

-- ── Meta: categories, dictionaries, price bounds, public settings, home picks ──
create function public.catalog_meta() returns jsonb
language sql stable security definer set search_path = '' as $$
  with pub as (
    select s.* from private.item_state s where s.status = 'published' and s.price_kop is not null
  )
  select jsonb_build_object(
    'categories', (select coalesce(jsonb_agg(jsonb_build_object(
        'slug', c.slug, 'name', c.name, 'kind', c.item_kind,
        'count', (select count(*) from pub where pub.category_id = c.id)) order by c.sort), '[]') from public.categories c),
    'facets', (select coalesce(jsonb_agg(jsonb_build_object(
        'group', x.group_key, 'slug', x.slug, 'label', x.label,
        'count', (select count(*) from pub join public.item_facets f on f.item_id = pub.id where f.facet_id = x.id))
        order by x.group_key, x.sort), '[]') from public.facets x),
    'price', (select jsonb_build_object('min_kop', min(price_kop), 'max_kop', max(price_kop)) from pub),
    'total', (select count(*) from pub),
    'settings', (select coalesce(jsonb_object_agg(st.key, st.value), '{}') from public.shop_settings st where st.is_public),
    'home_picks', (select coalesce(jsonb_agg(private.card(s, c.slug) order by h.sort, s.name), '[]')
        from public.home_picks h join private.item_state s on s.id = h.item_id
        join public.categories c on c.id = s.category_id
        where s.status = 'published' and s.price_kop is not null),
    'kits', (select coalesce(jsonb_agg(private.card(s, 'nabory') order by s.sort, s.name), '[]')
        from (select * from pub where pub.kind = 'kit' order by pub.sort, pub.name limit 8) s),
    'pages', (select coalesce(jsonb_agg(jsonb_build_object('slug', pg.slug, 'title', pg.title) order by pg.slug), '[]') from public.pages pg)
  );
$$;

-- ── One item with gallery, details, kit composition and related items ─────────
create function public.catalog_item(p_slug text) returns jsonb
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
    'published_at', v.published_at,
    'images', (select coalesce(jsonb_agg(jsonb_build_object('path', im.path, 'alt', im.alt) order by im.sort, im.created_at, im.id), '[]')
               from public.item_images im where im.item_id = v.id),
    'facets', (select coalesce(jsonb_agg(jsonb_build_object('group', x.group_key, 'slug', x.slug, 'label', x.label) order by x.group_key, x.sort), '[]')
               from public.item_facets f join public.facets x on x.id = f.facet_id where f.item_id = v.id),
    'components', case when v.kind = 'kit' then (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', p.id, 'slug', p.slug, 'name', p.name, 'volume', p.volume, 'qty', kc.qty,
          'price_kop', p.price_kop, 'available', p.available,
          'is_public', p.status = 'published', 'image', private.first_image(p.id)) order by kc.sort, p.name), '[]')
        from public.kit_components kc join private.item_state p on p.id = kc.product_id where kc.kit_id = v.id)
      else null end,
    'in_kits', (select coalesce(jsonb_agg(jsonb_build_object('slug', k.slug, 'name', k.name, 'price_kop', k.price_kop)), '[]')
               from public.kit_components kc join private.item_state k on k.id = kc.kit_id
               where kc.product_id = v.id and k.status = 'published' and k.price_kop is not null),
    'related', (select coalesce(jsonb_agg(private.card(r, v_cat.slug) order by r.sort, r.name), '[]') from (
        select * from private.item_state r
        where r.category_id = v.category_id and r.id <> v.id and r.status = 'published' and r.price_kop is not null
        order by r.sort, r.name limit 4) r)
  );
end $$;

create function public.public_page(p_slug text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('slug', slug, 'title', title, 'body', body, 'needs_review', needs_review, 'updated_at', updated_at)
  from public.pages where slug = p_slug;
$$;

-- ── Cart pricing (shared by the cart quote and order creation) ───────────────
-- Input: [{"id": uuid, "qty": int}] — ids and quantities only, never prices.
create function private.parse_lines(p_lines jsonb) returns table (item_id uuid, qty int)
language plpgsql immutable set search_path = '' as $$
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'EMPTY_CART';
  end if;
  if jsonb_array_length(p_lines) > 30 then
    raise exception 'CART_TOO_LARGE';
  end if;
  return query
    select (e ->> 'id')::uuid, sum((e ->> 'qty')::int)::int
    from jsonb_array_elements(p_lines) e
    group by (e ->> 'id')::uuid;
end $$;

create function private.price_lines(p_lines jsonb) returns table (
  line_no int, item_id uuid, kind text, slug text, name text, volume text, qty int,
  unit_base_kop int, discount_bp int, unit_discount_kop int, unit_price_kop int,
  available boolean, purchasable boolean
)
language plpgsql stable set search_path = '' as $$
begin
  if exists (select 1 from private.parse_lines(p_lines) l where l.qty < 1 or l.qty > 50) then
    raise exception 'BAD_QTY';
  end if;
  return query
    select (row_number() over (order by s.kind = 'kit' desc, s.name, l.item_id))::int,
      l.item_id, s.kind, s.slug, s.name, s.volume, l.qty,
      s.base_kop, s.discount_bp, s.discount_kop, s.price_kop,
      coalesce(s.available, false),
      s.id is not null and s.status = 'published' and s.price_kop is not null
    from private.parse_lines(p_lines) l
    left join private.item_state s on s.id = l.item_id;
end $$;

create function public.quote_cart(p_lines jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_lines jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.item_id, 'kind', p.kind, 'slug', p.slug, 'name', p.name, 'volume', p.volume, 'qty', p.qty,
      'unit_base_kop', p.unit_base_kop, 'discount_bp', p.discount_bp, 'unit_discount_kop', p.unit_discount_kop,
      'unit_price_kop', p.unit_price_kop, 'line_total_kop', p.unit_price_kop * p.qty,
      'available', p.available and p.purchasable, 'purchasable', p.purchasable,
      'image', case when p.purchasable then private.first_image(p.item_id) end,
      'components', case when p.kind = 'kit' then (
        select coalesce(jsonb_agg(jsonb_build_object('name', i.name, 'volume', i.volume, 'qty', c.qty) order by c.sort, i.name), '[]')
        from public.kit_components c join public.items i on i.id = c.product_id where c.kit_id = p.item_id) end) order by p.line_no), '[]')
  into v_lines from private.price_lines(p_lines) p;

  return jsonb_build_object(
    'lines', v_lines,
    'subtotal_kop', (select coalesce(sum((x ->> 'unit_base_kop')::int * (x ->> 'qty')::int), 0) from jsonb_array_elements(v_lines) x where (x ->> 'purchasable')::boolean),
    'discount_kop', (select coalesce(sum((x ->> 'unit_discount_kop')::int * (x ->> 'qty')::int), 0) from jsonb_array_elements(v_lines) x where (x ->> 'purchasable')::boolean),
    'total_kop', (select coalesce(sum((x ->> 'line_total_kop')::int), 0) from jsonb_array_elements(v_lines) x where (x ->> 'purchasable')::boolean),
    'ok', not exists (select 1 from jsonb_array_elements(v_lines) x where not (x ->> 'available')::boolean)
  );
end $$;

grant execute on function public.catalog_search(text, text[], text[], text[], text[], text[], int, int, text, text, int, int) to anon, authenticated, service_role;
grant execute on function public.catalog_meta() to anon, authenticated, service_role;
grant execute on function public.catalog_item(text) to anon, authenticated, service_role;
grant execute on function public.public_page(text) to anon, authenticated, service_role;
grant execute on function public.quote_cart(jsonb) to anon, authenticated, service_role;
