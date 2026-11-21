import {AlertDialog} from '@astryxdesign/core/AlertDialog';
import {Badge} from '@astryxdesign/core/Badge';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {CheckboxList, CheckboxListItem} from '@astryxdesign/core/CheckboxList';
import {FileInput} from '@astryxdesign/core/FileInput';
import {Grid} from '@astryxdesign/core/Grid';
import {Icon} from '@astryxdesign/core/Icon';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {Link} from '@astryxdesign/core/Link';
import {NumberInput} from '@astryxdesign/core/NumberInput';
import {Selector} from '@astryxdesign/core/Selector';
import {Switch} from '@astryxdesign/core/Switch';
import {Table} from '@astryxdesign/core/Table';
import {Heading, Text} from '@astryxdesign/core/Text';
import {TextArea} from '@astryxdesign/core/TextArea';
import {TextInput} from '@astryxdesign/core/TextInput';
import {ArrowDown, ArrowUp, Trash} from '@phosphor-icons/react';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useEffect, useMemo, useState} from 'react';
import {useNavigate, useParams, useSearchParams} from 'react-router';
import {kitDiscountKop} from '../../../supabase/functions/_shared/contracts.ts';
import {ErrorState, Loading} from '../../components/Status.tsx';
import {ProductImage} from '../../components/ui.tsx';
import {formatUah} from '../../lib/format.ts';
import {optimizeImage} from '../../lib/images.ts';
import {admin} from '../../lib/supabase.ts';
import type {FacetGroup, ItemKind} from '../../lib/types.ts';

type AdminItem = {
  id: string;
  kind: ItemKind;
  slug: string;
  name: string;
  volume: string | null;
  status: string;
  category: string;
  price_kop: number | null;
  base_kop: number | null;
  available: boolean;
  orderable: boolean;
  images: number;
  facets: number;
  components: number;
  home_pick: boolean;
  [k: string]: unknown;
};

const KIND_LABEL: Record<ItemKind, string> = {product: 'Товар', kit: 'Набір', sample: 'Пробник'};
const STATUS_LABEL: Record<string, string> = {draft: 'Чернетка', published: 'Опубліковано', archived: 'В архіві'};
const GROUPS: {group: FacetGroup; title: string; kinds: ItemKind[]}[] = [
  {group: 'skin_type', title: 'Тип шкіри', kinds: ['product', 'sample', 'kit']},
  {group: 'skin_need', title: 'Потреби шкіри', kinds: ['product', 'sample', 'kit']},
  {group: 'kit_purpose', title: 'Призначення набору', kinds: ['kit']},
  {group: 'age_product', title: 'Вік (необовʼязково)', kinds: ['product', 'sample']},
  {group: 'age_kit', title: 'Вік (необовʼязково)', kinds: ['kit']},
  {group: 'season', title: 'Сезон (необовʼязково)', kinds: ['product', 'sample', 'kit']},
];

const TR: Record<string, string> = {а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ь: '', ю: 'iu', я: 'ia', "'": '', 'ʼ': '', '’': ''};
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .split('')
    .map(c => TR[c] ?? c)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);

const useItems = () =>
  useQuery({
    queryKey: ['admin-items'],
    queryFn: async () => {
      const {data, error} = await admin().rpc('admin_items');
      if (error) throw error;
      return data as AdminItem[];
    },
  });

const deleteErrText = (e: unknown) => {
  const err = e as {message?: string; hint?: string};
  if (err?.message === 'ITEM_IN_KIT') return `Цей товар входить до складу наборів: ${err.hint ?? ''}. Спершу приберіть його зі складу цих наборів або видаліть набори.`;
  if (err?.message === 'ITEM_NOT_FOUND') return 'Позицію вже видалено.';
  return 'Не вдалося видалити.';
};

export function AdminItems() {
  const items = useItems();
  const qc = useQueryClient();
  const [kind, setKind] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<AdminItem | null>(null);
  const remove = useMutation({
    mutationFn: async (itemId: string) => {
      const {data, error} = await admin().rpc('admin_delete_item', {p_item: itemId});
      if (error) throw error;
      const paths = (data as {image_paths: string[]}).image_paths;
      // best effort: the item is already gone, leftover files are harmless
      if (paths.length) await admin().storage.from('catalog').remove(paths);
    },
    onSettled: () => {
      setToDelete(null);
      void qc.invalidateQueries({queryKey: ['admin-items']});
    },
  });
  if (items.isPending) return <Loading />;
  if (items.isError) return <ErrorState error={items.error} onRetry={() => items.refetch()} />;
  const rows = items.data.filter(i => !kind || i.kind === kind);
  return (
    <VStack gap={4}>
      <HStack gap={3} hAlign="between" vAlign="center" wrap="wrap">
        <Heading level={1}>Товари й набори</Heading>
        <HStack gap={2} wrap="wrap">
          <Button label="Новий товар" variant="primary" href="/admin/tovary/novyi?kind=product" />
          <Button label="Новий пробник" href="/admin/tovary/novyi?kind=sample" />
          <Button label="Новий набір" href="/admin/tovary/novyi?kind=kit" />
        </HStack>
      </HStack>
      <Selector label="Тип" hasClear value={kind} onChange={setKind} options={Object.entries(KIND_LABEL).map(([value, label]) => ({value, label}))} placeholder="Усі" width={240} />
      {remove.isError && <Banner status="error" title={deleteErrText(remove.error)} collapsible={false} />}
      <Table<AdminItem>
        data={rows}
        idKey="id"
        density="compact"
        hasHover
        columns={[
          {key: 'name', header: 'Назва', renderCell: i => <Link href={`/admin/tovary/${i.id}`} label={i.name}>{i.name}</Link>},
          {key: 'kind', header: 'Тип', renderCell: i => `${KIND_LABEL[i.kind]}${i.volume ? `, ${i.volume}` : ''}`},
          {key: 'price', header: 'Ціна', align: 'end', renderCell: i => (i.price_kop == null ? '—' : formatUah(i.price_kop))},
          {key: 'status', header: 'Статус', renderCell: i => <Badge variant={i.status === 'published' ? 'success' : 'neutral'} label={STATUS_LABEL[i.status] ?? i.status} />},
          {key: 'orderable', header: 'Замовлення', renderCell: i => (i.orderable ? 'приймаються' : <Badge variant="neutral" label="на паузі" />)},
          {key: 'data', header: 'Заповнено', renderCell: i => `фото ${i.images} · фільтри ${i.facets}${i.kind === 'kit' ? ` · склад ${i.components}` : ''}`},
          {
            key: 'actions',
            header: '',
            align: 'end',
            renderCell: i => (
              <Button
                label="Видалити"
                size="sm"
                variant="ghost"
                onClick={() => {
                  remove.reset();
                  setToDelete(i);
                }}
              />
            ),
          },
        ]}
      />
      <AlertDialog
        isOpen={toDelete !== null}
        onOpenChange={open => !open && setToDelete(null)}
        title={`Видалити «${toDelete?.name ?? ''}»?`}
        description="Позиція зникне з магазину й адмінки разом із фото та фільтрами. Уже оформлені замовлення збережуть свій склад і ціни. Цю дію не можна скасувати. Щоб лише тимчасово прибрати з продажу, вимкніть «Приймаємо замовлення» в картці товару."
        actionLabel="Видалити"
        cancelLabel="Скасувати"
        isActionLoading={remove.isPending}
        onAction={() => toDelete && remove.mutate(toDelete.id)}
      />
    </VStack>
  );
}

type Form = {
  kind: ItemKind;
  category_slug: string;
  slug: string;
  name: string;
  volume: string;
  price_uah: number | null;
  kit_discount_pct: number;
  short_purpose: string;
  description: string;
  inci: string;
  usage: string;
  warnings: string;
  status: string;
  orderable: boolean;
  sort: number;
};

export function AdminItemEdit() {
  const {id = 'novyi'} = useParams();
  const isNew = id === 'novyi';
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const all = useItems();
  const dict = useQuery({
    queryKey: ['admin-dict'],
    queryFn: async () => {
      const [c, f] = await Promise.all([admin().from('categories').select('id,slug,name,item_kind').order('sort'), admin().from('facets').select('id,group_key,slug,label').order('sort')]);
      if (c.error || f.error) throw c.error ?? f.error;
      return {categories: c.data as {id: number; slug: string; name: string; item_kind: ItemKind}[], facets: f.data as {id: number; group_key: FacetGroup; slug: string; label: string}[]};
    },
  });
  const item = useQuery({
    queryKey: ['admin-item', id],
    enabled: !isNew,
    queryFn: async () => {
      const {data, error} = await admin()
        .from('items')
        .select('*,categories(slug),item_facets(facet_id),item_images(id,path,alt,sort),kit_components!kit_components_kit_id_fkey(product_id,qty,sort)')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as Record<string, unknown> & {
        categories: {slug: string};
        item_facets: {facet_id: number}[];
        item_images: {id: string; path: string; alt: string | null; sort: number}[];
        kit_components: {product_id: string; qty: number; sort: number}[];
      };
    },
  });

  const kindParam = (sp.get('kind') as ItemKind) ?? 'product';
  const [f, setF] = useState<Form | null>(null);
  const [facets, setFacets] = useState<number[]>([]);
  const [components, setComponents] = useState<{id: string; qty: number}[]>([]);
  const [slugTouched, setSlugTouched] = useState(false);
  useEffect(() => {
    if (isNew && !f) {
      setF({
        kind: kindParam,
        category_slug: kindParam === 'kit' ? 'nabory' : kindParam === 'sample' ? 'probnyky' : 'kremy',
        slug: '',
        name: '',
        volume: '',
        price_uah: null,
        kit_discount_pct: 15,
        short_purpose: '',
        description: '',
        inci: '',
        usage: '',
        warnings: '',
        status: 'draft',
        orderable: true,
        sort: 0,
      });
    }
    if (item.data && !f) {
      const d = item.data;
      setF({
        kind: d.kind as ItemKind,
        category_slug: d.categories.slug,
        slug: d.slug as string,
        name: d.name as string,
        volume: (d.volume as string) ?? '',
        price_uah: d.price_kop == null ? null : (d.price_kop as number) / 100,
        kit_discount_pct: (d.kit_discount_bp as number) / 100,
        short_purpose: (d.short_purpose as string) ?? '',
        description: (d.description as string) ?? '',
        inci: (d.inci as string) ?? '',
        usage: (d.usage as string) ?? '',
        warnings: (d.warnings as string) ?? '',
        status: d.status as string,
        orderable: d.orderable as boolean,
        sort: d.sort as number,
      });
      setFacets(d.item_facets.map(x => x.facet_id));
      setComponents([...d.kit_components].sort((a, b) => a.sort - b.sort).map(c => ({id: c.product_id, qty: c.qty})));
      setSlugTouched(true);
    }
  }, [item.data, isNew]); // eslint-disable-line react-hooks/exhaustive-deps

  const products = useMemo(() => (all.data ?? []).filter(i => i.kind !== 'kit' && i.status !== 'archived'), [all.data]);
  const kitBase = components.reduce((s, c) => s + (products.find(p => p.id === c.id)?.price_kop ?? 0) * c.qty, 0);

  const save = useMutation({
    mutationFn: async () => {
      if (!f || !dict.data) throw new Error('form');
      const cat = dict.data.categories.find(c => c.slug === f.category_slug && c.item_kind === f.kind);
      if (!cat) throw new Error('Оберіть категорію');
      if (!f.name.trim()) throw new Error('Вкажіть назву');
      if (f.kind !== 'kit' && (f.price_uah == null || f.price_uah < 0)) throw new Error('Вкажіть ціну');
      if (f.kind === 'kit' && f.status === 'published' && components.length === 0) throw new Error('Набір без складу не можна опублікувати');
      const row = {
        kind: f.kind,
        category_id: cat.id,
        slug: f.slug || slugify(f.name),
        name: f.name.trim(),
        volume: f.volume.trim() || null,
        price_kop: f.kind === 'kit' ? null : Math.round((f.price_uah ?? 0) * 100),
        kit_discount_bp: Math.round(f.kit_discount_pct * 100),
        short_purpose: f.short_purpose.trim() || null,
        description: f.description.trim() || null,
        inci: f.inci.trim() || null,
        usage: f.usage.trim() || null,
        warnings: f.warnings.trim() || null,
        status: f.status,
        orderable: f.orderable,
        sort: f.sort,
      };
      const r = isNew ? await admin().from('items').insert(row).select('id').single() : await admin().from('items').update(row).eq('id', id).select('id').single();
      if (r.error) throw new Error(r.error.code === '23505' ? 'Такий slug уже існує' : r.error.message);
      const itemId = r.data.id as string;
      const fr = await admin().rpc('admin_set_item_facets', {p_item: itemId, p_facets: facets});
      if (fr.error) throw new Error(fr.error.message);
      if (f.kind === 'kit') {
        const kr = await admin().rpc('admin_set_kit_components', {p_kit: itemId, p_components: components});
        if (kr.error) throw new Error(kr.error.message);
      }
      return itemId;
    },
    onSuccess: newId => {
      void qc.invalidateQueries({queryKey: ['admin-items']});
      void qc.invalidateQueries({queryKey: ['admin-item', newId]});
      void qc.invalidateQueries({queryKey: ['meta']});
      if (isNew) navigate(`/admin/tovary/${newId}`, {replace: true});
    },
  });

  const homePick = useMutation({
    mutationFn: async (on: boolean) => {
      const current = (all.data ?? []).filter(i => i.home_pick).map(i => i.id);
      const next = on ? [...current.filter(x => x !== id), id] : current.filter(x => x !== id);
      const {error} = await admin().rpc('admin_set_home_picks', {p_items: next});
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({queryKey: ['admin-items']}),
  });

  if ((!isNew && item.isPending) || dict.isPending || !f) return <Loading />;
  if (item.isError) return <ErrorState error={item.error} />;
  const set = (p: Partial<Form>) => setF(x => ({...x!, ...p}));
  const onHome = (all.data ?? []).find(i => i.id === id)?.home_pick ?? false;

  return (
    <VStack gap={5}>
      <HStack gap={3} vAlign="center" wrap="wrap">
        <Button label="← До списку" variant="ghost" size="sm" href="/admin/tovary" />
        <Heading level={1}>{isNew ? `${KIND_LABEL[f.kind]}: новий` : f.name}</Heading>
      </HStack>
      <Banner status="info" title="Заповнюйте лише підтверджені дані" description="Порожні розділи не показуються покупцям. Не додавайте склад, властивості чи характеристики, яких немає в документації засобу." collapsible={false} />
      <Card padding={5}>
        <VStack gap={4}>
          <Grid columns={{minWidth: 240}} gap={3}>
            <TextInput label="Назва" value={f.name} onChange={v => set({name: v, ...(slugTouched ? {} : {slug: slugify(v)})})} isRequired />
            <TextInput label="Адреса (slug)" value={f.slug} onChange={v => (setSlugTouched(true), set({slug: v}))} description="латиниця, цифри, дефіс" />
            <Selector
              label="Категорія"
              value={f.category_slug}
              onChange={v => set({category_slug: v})}
              options={(dict.data?.categories ?? []).filter(c => c.item_kind === f.kind).map(c => ({value: c.slug, label: c.name}))}
            />
            <TextInput label="Обʼєм" value={f.volume} onChange={v => set({volume: v})} placeholder="50 мл" isOptional />
            {f.kind !== 'kit' ? (
              <NumberInput label="Ціна, грн" value={f.price_uah} onChange={v => set({price_uah: v ?? null})} min={0} step={1} isRequired />
            ) : (
              <NumberInput label="Знижка набору, %" value={f.kit_discount_pct} onChange={v => set({kit_discount_pct: v ?? 15})} min={0} max={90} />
            )}
            <Selector label="Статус" value={f.status} onChange={v => set({status: v})} options={Object.entries(STATUS_LABEL).map(([value, label]) => ({value, label}))} />
            <NumberInput label="Порядок" value={f.sort} onChange={v => set({sort: v ?? 0})} isIntegerOnly />
          </Grid>
          <TextInput label="Коротке призначення" value={f.short_purpose} onChange={v => set({short_purpose: v})} isOptional />
          <TextArea label="Опис" value={f.description} onChange={v => set({description: v})} rows={4} isOptional />
          {f.kind !== 'kit' && <TextArea label="Склад (INCI)" value={f.inci} onChange={v => set({inci: v})} rows={3} isOptional />}
          <TextArea label="Спосіб застосування" value={f.usage} onChange={v => set({usage: v})} rows={3} isOptional />
          <TextArea label="Застереження" value={f.warnings} onChange={v => set({warnings: v})} rows={2} isOptional />
        </VStack>
      </Card>

      {f.kind === 'kit' && (
        <Card padding={5}>
          <VStack gap={3}>
            <Heading level={2}>Склад набору</Heading>
            {components.map((c, n) => (
              <HStack key={n} gap={2} vAlign="end" wrap="wrap">
                <Selector
                  label="Товар"
                  value={c.id}
                  onChange={v => setComponents(cs => cs.map((x, i) => (i === n ? {...x, id: v} : x)))}
                  options={products.map(p => ({value: p.id, label: `${p.name}${p.volume ? `, ${p.volume}` : ''} — ${p.price_kop == null ? '' : formatUah(p.price_kop)}`}))}
                  hasSearch
                  width={420}
                />
                <NumberInput label="Кількість" value={c.qty} onChange={v => setComponents(cs => cs.map((x, i) => (i === n ? {...x, qty: Math.max(1, v ?? 1)} : x)))} min={1} max={20} isIntegerOnly width={120} />
                <Button label="Прибрати" variant="ghost" isIconOnly icon={<Icon icon={Trash} />} onClick={() => setComponents(cs => cs.filter((_, i) => i !== n))} />
              </HStack>
            ))}
            <Button label="Додати товар" isDisabled={products.length === 0} onClick={() => setComponents(cs => [...cs, {id: products[0]!.id, qty: 1}])} />
            <Text type="body">
              Окремо: {formatUah(kitBase)} · знижка {f.kit_discount_pct}%: −{formatUah(kitDiscountKop(kitBase, f.kit_discount_pct * 100))} · ціна набору:{' '}
              {formatUah(kitBase - kitDiscountKop(kitBase, f.kit_discount_pct * 100))}
            </Text>
            <Text type="supporting" color="secondary">
              Ціна набору завжди рахується сервером з поточних цін складу; знижка застосовується один раз.
            </Text>
          </VStack>
        </Card>
      )}

      <Card padding={5}>
        <VStack gap={4}>
          <Heading level={2}>Характеристики для фільтрів</Heading>
          <Grid columns={{minWidth: 240}} gap={4}>
            {GROUPS.filter(g => g.kinds.includes(f.kind)).map(g => {
              const opts = (dict.data?.facets ?? []).filter(x => x.group_key === g.group);
              const ids = new Set(opts.map(o => o.id));
              return (
                <CheckboxList
                  key={g.group}
                  label={g.title}
                  value={facets.filter(x => ids.has(x)).map(String)}
                  onChange={v => setFacets(cur => [...cur.filter(x => !ids.has(x)), ...v.map(Number)])}
                  density="compact"
                >
                  {opts.map(o => (
                    <CheckboxListItem key={o.id} value={String(o.id)} label={o.label} />
                  ))}
                </CheckboxList>
              );
            })}
          </Grid>
        </VStack>
      </Card>

      <Card padding={5}>
        <VStack gap={3}>
          <Heading level={2}>Замовлення</Heading>
          <Switch label="Приймаємо замовлення" value={f.orderable} onChange={v => set({orderable: v})} />
          <Text type="supporting" color="secondary">
            Усі засоби виготовляються під замовлення, залишки не ведуться. Вимкніть, щоб тимчасово призупинити замовлення цього засобу{f.kind === 'kit' ? ' (набір також недоступний, якщо на паузі будь-який товар зі складу)' : ''}.
          </Text>
        </VStack>
      </Card>

      {save.isError && <Banner status="error" title={(save.error as Error).message} collapsible={false} />}
      {save.isSuccess && <Banner status="success" title="Збережено" collapsible={false} />}
      <HStack gap={2} wrap="wrap">
        <Button label="Зберегти" variant="primary" size="lg" isLoading={save.isPending} onClick={() => save.mutate()} />
        {!isNew && <Switch label="Показувати на головній" value={onHome} onChange={v => homePick.mutate(v)} />}
      </HStack>

      {!isNew && <Photos itemId={id} images={item.data?.item_images ?? []} onChange={() => void qc.invalidateQueries({queryKey: ['admin-item', id]})} />}
    </VStack>
  );
}

function Photos({itemId, images, onChange}: {itemId: string; images: {id: string; path: string; alt: string | null; sort: number}[]; onChange: () => void}) {
  const [files, setFiles] = useState<File[] | null>(null);
  const sorted = [...images].sort((a, b) => a.sort - b.sort);
  const upload = useMutation({
    mutationFn: async (list: File[]) => {
      let sort = (sorted.at(-1)?.sort ?? 0) + 1;
      for (const file of list) {
        const blob = await optimizeImage(file);
        const path = `items/${itemId}/${crypto.randomUUID().slice(0, 12)}.webp`;
        const up = await admin().storage.from('catalog').upload(path, blob, {contentType: 'image/webp', upsert: false});
        if (up.error) throw up.error;
        const ins = await admin().from('item_images').insert({item_id: itemId, path, sort: sort++});
        if (ins.error) throw ins.error;
      }
    },
    onSuccess: () => {
      setFiles(null);
      onChange();
    },
  });
  const move = useMutation({
    mutationFn: async ({i, dir}: {i: number; dir: -1 | 1}) => {
      const a = sorted[i]!;
      const b = sorted[i + dir]!;
      await admin().from('item_images').update({sort: b.sort}).eq('id', a.id);
      await admin().from('item_images').update({sort: a.sort}).eq('id', b.id);
    },
    onSuccess: onChange,
  });
  const remove = useMutation({
    mutationFn: async (im: {id: string; path: string}) => {
      await admin().storage.from('catalog').remove([im.path]);
      const r = await admin().from('item_images').delete().eq('id', im.id);
      if (r.error) throw r.error;
    },
    onSuccess: onChange,
  });
  const alt = useMutation({
    mutationFn: async ({id, alt}: {id: string; alt: string}) => {
      await admin().from('item_images').update({alt: alt || null}).eq('id', id);
    },
  });
  return (
    <Card padding={5}>
      <VStack gap={4}>
        <Heading level={2}>Фотографії</Heading>
        <Text type="supporting" color="secondary">
          Перше фото — головне. Файли стискаються у WebP до 1600 px перед завантаженням (до 5 МБ).
        </Text>
        <Grid columns={{minWidth: 180}} gap={4}>
          {sorted.map((im, i) => (
            <VStack key={im.id} gap={2}>
              <ProductImage path={im.path} alt={im.alt ?? ''} ratio={1} />
              <TextInput label="Опис фото (alt)" value={im.alt ?? ''} onChange={v => alt.mutate({id: im.id, alt: v})} size="sm" />
              <HStack gap={1}>
                <Button label="Вище" isIconOnly size="sm" variant="ghost" icon={<Icon icon={ArrowUp} />} isDisabled={i === 0} onClick={() => move.mutate({i, dir: -1})} />
                <Button label="Нижче" isIconOnly size="sm" variant="ghost" icon={<Icon icon={ArrowDown} />} isDisabled={i === sorted.length - 1} onClick={() => move.mutate({i, dir: 1})} />
                <Button label="Видалити фото" isIconOnly size="sm" variant="ghost" icon={<Icon icon={Trash} />} onClick={() => remove.mutate(im)} />
              </HStack>
            </VStack>
          ))}
        </Grid>
        <FileInput label="Додати фото" value={files} onChange={v => setFiles(v ? (Array.isArray(v) ? v : [v]) : null)} accept="image/jpeg,image/png,image/webp,image/avif" isMultiple maxFiles={10} mode="dropzone" />
        {upload.isError && <Banner status="error" title={(upload.error as Error).message || 'Не вдалося завантажити'} collapsible={false} />}
        <Button label="Завантажити" variant="primary" isDisabled={!files?.length} isLoading={upload.isPending} onClick={() => files && upload.mutate(files)} />
      </VStack>
    </Card>
  );
}
