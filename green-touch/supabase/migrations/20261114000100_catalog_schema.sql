-- Green Touch: one shop, no tenants. Catalog, dictionaries, kits, content.
-- Money: integer kopecks. Time: timestamptz (stored in UTC, shown in Europe/Kyiv).

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
-- Functions in `private` are not executable by default (only what is granted below).
alter default privileges in schema private revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public;

-- ── Roles ────────────────────────────────────────────────────────────────────
create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;

-- ── Categories ───────────────────────────────────────────────────────────────
-- «Усі товари» is a view over every published item, not a row here.
create table public.categories (
  id smallint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9-]{1,40}$'),
  name text not null check (length(name) between 1 and 60),
  item_kind text not null check (item_kind in ('product', 'kit', 'sample')),
  sort int not null default 0,
  unique (id, item_kind)
);

-- ── Filter dictionaries (one table for every group, shared by products and kits) ──
create table public.facets (
  id smallint generated always as identity primary key,
  group_key text not null check (group_key in ('skin_type', 'skin_need', 'kit_purpose', 'age_product', 'age_kit', 'season')),
  slug text not null check (slug ~ '^[a-z0-9-]{1,40}$'),
  label text not null check (length(label) between 1 and 80),
  sort int not null default 0,
  unique (group_key, slug)
);

-- ── Items: products, samples and kits share one table so the catalog can
-- filter, sort and paginate them together without duplicate rows. ─────────────
create table public.items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('product', 'kit', 'sample')),
  category_id smallint not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  name text not null check (length(name) between 1 and 160),
  volume text check (length(volume) <= 40),
  -- products and samples: own price; kits: null (computed from components)
  price_kop int check (price_kop between 0 and 100000000),
  -- kits: discount in basis points (1500 = 15 %), applied once to the sum of components
  kit_discount_bp int not null default 1500 check (kit_discount_bp between 0 and 9000),
  short_purpose text check (length(short_purpose) <= 300),
  description text check (length(description) <= 8000),
  inci text check (length(inci) <= 6000),
  usage text check (length(usage) <= 4000),
  warnings text check (length(warnings) <= 4000),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  -- Everything is made to order: no stock counts. The owner can only pause ordering of an item.
  orderable boolean not null default true,
  sort int not null default 0,
  seed_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (category_id, kind) references public.categories (id, item_kind),
  check ((kind = 'kit') = (price_kop is null))
);
create index items_status_idx on public.items (status, kind);
create index items_category_idx on public.items (category_id) where status = 'published';

create table public.item_facets (
  item_id uuid not null references public.items (id) on delete cascade,
  facet_id smallint not null references public.facets (id) on delete cascade,
  primary key (item_id, facet_id)
);
create index item_facets_facet_idx on public.item_facets (facet_id, item_id);

create table public.item_images (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  path text not null check (path ~ '^items/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$'),
  alt text check (length(alt) <= 200),
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index item_images_item_idx on public.item_images (item_id, sort);

create table public.kit_components (
  kit_id uuid not null references public.items (id) on delete cascade,
  product_id uuid not null references public.items (id) on delete restrict,
  qty int not null default 1 check (qty between 1 and 20),
  sort int not null default 0,
  primary key (kit_id, product_id),
  check (kit_id <> product_id)
);

create table public.home_picks (
  item_id uuid primary key references public.items (id) on delete cascade,
  sort int not null default 0
);

-- ── Content and settings ─────────────────────────────────────────────────────
create table public.shop_settings (
  key text primary key check (key ~ '^[a-z_]{1,40}$'),
  value jsonb not null,
  is_public boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.pages (
  slug text primary key check (slug ~ '^[a-z0-9-]{1,60}$'),
  title text not null check (length(title) between 1 and 160),
  body text not null default '' check (length(body) <= 40000),
  -- the owner has to fill in / check the text before launch
  needs_review boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ── Integrity triggers ───────────────────────────────────────────────────────
create function private.items_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  -- «Новинки» sort by the first publication, not by the last edit
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end $$;
create trigger items_touch before insert or update on public.items
  for each row execute function private.items_touch();

create function private.item_facets_check() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_kind text;
  v_group text;
begin
  select kind into v_kind from public.items where id = new.item_id;
  select group_key into v_group from public.facets where id = new.facet_id;
  if v_group in ('kit_purpose', 'age_kit') and v_kind <> 'kit' then
    raise exception 'FACET_KIND_MISMATCH' using detail = v_group;
  end if;
  if v_group = 'age_product' and v_kind = 'kit' then
    raise exception 'FACET_KIND_MISMATCH' using detail = v_group;
  end if;
  return new;
end $$;
create trigger item_facets_check before insert or update on public.item_facets
  for each row execute function private.item_facets_check();

create function private.kit_components_check() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select kind from public.items where id = new.kit_id) <> 'kit' then
    raise exception 'NOT_A_KIT';
  end if;
  if (select kind from public.items where id = new.product_id) = 'kit' then
    raise exception 'KIT_IN_KIT';
  end if;
  return new;
end $$;
create trigger kit_components_check before insert or update on public.kit_components
  for each row execute function private.kit_components_check();

-- ── Reference data (idempotent) ──────────────────────────────────────────────
insert into public.categories (slug, name, item_kind, sort) values
  ('kremy', 'Креми', 'product', 10),
  ('syrovatky', 'Сироватки', 'product', 20),
  ('toniky', 'Тоніки', 'product', 30),
  ('ochyshchennia', 'Очищення', 'product', 40),
  ('masky', 'Маски', 'product', 50),
  ('nabory', 'Набори догляду', 'kit', 60),
  ('probnyky', 'Пробники', 'sample', 70)
on conflict (slug) do nothing;

insert into public.facets (group_key, slug, label, sort) values
  ('skin_type', 'sukha', 'Суха', 10),
  ('skin_type', 'normalna', 'Нормальна', 20),
  ('skin_type', 'kombinovana', 'Комбінована', 30),
  ('skin_type', 'zhyrna', 'Жирна', 40),
  ('skin_type', 'problemna', 'Проблемна', 50),
  ('skin_type', 'chutlyva', 'Чутлива', 60),
  ('skin_type', 'zrila', 'Зріла', 70),
  ('skin_need', 'zmorshky', 'Зморшки та вікові зміни', 10),
  ('skin_need', 'sukhist', 'Сухість і зневоднення', 20),
  ('skin_need', 'pruzhnist', 'Втрата пружності', 30),
  ('skin_need', 'pihmentatsiia', 'Пігментація та нерівний тон', 40),
  ('skin_need', 'vysypannia', 'Висипання та акне', 50),
  ('skin_need', 'postakne', 'Постакне', 60),
  ('skin_need', 'pochervoninnia', 'Почервоніння, купероз і розацеа', 70),
  ('skin_need', 'zhyrnyi-blysk', 'Жирний блиск і розширені пори', 80),
  ('skin_need', 'tmianist', 'Тьмяність шкіри', 90),
  ('skin_need', 'zona-ochei', 'Догляд за зоною навколо очей', 100),
  ('skin_need', 'zakhyst-sontse', 'Захист від сонця', 110),
  ('kit_purpose', 'zvolozhennia', 'Зволоження та живлення', 10),
  ('kit_purpose', 'antyvikovyi', 'Антивіковий догляд', 20),
  ('kit_purpose', 'liftynh', 'Ліфтинг та пружність', 30),
  ('kit_purpose', 'proty-zmorshok', 'Проти зморшок', 40),
  ('kit_purpose', 'proty-vysypan', 'Проти висипань та постакне', 50),
  ('kit_purpose', 'proty-pihmentatsii', 'Проти пігментації', 60),
  ('kit_purpose', 'proty-pochervoninnia', 'Проти почервоніння', 70),
  ('age_product', 'do-25', 'До 25 років', 10),
  ('age_product', '25-35', '25–35 років', 20),
  ('age_product', '35-45', '35–45 років', 30),
  ('age_product', '45-55', '45–55 років', 40),
  ('age_product', '55-plus', '55+ років', 50),
  ('age_kit', '35-plus', '35+', 10),
  ('age_kit', '40-plus', '40+', 20),
  ('age_kit', '45-plus', '45+', 30),
  ('age_kit', '50-plus', '50+', 40),
  ('season', 'vesna', 'Весна', 10),
  ('season', 'lito', 'Літо', 20),
  ('season', 'osin', 'Осінь', 30),
  ('season', 'zyma', 'Зима', 40),
  ('season', 'tsilyi-rik', 'Цілий рік', 50)
on conflict (group_key, slug) do nothing;
