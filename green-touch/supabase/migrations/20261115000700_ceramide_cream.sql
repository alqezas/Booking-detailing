-- New product from the owner (15.11.2026): «Крем із церамідами», 50 мл, 1 100 грн,
-- with the filters from her lists. Same row and filters are in seed.sql for fresh setups.
insert into public.items (seed_key, kind, category_id, slug, name, volume, price_kop, status, sort)
select 'gt-23', 'product', c.id, 'krem-iz-tseramidamy', 'Крем із церамідами', '50 мл', 110000, 'published', 120
from public.categories c where c.slug = 'kremy'
on conflict (seed_key) do nothing;

insert into public.item_facets (item_id, facet_id)
select i.id, f.id
from public.items i
join public.facets f on (f.group_key, f.slug) in (
  ('skin_type', 'sukha'), ('skin_type', 'zrila'), ('skin_type', 'chutlyva'),
  ('skin_need', 'zmorshky'), ('skin_need', 'sukhist'), ('skin_need', 'pruzhnist'), ('skin_need', 'pochervoninnia'))
where i.seed_key = 'gt-23'
on conflict do nothing;
