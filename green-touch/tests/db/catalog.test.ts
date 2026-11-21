import {readFileSync} from 'node:fs';
import {afterAll, describe, expect, it} from 'vitest';
import {anon, closeDb, createItem, db, tag} from './helpers.ts';

afterAll(closeDb);

const SEED = [
  ['ochyshchennia', 'Пінка для вмивання обличчя для всіх типів шкіри', '150 мл', 400],
  ['ochyshchennia', 'Ензимна пудра для вмивання', '50 мл', 520],
  ['toniky', 'Тонік для нормальної та комбінованої шкіри з гіалуроновою кислотою', '100 мл', 400],
  ['toniky', 'Тонік для сухої шкіри з гіалуроновою кислотою', '100 мл', 450],
  ['toniky', 'Тонік з пребіотиком для проблемної шкіри з висипаннями', '100 мл', 400],
  ['syrovatky', 'Сироватка для обличчя «Глибоке зволоження»', '30 мл', 500],
  ['syrovatky', 'Сироватка з вітаміном С та ніацинамідом', '30 мл', 950],
  ['syrovatky', 'Сироватка для обличчя з ретинолом', '30 мл', 960],
  ['syrovatky', 'Пептидна сироватка для шкіри навколо очей', '10 мл', 400],
  ['kremy', 'Крем Anti-Age з пептидним комплексом', '50 мл', 1100],
  ['kremy', 'Крем з гіалуроновою кислотою', '50 мл', 1100],
  ['kremy', 'Живильний крем для обличчя', '50 мл', 950],
  ['kremy', 'Універсальний зволожувальний крем', '50 мл', 900],
  ['kremy', 'Крем для проблемної шкіри з висипаннями', '50 мл', 900],
  ['kremy', 'Зволожувальний матуючий крем для жирної шкіри', '50 мл', 900],
  ['kremy', 'Крем з бакучіолом', '50 мл', 1500],
  ['kremy', 'Крем із ботокс-ефектом', '50 мл', 1500],
  ['kremy', 'Сонцезахисний крем SPF 30', '50 мл', 1100],
  ['kremy', 'Крем для шкіри з куперозом та розацеа', '50 мл', 1200],
  ['kremy', 'Крем для шкіри навколо очей', '15 мл', 550],
  ['masky', 'Маска для обличчя «Живлення та відновлення» з білою глиною', '50 мл', 1200],
  ['kremy', 'Крем із церамідами', '50 мл', 1100], // gt-23, added 15.11.2026
] as const;

const seedRows = async () =>
  (
    await db().query(
      `select c.slug as category, i.name, i.volume, i.price_kop, i.kind, i.orderable, i.description, i.inci
       from items i join categories c on c.id = i.category_id where i.seed_key is not null order by i.seed_key`,
    )
  ).rows;

describe('starting catalog seed', () => {
  it('has exactly the 22 products (gt-22 removed, gt-23 added by the owner) with exact names, volumes and prices', async () => {
    const rows = await seedRows();
    expect(rows).toHaveLength(22);
    expect(rows.map(r => [r.category, r.name, r.volume, r.price_kop / 100])).toEqual(SEED.map(s => [...s]));
    // the owner's texts (owner_texts.sql, 21.11.2026) for every product; all made to order, no kits or samples seeded
    for (const r of rows) {
      expect(r).toMatchObject({kind: 'product', orderable: true});
      expect(r.description).toBeTruthy();
      expect(r.inci).toBeTruthy();
    }
    // filters: exactly the owner's lists of 15.11.2026 (migration 20261115000500), nothing else
    const facets = await db().query('select count(*)::int as n from item_facets f join items i on i.id = f.item_id where i.seed_key is not null');
    expect(facets.rows[0].n).toBe(130);
    const of = async (seed: string) =>
      (await db().query("select string_agg(f.slug, ',' order by f.group_key, f.slug) as s from item_facets x join facets f on f.id = x.facet_id join items i on i.id = x.item_id where i.seed_key = $1", [seed])).rows[0].s;
    expect(await of('gt-14')).toBe('postakne,vysypannia,zhyrnyi-blysk,problemna');
    expect(await of('gt-23')).toBe('pochervoninnia,pruzhnist,sukhist,zmorshky,chutlyva,sukha,zrila');
    expect(await of('gt-18')).toBe('pihmentatsiia,pochervoninnia,postakne,zakhyst-sontse,sukha,zrila');
    expect((await db().query("select count(*)::int as n from items where seed_key = 'gt-22'")).rows[0].n).toBe(0); // removed by the owner
  });

  it('is re-runnable without duplicates and keeps owner edits', async () => {
    const seed = readFileSync('supabase/seed.sql', 'utf8');
    await db().query("update items set price_kop = 41500, description = 'Опис від власниці' where seed_key = 'gt-01'");
    await db().query(seed);
    await db().query(seed);
    const rows = await seedRows();
    expect(rows).toHaveLength(22); // the removed mask does not come back
    const edited = await db().query("select price_kop, description from items where seed_key = 'gt-01'");
    expect(edited.rows[0]).toEqual({price_kop: 41500, description: 'Опис від власниці'});
    await db().query("update items set price_kop = 40000, description = null where seed_key = 'gt-01'");
    expect((await db().query('select count(*)::int as n from pages')).rows[0].n).toBe(5);
  });
});

describe('catalog filters', () => {
  // Fixtures share a unique tag in their names; queries are scoped by it (p_q).
  const t = tag();
  let ids: Record<string, string> = {};

  it('setup fixtures', async () => {
    const creamDry = await createItem({name: `${t} cream dry sensitive`, price_kop: 110000, facets: {skin_type: ['sukha', 'chutlyva'], skin_need: ['zmorshky', 'sukhist']}});
    const creamOily = await createItem({name: `${t} cream oily`, price_kop: 90000, facets: {skin_type: ['zhyrna'], skin_need: ['zmorshky']}});
    const serumDry = await createItem({name: `${t} serum dry`, category: 'syrovatky', price_kop: 50000, facets: {skin_type: ['sukha'], skin_need: ['sukhist']}});
    const tonic = await createItem({name: `${t} tonic none`, category: 'toniky', price_kop: 40000});
    const sample = await createItem({name: `${t} sample dry`, kind: 'sample', price_kop: 5000, facets: {skin_type: ['sukha']}});
    // kit = cream 1100 + serum 500 = 1600 → −15 % = 1360 грн
    const kit = await createItem({
      name: `${t} kit dry`,
      kind: 'kit',
      components: [{id: creamDry, qty: 1}, {id: serumDry, qty: 1}],
      facets: {skin_type: ['sukha', 'normalna'], skin_need: ['sukhist'], kit_purpose: ['zvolozhennia']},
    });
    const draft = await createItem({name: `${t} draft dry`, status: 'draft', facets: {skin_type: ['sukha']}});
    ids = {creamDry, creamOily, serumDry, tonic, sample, kit, draft};
  });

  const search = async (args: Record<string, unknown>) => {
    const {data, error} = await anon().rpc('catalog_search', {p_q: t, p_page_size: 48, ...args});
    if (error) throw error;
    return data as {total: number; items: {id: string; kind: string; price_kop: number; base_kop: number}[]};
  };
  const idsOf = (r: {items: {id: string}[]}) => r.items.map(i => i.id).sort();

  it('«Усі товари» lists published products, samples and kits — never drafts', async () => {
    const r = await search({});
    expect(r.total).toBe(6);
    expect(idsOf(r)).toEqual([ids.creamDry, ids.creamOily, ids.serumDry, ids.tonic, ids.sample, ids.kit].sort());
  });

  it('OR inside a group, AND between groups', async () => {
    const r = await search({p_category: 'kremy', p_skin: ['sukha', 'chutlyva'], p_need: ['zmorshky']});
    expect(idsOf(r)).toEqual([ids.creamDry]);
    const orOnly = await search({p_skin: ['sukha', 'zhyrna']});
    expect(idsOf(orOnly)).toEqual([ids.creamDry, ids.creamOily, ids.serumDry, ids.sample, ids.kit].sort());
    const andOnly = await search({p_skin: ['zhyrna'], p_need: ['sukhist']});
    expect(andOnly.total).toBe(0);
  });

  it('only «Суха» finds every matching item including kits and samples, without duplicates', async () => {
    const r = await search({p_skin: ['sukha']});
    expect(idsOf(r)).toEqual([ids.creamDry, ids.serumDry, ids.sample, ids.kit].sort());
    // the dry+sensitive cream matches two selected values but appears once
    const twoValues = await search({p_skin: ['sukha', 'chutlyva'], p_need: ['zmorshky', 'sukhist']});
    expect(new Set(twoValues.items.map(i => i.id)).size).toBe(twoValues.items.length);
    expect(twoValues.total).toBe(twoValues.items.length);
  });

  it('a kit is not a «Крем» because it contains a cream', async () => {
    const r = await search({p_category: 'kremy'});
    expect(idsOf(r)).toEqual([ids.creamDry, ids.creamOily].sort());
    const kits = await search({p_category: 'nabory', p_purpose: ['zvolozhennia']});
    expect(idsOf(kits)).toEqual([ids.kit]);
  });

  it('kits are filtered and sorted by the price after the discount', async () => {
    const kit = (await search({p_category: 'nabory'})).items[0]!;
    expect(kit.base_kop).toBe(160000);
    expect(kit.price_kop).toBe(136000);
    // 1360 грн falls into «1000–1500» (100 000…149 999 коп.), not «від 1500»
    expect(idsOf(await search({p_min_kop: 100000, p_max_kop: 149999}))).toEqual([ids.creamDry, ids.kit].sort());
    expect((await search({p_min_kop: 150000})).total).toBe(0);
    const asc = await search({p_sort: 'price_asc'});
    expect(asc.items.map(i => i.price_kop)).toEqual([...asc.items.map(i => i.price_kop)].sort((a, b) => a - b));
    const desc = await search({p_sort: 'price_desc'});
    expect(desc.items[0]!.id).toBe(ids.kit);
  });

  it('pagination is stable and counts the whole result', async () => {
    const p1 = await search({p_page_size: 4, p_page: 1, p_sort: 'new'});
    const p2 = await search({p_page_size: 4, p_page: 2, p_sort: 'new'});
    expect(p1.total).toBe(6);
    expect(p1.items).toHaveLength(4);
    expect(p2.items).toHaveLength(2);
    expect(new Set([...p1.items, ...p2.items].map(i => i.id)).size).toBe(6);
  });

  it('item page: kit composition, separate price and hidden drafts', async () => {
    const slug = (await db().query('select slug from items where id = $1', [ids.kit])).rows[0].slug;
    const {data} = await anon().rpc('catalog_item', {p_slug: slug});
    expect(data.components.map((c: {qty: number}) => c.qty)).toEqual([1, 1]);
    expect(data.base_kop).toBe(160000);
    expect(data.price_kop).toBe(136000);
    const draftSlug = (await db().query('select slug from items where id = $1', [ids.draft])).rows[0].slug;
    const {data: none} = await anon().rpc('catalog_item', {p_slug: draftSlug});
    expect(none).toBeNull();
  });

  it('cleanup', async () => {
    await db().query("delete from items where kind = 'kit' and name like $1", [`${t}%`]);
    await db().query('delete from items where name like $1', [`${t}%`]);
  });
});

describe('«Новинки» sorts by first publication, not last edit', () => {
  it('editing an old item does not make it new', async () => {
    const t = tag();
    const older = await createItem({name: `${t} older`});
    await db().query("update items set published_at = now() - interval '10 days' where id = $1", [older]);
    const newer = await createItem({name: `${t} newer`});
    await db().query("update items set name = name || ' edited' where id = $1", [older]);
    const {data} = await anon().rpc('catalog_search', {p_q: t, p_sort: 'new'});
    expect(data.items.map((i: {id: string}) => i.id)).toEqual([newer, older]);
    await db().query('delete from items where name like $1', [`${t}%`]);
  });
});
