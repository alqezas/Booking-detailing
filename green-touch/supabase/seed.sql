-- Green Touch starting catalog: exactly the 22 products provided by the owner.
-- Re-runnable: rows are keyed by seed_key and never overwritten (ON CONFLICT DO NOTHING),
-- so later edits by the owner survive a repeated seed.
-- Descriptions, INCI, usage, warnings, skin types and needs are intentionally empty:
-- the owner fills and confirms them. Everything is made to order: no stock is tracked.
-- Kits and samples are NOT seeded (their contents were not provided).

insert into public.items (seed_key, kind, category_id, slug, name, volume, price_kop, status, sort)
select v.seed_key, 'product', c.id, v.slug, v.name, v.volume, v.price_uah * 100, 'published', v.sort
from (values
  ('gt-01', 'ochyshchennia', 'pinka-dlia-vmyvannia', 'Пінка для вмивання', '150 мл', 400, 10),
  ('gt-02', 'ochyshchennia', 'enzymna-pudra', 'Ензимна пудра', '50 мл', 520, 20),
  ('gt-03', 'toniky', 'tonik-dlia-normalnoi-ta-kombinovanoi-shkiry', 'Тонік для нормальної та комбінованої шкіри', '100 мл', 400, 10),
  ('gt-04', 'toniky', 'tonik-dlia-sukhoi-shkiry', 'Тонік для сухої шкіри', '100 мл', 450, 20),
  ('gt-05', 'toniky', 'tonik-dlia-problemnoi-shkiry', 'Тонік для проблемної шкіри', '100 мл', 400, 30),
  ('gt-06', 'syrovatky', 'syrovatka-z-hialuronovoiu-kyslotoiu', 'Сироватка з гіалуроновою кислотою', '30 мл', 500, 10),
  ('gt-07', 'syrovatky', 'syrovatka-z-vitaminom-c-ta-niatsynamidom', 'Сироватка з вітаміном C та ніацинамідом', '30 мл', 950, 20),
  ('gt-08', 'syrovatky', 'syrovatka-z-retynolom', 'Сироватка з ретинолом', '30 мл', 960, 30),
  ('gt-09', 'syrovatky', 'peptydna-syrovatka-dlia-shkiry-navkolo-ochei', 'Пептидна сироватка для шкіри навколо очей', '30 мл', 400, 40),
  ('gt-10', 'kremy', 'antyvikovyi-krem-anti-age', 'Антивіковий крем Anti-Age', '50 мл', 1100, 10),
  ('gt-11', 'kremy', 'krem-z-hialuronovoiu-kyslotoiu', 'Крем з гіалуроновою кислотою', '50 мл', 1100, 20),
  ('gt-12', 'kremy', 'zhyvylnyi-krem', 'Живильний крем', '50 мл', 950, 30),
  ('gt-13', 'kremy', 'universalnyi-krem', 'Універсальний крем', '50 мл', 900, 40),
  ('gt-14', 'kremy', 'krem-dlia-problemnoi-shkiry', 'Крем для проблемної шкіри', '50 мл', 900, 50),
  ('gt-15', 'kremy', 'matuiuchyi-krem', 'Матуючий крем', '50 мл', 900, 60),
  ('gt-16', 'kremy', 'krem-z-bakuchiolom', 'Крем з бакучіолом', '50 мл', 1500, 70),
  ('gt-17', 'kremy', 'krem-z-botoks-efektom', 'Крем з ботокс-ефектом', '50 мл', 1500, 80),
  ('gt-18', 'kremy', 'sontsezakhysnyi-krem-spf-30', 'Сонцезахисний крем SPF 30', '50 мл', 1100, 90),
  ('gt-19', 'kremy', 'krem-proty-kuperozu-ta-rozatsea', 'Крем проти куперозу та розацеа', '50 мл', 1200, 100),
  ('gt-20', 'kremy', 'krem-dlia-shkiry-navkolo-ochei', 'Крем для шкіри навколо очей', '15 мл', 550, 110),
  ('gt-23', 'kremy', 'krem-iz-tseramidamy', 'Крем із церамідами', '50 мл', 1100, 120),
  ('gt-21', 'masky', 'maska-z-biloiu-hlynoiu', 'Маска з білою глиною', '50 мл', 1200, 10)
  -- gt-22 «Маска з феруловою кислотою та рожевою глиною» removed by the owner on 15.11.2026
) as v(seed_key, category, slug, name, volume, price_uah, sort)
join public.categories c on c.slug = v.category
-- items the owner deleted in the admin stay deleted
where not exists (select 1 from private.deleted_seed_keys d where d.seed_key = v.seed_key)
on conflict (seed_key) do nothing;

-- Skin type / skin need filters from the owner's lists (15.11.2026; same data as
-- migration 20261115000500). Only for products that have no such filters yet,
-- so a re-run never undoes the owner's edits in the admin.
with wanted(group_key, facet_slug, seed_keys) as (values
  ('skin_type', 'sukha',          array['gt-01','gt-04','gt-11','gt-12','gt-19','gt-07','gt-08','gt-21','gt-16','gt-18','gt-20','gt-23']),
  ('skin_type', 'normalna',       array['gt-01','gt-02','gt-03','gt-13','gt-11','gt-06','gt-16','gt-21','gt-20']),
  ('skin_type', 'zrila',          array['gt-01','gt-03','gt-17','gt-10','gt-12','gt-08','gt-07','gt-18','gt-21','gt-20','gt-09','gt-23']),
  ('skin_type', 'problemna',      array['gt-01','gt-02','gt-05','gt-14']),
  ('skin_type', 'zhyrna',         array['gt-01','gt-02','gt-03','gt-15','gt-09','gt-16']),
  ('skin_type', 'chutlyva',       array['gt-01','gt-04','gt-19','gt-11','gt-21','gt-12','gt-23']),
  ('skin_need', 'zmorshky',       array['gt-01','gt-03','gt-10','gt-16','gt-17','gt-12','gt-07','gt-08','gt-06','gt-20','gt-09','gt-23']),
  ('skin_need', 'sukhist',        array['gt-01','gt-04','gt-11','gt-12','gt-07','gt-16','gt-20','gt-08','gt-21','gt-23']),
  ('skin_need', 'pruzhnist',      array['gt-01','gt-04','gt-10','gt-16','gt-17','gt-08','gt-07','gt-06','gt-11','gt-09','gt-20','gt-21','gt-23']),
  ('skin_need', 'pihmentatsiia',  array['gt-01','gt-07','gt-08','gt-16','gt-02','gt-18']),
  ('skin_need', 'vysypannia',     array['gt-14','gt-05','gt-07','gt-08','gt-02','gt-01','gt-15']),
  ('skin_need', 'postakne',       array['gt-01','gt-07','gt-08','gt-14','gt-05','gt-02','gt-16','gt-18']),
  ('skin_need', 'pochervoninnia', array['gt-01','gt-19','gt-18','gt-12','gt-04','gt-23']),
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
select p.item_id, p.facet_id from pairs p
where not exists (
  select 1 from public.item_facets x join public.facets f on f.id = x.facet_id
  where x.item_id = p.item_id and f.group_key in ('skin_type', 'skin_need'))
on conflict do nothing;

-- Public shop settings. Empty values are shown to the owner as «потрібно заповнити».
insert into public.shop_settings (key, value, is_public) values
  ('brand', jsonb_build_object(
     'name', 'Green Touch',
     'tagline', 'Косметика власного виробництва, створена косметологом',
     'hero_text', 'Догляд за шкірою від косметолога: креми, сироватки, тоніки, засоби для очищення та маски.',
     'about_title', 'Про косметолога та бренд',
     'about_text', null,
     'cosmetologist_name', null,
     'cosmetologist_photo', null,
     'hero_photo', null), true),
  ('contacts', jsonb_build_object('phone', null, 'email', null, 'instagram', null, 'telegram', null, 'address', null, 'hours', null), true),
  ('filters', jsonb_build_object('season_visible', false, 'age_visible', false), true),
  ('delivery', jsonb_build_object(
     'summary', 'Доставка Новою поштою у відділення або поштомат. Вартість доставки сплачує отримувач за тарифами перевізника при отриманні.',
     'payment', 'Повна оплата онлайн через monobank або передоплата 150 грн (реквізити надішлемо у Viber), решта — накладеним платежем на Новій пошті.'), true),
  ('legal', jsonb_build_object('seller_name', null, 'seller_code', null, 'seller_address', null), true)
on conflict (key) do nothing;

insert into public.pages (slug, title, body, needs_review) values
  ('pro-brend', 'Про бренд', $md$
Green Touch — косметика власного виробництва, створена косметологом.

[ЗАПОВНІТЬ: історія бренду, як створюються засоби, хто косметолог. Без вигаданих фактів, сертифікатів і результатів досліджень.]
$md$, true),
  ('dostavka-i-oplata', 'Доставка й оплата', $md$
## Доставка
- Нова пошта — відділення.
- Нова пошта — поштомат.

Вартість доставки сплачує отримувач за тарифами Нової пошти при отриманні. Вона не входить у суму оплати товарів.

[ЗАПОВНІТЬ: строк виготовлення та відправлення після оплати.]

## Оплата
Два варіанти: повна оплата онлайн на сторінці monobank (plata by mono) або передоплата 150 грн — реквізити надішлемо у Viber, решту сплатите при отриманні на Новій пошті (накладений платіж). Усі засоби виготовляються під замовлення після оплати або передоплати.
$md$, true),
  ('kontakty', 'Контакти', $md$
[ЗАПОВНІТЬ: телефон, email, месенджери, години роботи.]
$md$, true),
  ('polityka-konfidentsiinosti', 'Політика конфіденційності', $md$
## Хто обробляє дані
[ЗАПОВНІТЬ: найменування продавця, код ЄДРПОУ/РНОКПП, адреса.]

## Які дані ми збираємо
Ім'я, прізвище, телефон, email (за бажанням), населений пункт і відділення/поштомат Нової пошти, коментар до замовлення.

## Навіщо
Для оформлення, оплати, доставки замовлення та зв'язку щодо нього.

## Кому передаємо
Новій пошті — для доставки; банку (plata by mono) — для проведення онлайн-оплати. Дані картки вводяться на сторінці банку і магазину не передаються.

## Строк зберігання
[ЗАПОВНІТЬ: строк зберігання даних замовлень.]

## Ваші права
[ЗАПОВНІТЬ: як звернутися щодо доступу, виправлення або видалення даних.]
$md$, true),
  ('umovy-pokupky', 'Умови покупки та повернення', $md$
## Оформлення замовлення
Замовлення оформлюється без реєстрації. Ціни вказані в гривнях. Ціна набору — сума окремих цін його складу мінус знижка, вказана на сторінці набору.

## Оплата
Повна оплата онлайн через monobank (plata by mono) або передоплата 150 грн за реквізитами, які ми надішлемо у Viber; решта — накладеним платежем на Новій пошті. Перехід зі сторінки оплати сам по собі не означає, що оплату зараховано: статус підтверджує сервер після повідомлення банку.

## Доставка
Новою поштою, вартість доставки сплачує отримувач.

## Повернення та обмін
[ЗАПОВНІТЬ: умови повернення косметичних засобів відповідно до законодавства України, порядок звернення, строки повернення коштів.]

## Продавець
[ЗАПОВНІТЬ: реквізити продавця.]
$md$, true)
on conflict (slug) do nothing;
