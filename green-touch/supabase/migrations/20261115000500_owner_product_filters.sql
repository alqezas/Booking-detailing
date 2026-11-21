-- Skin type and skin need filters for the 22 products, as sent by the owner (15.11.2026).
-- Replaces only the skin_type / skin_need tags of the seeded products; other groups,
-- kits and items created in the admin are untouched. Items deleted by the owner are skipped.
-- Not in the catalog, so not assigned: «Крем із церамідами» (listed for dry skin).
-- «Сироватка "Глибоке зволоження"» is taken to be the hyaluronic acid serum (gt-06).
delete from public.item_facets x
using public.items i, public.facets f
where x.item_id = i.id and x.facet_id = f.id
  and i.seed_key ~ '^gt-(0[1-9]|1[0-9]|2[0-2])$'
  and f.group_key in ('skin_type', 'skin_need');

with wanted(group_key, facet_slug, seed_keys) as (values
  ('skin_type', 'sukha',          array['gt-01','gt-04','gt-11','gt-12','gt-19','gt-07','gt-08','gt-21','gt-16','gt-18','gt-20']),
  ('skin_type', 'normalna',       array['gt-01','gt-02','gt-03','gt-13','gt-11','gt-06','gt-16','gt-21','gt-20']),
  ('skin_type', 'zrila',          array['gt-01','gt-03','gt-17','gt-10','gt-12','gt-08','gt-07','gt-18','gt-21','gt-20','gt-09']),
  ('skin_type', 'problemna',      array['gt-01','gt-02','gt-05','gt-14']),
  ('skin_type', 'zhyrna',         array['gt-01','gt-02','gt-03','gt-15','gt-09','gt-16']),
  ('skin_type', 'chutlyva',       array['gt-01','gt-04','gt-19','gt-11','gt-21','gt-12']),
  ('skin_need', 'zmorshky',       array['gt-01','gt-03','gt-10','gt-16','gt-17','gt-12','gt-07','gt-08','gt-06','gt-20','gt-09']),
  ('skin_need', 'sukhist',        array['gt-01','gt-04','gt-11','gt-12','gt-07','gt-16','gt-20','gt-08','gt-21']),
  ('skin_need', 'pruzhnist',      array['gt-01','gt-04','gt-10','gt-16','gt-17','gt-08','gt-07','gt-06','gt-11','gt-09','gt-20','gt-21']),
  ('skin_need', 'pihmentatsiia',  array['gt-01','gt-07','gt-08','gt-16','gt-02','gt-18']),
  ('skin_need', 'vysypannia',     array['gt-14','gt-05','gt-07','gt-08','gt-02','gt-01','gt-15']),
  ('skin_need', 'postakne',       array['gt-01','gt-07','gt-08','gt-14','gt-05','gt-02','gt-16','gt-18']),
  ('skin_need', 'pochervoninnia', array['gt-01','gt-19','gt-18','gt-12','gt-04']),
  ('skin_need', 'zhyrnyi-blysk',  array['gt-15','gt-14','gt-05','gt-02','gt-01','gt-13']),
  ('skin_need', 'tmianist',       array['gt-01','gt-03','gt-07','gt-08','gt-06','gt-11','gt-02','gt-21','gt-16']),
  ('skin_need', 'zona-ochei',     array['gt-20','gt-09']),
  ('skin_need', 'zakhyst-sontse', array['gt-18'])
),
pairs as (
  select i.id as item_id, f.id as facet_id
  from wanted w
  cross join lateral unnest(w.seed_keys) as k(seed_key)
  join public.items i on i.seed_key = k.seed_key
  join public.facets f on f.group_key = w.group_key and f.slug = w.facet_slug
)
insert into public.item_facets (item_id, facet_id)
select item_id, facet_id from pairs
on conflict do nothing;
