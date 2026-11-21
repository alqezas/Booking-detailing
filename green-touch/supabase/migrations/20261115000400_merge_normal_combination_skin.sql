-- Owner request: «Нормальна» and «Комбінована» are one skin type filter.
-- Items tagged «Комбінована» move to the merged facet (slug stays 'normalna').
insert into public.item_facets (item_id, facet_id)
select f.item_id, n.id
from public.item_facets f
join public.facets k on k.id = f.facet_id and k.group_key = 'skin_type' and k.slug = 'kombinovana'
join public.facets n on n.group_key = 'skin_type' and n.slug = 'normalna'
on conflict do nothing;

delete from public.facets where group_key = 'skin_type' and slug = 'kombinovana';
update public.facets set label = 'Нормальна та комбінована' where group_key = 'skin_type' and slug = 'normalna';
