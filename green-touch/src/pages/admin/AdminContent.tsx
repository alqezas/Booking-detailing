import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {FileInput} from '@astryxdesign/core/FileInput';
import {Grid} from '@astryxdesign/core/Grid';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {Switch} from '@astryxdesign/core/Switch';
import {Heading, Text} from '@astryxdesign/core/Text';
import {TextArea} from '@astryxdesign/core/TextArea';
import {TextInput} from '@astryxdesign/core/TextInput';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useEffect, useState} from 'react';
import {ErrorState, Loading} from '../../components/Status.tsx';
import {ProductImage} from '../../components/ui.tsx';
import {optimizeImage} from '../../lib/images.ts';
import {admin} from '../../lib/supabase.ts';
import {TelegramCard} from './AdminTelegram.tsx';

type Settings = Record<string, Record<string, unknown>>;

const FIELDS: {key: string; title: string; fields: {k: string; label: string; long?: boolean}[]}[] = [
  {
    key: 'brand',
    title: 'Бренд і головна',
    fields: [
      {k: 'tagline', label: 'Коротке позиціонування'},
      {k: 'hero_text', label: 'Текст першого екрана', long: true},
      {k: 'about_title', label: 'Заголовок блоку про косметолога'},
      {k: 'cosmetologist_name', label: 'Імʼя косметолога'},
      {k: 'about_text', label: 'Текст про косметолога та бренд', long: true},
    ],
  },
  {
    key: 'contacts',
    title: 'Контакти',
    fields: [
      {k: 'phone', label: 'Телефон'},
      {k: 'email', label: 'Email'},
      {k: 'instagram', label: 'Instagram (посилання)'},
      {k: 'telegram', label: 'Telegram (посилання)'},
      {k: 'address', label: 'Адреса'},
      {k: 'hours', label: 'Години роботи'},
    ],
  },
  {
    key: 'legal',
    title: 'Реквізити продавця',
    fields: [
      {k: 'seller_name', label: 'Найменування / ПІБ ФОП'},
      {k: 'seller_code', label: 'ЄДРПОУ / РНОКПП'},
      {k: 'seller_address', label: 'Адреса'},
    ],
  },
  {
    key: 'delivery',
    title: 'Доставка й оплата (коротко)',
    fields: [
      {k: 'summary', label: 'Доставка', long: true},
      {k: 'payment', label: 'Оплата', long: true},
    ],
  },
];

function BrandPhoto({field, value, onSaved}: {field: 'cosmetologist_photo' | 'hero_photo'; value: string | null; onSaved: (path: string | null) => void}) {
  const [file, setFile] = useState<File | null>(null);
  const up = useMutation({
    mutationFn: async (f: File) => {
      const blob = await optimizeImage(f, 1800);
      const path = `brand/${field.replace('_', '-')}/${crypto.randomUUID().slice(0, 12)}.webp`;
      const r = await admin().storage.from('catalog').upload(path, blob, {contentType: 'image/webp'});
      if (r.error) throw r.error;
      return path;
    },
    onSuccess: p => {
      setFile(null);
      onSaved(p);
    },
  });
  return (
    <VStack gap={2}>
      <Text type="label">{field === 'hero_photo' ? 'Фото першого екрана' : 'Фото косметолога'}</Text>
      <ProductImage path={value} alt="" ratio={field === 'hero_photo' ? 4 / 3 : 1} />
      <FileInput label="Обрати файл" value={file} onChange={v => setFile(Array.isArray(v) ? (v[0] ?? null) : v)} accept="image/jpeg,image/png,image/webp,image/avif" />
      {up.isError && <Banner status="error" title={(up.error as Error).message} collapsible={false} />}
      <HStack gap={2}>
        <Button label="Завантажити" size="sm" isDisabled={!file} isLoading={up.isPending} onClick={() => file && up.mutate(file)} />
        {value && <Button label="Прибрати" size="sm" variant="ghost" onClick={() => onSaved(null)} />}
      </HStack>
    </VStack>
  );
}

export function AdminContent() {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ['admin-settings'],
    queryFn: async () => {
      const [s, p] = await Promise.all([admin().from('shop_settings').select('key,value'), admin().from('pages').select('slug,title,body,needs_review').order('slug')]);
      if (s.error || p.error) throw s.error ?? p.error;
      return {settings: Object.fromEntries(s.data.map(r => [r.key, r.value])) as Settings, pages: p.data as {slug: string; title: string; body: string; needs_review: boolean}[]};
    },
  });
  const [s, setS] = useState<Settings | null>(null);
  const [pages, setPages] = useState<{slug: string; title: string; body: string; needs_review: boolean}[]>([]);
  useEffect(() => {
    if (settings.data) {
      setS(settings.data.settings);
      setPages(settings.data.pages);
    }
  }, [settings.data]);
  const save = useMutation({
    mutationFn: async () => {
      for (const [key, value] of Object.entries(s ?? {})) {
        const clean = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, typeof v === 'string' && v.trim() === '' ? null : v]));
        const r = await admin().from('shop_settings').update({value: clean, updated_at: new Date().toISOString()}).eq('key', key);
        if (r.error) throw r.error;
      }
      for (const p of pages) {
        const r = await admin().from('pages').update({title: p.title, body: p.body, needs_review: p.needs_review, updated_at: new Date().toISOString()}).eq('slug', p.slug);
        if (r.error) throw r.error;
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({queryKey: ['meta']});
      void qc.invalidateQueries({queryKey: ['page']});
    },
  });
  if (settings.isPending || !s) return <Loading />;
  if (settings.isError) return <ErrorState error={settings.error} />;
  const setField = (group: string, k: string, v: unknown) => setS(x => ({...x!, [group]: {...(x![group] ?? {}), [k]: v}}));
  const filters = (s.filters ?? {}) as {season_visible?: boolean; age_visible?: boolean};

  return (
    <VStack gap={5}>
      <Heading level={1}>Контент магазину</Heading>
      <Card padding={5}>
        <Grid columns={{minWidth: 260}} gap={5}>
          <BrandPhoto field="hero_photo" value={(s.brand?.hero_photo as string) ?? null} onSaved={p => setField('brand', 'hero_photo', p)} />
          <BrandPhoto field="cosmetologist_photo" value={(s.brand?.cosmetologist_photo as string) ?? null} onSaved={p => setField('brand', 'cosmetologist_photo', p)} />
        </Grid>
      </Card>
      {FIELDS.map(g => (
        <Card key={g.key} padding={5}>
          <VStack gap={3}>
            <Heading level={2}>{g.title}</Heading>
            {g.fields.map(fl =>
              fl.long ? (
                <TextArea key={fl.k} label={fl.label} value={String(s[g.key]?.[fl.k] ?? '')} onChange={v => setField(g.key, fl.k, v)} rows={3} isOptional />
              ) : (
                <TextInput key={fl.k} label={fl.label} value={String(s[g.key]?.[fl.k] ?? '')} onChange={v => setField(g.key, fl.k, v)} isOptional />
              ),
            )}
          </VStack>
        </Card>
      ))}
      <Card padding={5}>
        <VStack gap={3}>
          <Heading level={2}>Фільтри каталогу</Heading>
          <Switch label="Показувати фільтр «Сезон»" value={filters.season_visible === true} onChange={v => setField('filters', 'season_visible', v)} />
          <Switch label="Показувати фільтр «Вік»" value={filters.age_visible === true} onChange={v => setField('filters', 'age_visible', v)} />
          <Text type="supporting" color="secondary">Увімкніть, коли мітки заповнено для більшості товарів.</Text>
        </VStack>
      </Card>
      <Card padding={5}>
        <VStack gap={4}>
          <Heading level={2}>Інформаційні сторінки</Heading>
          <Text type="supporting" color="secondary">Markdown: «## Заголовок», «- пункт». Фрагменти [ЗАПОВНІТЬ: …] замініть перед запуском.</Text>
          {pages.map((p, i) => (
            <VStack key={p.slug} gap={2}>
              <TextInput label={`Заголовок (/${p.slug})`} value={p.title} onChange={v => setPages(ps => ps.map((x, n) => (n === i ? {...x, title: v} : x)))} />
              <TextArea label="Текст" value={p.body} onChange={v => setPages(ps => ps.map((x, n) => (n === i ? {...x, body: v} : x)))} rows={8} />
              <Switch label="Потребує перевірки (показує покупцям примітку)" value={p.needs_review} onChange={v => setPages(ps => ps.map((x, n) => (n === i ? {...x, needs_review: v} : x)))} />
            </VStack>
          ))}
        </VStack>
      </Card>
      {save.isError && <Banner status="error" title="Не вдалося зберегти" collapsible={false} />}
      {save.isSuccess && <Banner status="success" title="Збережено" collapsible={false} />}
      <Button label="Зберегти все" variant="primary" size="lg" isLoading={save.isPending} onClick={() => save.mutate()} />
    </VStack>
  );
}

export function AdminLaunch() {
  const q = useQuery({
    queryKey: ['admin-launch'],
    queryFn: async () => {
      const {data, error} = await admin().rpc('admin_launch_checklist');
      if (error) throw error;
      return data as Record<string, number | string[]>;
    },
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} />;
  const d = q.data;
  const rows: [string, string | number, boolean][] = [
    ['Опубліковано позицій', d.published_items as number, true],
    ['Без фото', d.without_photos as number, d.without_photos === 0],
    ['Без характеристик для фільтрів', d.without_facets as number, d.without_facets === 0],
    ['Без опису', d.without_description as number, d.without_description === 0],
    ['Без складу INCI', d.without_inci as number, d.without_inci === 0],
    ['Без способу застосування', d.without_usage as number, d.without_usage === 0],
    ['Наборів опубліковано', d.kits_published as number, (d.kits_published as number) > 0],
    ['Пробників', d.samples as number, (d.samples as number) > 0],
    ['Сторінки, що потребують перевірки', (d.pages_need_review as string[]).join(', ') || 'немає', (d.pages_need_review as string[]).length === 0],
    ['Порожні контакти', (d.contacts_missing as string[]).join(', ') || 'немає', (d.contacts_missing as string[]).length === 0],
    ['Замовлення на перевірці', d.orders_need_review as number, d.orders_need_review === 0],
    ['Невдалі фонові події (outbox)', d.outbox_dead as number, d.outbox_dead === 0],
  ];
  return (
    <VStack gap={4}>
      <Heading level={1}>Перед запуском</Heading>
      <Card padding={5}>
        <VStack gap={2}>
          {rows.map(([label, value, ok]) => (
            <HStack key={label} gap={3} hAlign="between">
              <Text type="body">{label}</Text>
              <Text type="body" weight="semibold" color={ok ? 'secondary' : 'accent'}>
                {String(value)} {ok ? '✓' : '— потрібно доповнити'}
              </Text>
            </HStack>
          ))}
        </VStack>
      </Card>
      <TelegramCard />
      <Card padding={5}>
        <VStack gap={2}>
          <Heading level={2}>Матеріали від власниці</Heading>
          {[
            'Фото наборів (тексти й склад 12 наборів уже додано)',
            'Фотографії продукції, наборів і косметолога',
            'Підтверджені характеристики для фільтрів (тип шкіри, потреби, за бажанням — вік і сезон)',
            'Описи, склад INCI, спосіб застосування, застереження',
            'Дані пробників: назви, обʼєми, ціни',
            'Контакти та реквізити продавця, тексти умов повернення й політики конфіденційності',
            'Ключ Нової пошти (API key); токен monobank уже підключено',
          ].map(t => (
            <Text key={t} type="body">
              • {t}
            </Text>
          ))}
        </VStack>
      </Card>
    </VStack>
  );
}
