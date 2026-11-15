import {BottomSheet} from '@astryxdesign/core/BottomSheet';
import {Button} from '@astryxdesign/core/Button';
import {CheckboxList, CheckboxListItem} from '@astryxdesign/core/CheckboxList';
import {Divider} from '@astryxdesign/core/Divider';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Grid} from '@astryxdesign/core/Grid';
import {Icon} from '@astryxdesign/core/Icon';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {NumberInput} from '@astryxdesign/core/NumberInput';
import {Pagination} from '@astryxdesign/core/Pagination';
import {Selector} from '@astryxdesign/core/Selector';
import {Skeleton} from '@astryxdesign/core/Skeleton';
import {Heading, Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Token} from '@astryxdesign/core/Token';
import {Funnel, MagnifyingGlass} from '@phosphor-icons/react';
import {keepPreviousData, useQuery} from '@tanstack/react-query';
import {useEffect, useMemo, useState, type CSSProperties} from 'react';
import {useSearchParams} from 'react-router';
import {PRICE_BANDS, SORTS, catalogParams, parseCatalogParams, type CatalogQuery} from '../../supabase/functions/_shared/contracts.ts';
import {Page} from '../components/ShopLayout.tsx';
import {ErrorState} from '../components/Status.tsx';
import {ItemCard} from '../components/ui.tsx';
import {getMeta, searchCatalog} from '../lib/api.ts';
import {useMeta} from '../lib/browser.ts';
import {useMatchMedia} from '../lib/motion.ts';
import type {CatalogMeta, FacetGroup} from '../lib/types.ts';

const PAGE_SIZE = 24;
type ListKey = 'skin' | 'need' | 'purpose' | 'age' | 'season';
const GROUPS: {key: ListKey; group: FacetGroup[]; title: string}[] = [
  {key: 'skin', group: ['skin_type'], title: 'Тип шкіри'},
  {key: 'need', group: ['skin_need'], title: 'Потреби шкіри'},
  {key: 'purpose', group: ['kit_purpose'], title: 'Призначення набору'},
  {key: 'age', group: ['age_product', 'age_kit'], title: 'Вік'},
  {key: 'season', group: ['season'], title: 'Сезон'},
];

function useCatalogState(): [CatalogQuery, (patch: Partial<CatalogQuery>, keepPage?: boolean) => void] {
  const [sp, setSp] = useSearchParams();
  const q = useMemo(() => parseCatalogParams(sp), [sp]);
  // Any filter change resets pagination; history entries make back/forward work.
  const update = (patch: Partial<CatalogQuery>, keepPage = false) =>
    setSp(catalogParams({...q, ...patch, page: keepPage ? (patch.page ?? q.page) : 1}), {preventScrollReset: keepPage === false});
  return [q, update];
}

function visibleGroups(meta: CatalogMeta, q: CatalogQuery) {
  const f = meta.settings.filters ?? {};
  return GROUPS.filter(g => {
    if (g.key === 'purpose') return q.category === 'nabory' || q.purpose.length > 0;
    if (g.key === 'age') return f.age_visible === true || q.age.length > 0;
    if (g.key === 'season') return f.season_visible === true || q.season.length > 0;
    return true;
  });
}

function Filters({meta, q, update}: {meta: CatalogMeta; q: CatalogQuery; update: (p: Partial<CatalogQuery>) => void}) {
  const [min, setMin] = useState<number | null>(q.min);
  const [max, setMax] = useState<number | null>(q.max);
  useEffect(() => {
    setMin(q.min);
    setMax(q.max);
  }, [q.min, q.max]);
  const applyRange = () => update({band: null, min: min ?? null, max: max ?? null});
  return (
    <VStack gap={5}>
      {visibleGroups(meta, q).map(g => {
        const options = meta.facets.filter(f => g.group.includes(f.group));
        return (
          <CheckboxList key={g.key} label={g.title} value={q[g.key]} onChange={v => update({[g.key]: v} as Partial<CatalogQuery>)} density="compact">
            {options.map(o => (
              <CheckboxListItem key={`${o.group}:${o.slug}`} value={o.slug} label={o.label} endContent={o.count ? <Text type="supporting" color="secondary">{o.count}</Text> : undefined} />
            ))}
          </CheckboxList>
        );
      })}
      <VStack gap={3}>
        <Text type="label">Ціна, грн</Text>
        <HStack gap={2} wrap="wrap">
          {PRICE_BANDS.map(b => (
            <Button key={b.key} label={b.label} size="sm" variant={q.band === b.key ? 'primary' : 'secondary'} onClick={() => update({band: q.band === b.key ? null : b.key, min: null, max: null})} />
          ))}
        </HStack>
        <HStack gap={2} vAlign="end">
          <NumberInput label="Від" value={min} onChange={v => setMin(v ?? null)} min={0} isIntegerOnly onEnter={applyRange} onBlur={applyRange} width="50%" />
          <NumberInput label="До" value={max} onChange={v => setMax(v ?? null)} min={0} isIntegerOnly onEnter={applyRange} onBlur={applyRange} width="50%" />
        </HStack>
        {meta.price.min_kop != null && meta.price.max_kop != null && (
          <Text type="supporting" color="secondary">
            У каталозі: від {Math.floor(meta.price.min_kop / 100)} до {Math.ceil(meta.price.max_kop / 100)} грн (набори — з урахуванням знижки)
          </Text>
        )}
      </VStack>
    </VStack>
  );
}

function ActiveFilters({meta, q, update}: {meta: CatalogMeta; q: CatalogQuery; update: (p: Partial<CatalogQuery>) => void}) {
  const label = (slug: string, groups: FacetGroup[]) => meta.facets.find(f => groups.includes(f.group) && f.slug === slug)?.label ?? slug;
  const tokens: {key: string; label: string; remove: () => void}[] = [];
  for (const g of GROUPS) {
    for (const s of q[g.key]) tokens.push({key: `${g.key}:${s}`, label: label(s, g.group), remove: () => update({[g.key]: q[g.key].filter(x => x !== s)} as Partial<CatalogQuery>)});
  }
  const band = PRICE_BANDS.find(b => b.key === q.band);
  if (band) tokens.push({key: 'band', label: band.label, remove: () => update({band: null})});
  if (q.min != null) tokens.push({key: 'min', label: `від ${q.min} грн`, remove: () => update({min: null})});
  if (q.max != null) tokens.push({key: 'max', label: `до ${q.max} грн`, remove: () => update({max: null})});
  if (q.q) tokens.push({key: 'q', label: `«${q.q}»`, remove: () => update({q: ''})});
  if (!tokens.length) return null;
  return (
    <HStack gap={2} wrap="wrap" vAlign="center">
      {tokens.map(t => (
        <Token key={t.key} label={t.label} onRemove={t.remove} />
      ))}
      <Button label="Скинути фільтри" variant="ghost" size="sm" onClick={() => update({skin: [], need: [], purpose: [], age: [], season: [], band: null, min: null, max: null, q: ''})} />
    </HStack>
  );
}

const twoCols: CSSProperties = {display: 'grid', gridTemplateColumns: 'minmax(240px, 280px) 1fr', gap: 'var(--spacing-8)', alignItems: 'start'};

export default function CatalogPage() {
  const [q, update] = useCatalogState();
  const meta = useQuery({queryKey: ['meta'], queryFn: getMeta, staleTime: 5 * 60_000});
  const results = useQuery({queryKey: ['catalog', catalogParams(q).toString()], queryFn: () => searchCatalog(q), placeholderData: keepPreviousData});
  const wide = useMatchMedia('(min-width: 960px)');
  const [sheet, setSheet] = useState(false);
  const [search, setSearch] = useState(q.q);
  useEffect(() => setSearch(q.q), [q.q]);
  useEffect(() => {
    if (search === q.q) return;
    const id = setTimeout(() => update({q: search}), 350);
    return () => clearTimeout(id);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const category = meta.data?.categories.find(c => c.slug === q.category);
  const title = category?.name ?? 'Усі товари';
  useMeta({
    title: q.category ? title : 'Каталог',
    description: `${title} Green Touch: ціни в гривнях, доставка Новою поштою.`,
    path: q.category ? `/katalog?kategoriia=${q.category}` : '/katalog',
    noindex: q.skin.length + q.need.length + q.purpose.length + q.season.length + q.age.length > 0 || !!q.q || q.page > 1,
  });

  const activeCount = q.skin.length + q.need.length + q.purpose.length + q.age.length + q.season.length + (q.band || q.min != null || q.max != null ? 1 : 0);
  const total = results.data?.total ?? 0;

  const categories = (meta.data?.categories ?? []).filter(c => c.count > 0 || c.slug === q.category);
  const panel = meta.data && <Filters meta={meta.data} q={q} update={update} />;

  const resultsView = (
    <VStack gap={5}>
      <HStack gap={3} hAlign="between" vAlign="center" wrap="wrap">
        <Text type="body" color="secondary" aria-live="polite">
          {results.isPending ? 'Шукаємо…' : `Знайдено: ${total}`}
        </Text>
        <Selector
          label="Сортування"
          isLabelHidden
          options={SORTS.map(s => ({value: s.key, label: s.label}))}
          value={q.sort}
          onChange={v => update({sort: v as CatalogQuery['sort']})}
          width={240}
        />
      </HStack>
      {meta.data && <ActiveFilters meta={meta.data} q={q} update={update} />}
      {results.isError ? (
        <ErrorState error={results.error} onRetry={() => results.refetch()} />
      ) : results.isPending ? (
        <Grid columns={{minWidth: 150}} gap={4}>
          {Array.from({length: 6}, (_, i) => (
            <Skeleton key={i} height={320} index={i} />
          ))}
        </Grid>
      ) : total === 0 ? (
        <EmptyState
          title="Нічого не знайдено"
          description="Спробуйте прибрати частину фільтрів або змінити пошук. Характеристики товарів поступово заповнюються."
          actions={<Button label="Скинути фільтри" onClick={() => update({skin: [], need: [], purpose: [], age: [], season: [], band: null, min: null, max: null, q: ''})} />}
        />
      ) : (
        <Grid columns={{minWidth: 170}} gap={4} align="stretch">
          {results.data.items.map(i => (
            <ItemCard key={i.id} item={i} />
          ))}
        </Grid>
      )}
      {total > PAGE_SIZE && <Pagination page={q.page} totalItems={total} pageSize={PAGE_SIZE} onChange={p => update({page: p}, true)} label="Сторінки каталогу" />}
    </VStack>
  );

  return (
    <Page>
      <VStack gap={4}>
        <Heading level={1}>{title}</Heading>
        <HStack gap={2} wrap="wrap">
          <Button label="Усі товари" size="sm" variant={!q.category ? 'primary' : 'secondary'} onClick={() => update({category: null, purpose: []})} />
          {categories.map(c => (
            <Button key={c.slug} label={c.name} size="sm" variant={q.category === c.slug ? 'primary' : 'secondary'} onClick={() => update({category: c.slug, purpose: c.slug === 'nabory' ? q.purpose : []})} />
          ))}
        </HStack>
        <HStack gap={2} vAlign="end" wrap="wrap">
          <TextInput label="Пошук за назвою" value={search} onChange={setSearch} startIcon={MagnifyingGlass} hasClear placeholder="Наприклад, тонік" width="100%" />
          {!wide && <Button label={activeCount ? `Фільтри (${activeCount})` : 'Фільтри'} icon={<Icon icon={Funnel} />} onClick={() => setSheet(true)} />}
        </HStack>
      </VStack>
      {wide ? (
        <section style={twoCols} aria-label="Каталог">
          <aside aria-label="Фільтри">{panel}</aside>
          {resultsView}
        </section>
      ) : (
        <>
          {resultsView}
          <BottomSheet isOpen={sheet} onOpenChange={setSheet} label="Фільтри" height="tall">
            <VStack gap={4} padding={2}>
              {panel}
              <Divider />
              <Button label={`Показати результати (${total})`} variant="primary" width="100%" onClick={() => setSheet(false)} />
            </VStack>
          </BottomSheet>
        </>
      )}
    </Page>
  );
}
