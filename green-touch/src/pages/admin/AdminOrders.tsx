import {AlertDialog} from '@astryxdesign/core/AlertDialog';
import {Badge} from '@astryxdesign/core/Badge';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import type {ISODateString} from '@astryxdesign/core/Calendar';
import {Card} from '@astryxdesign/core/Card';
import {DateRangeInput, type DateRange, type DateRangePreset} from '@astryxdesign/core/DateRangeInput';
import {Divider} from '@astryxdesign/core/Divider';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Grid} from '@astryxdesign/core/Grid';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {Link} from '@astryxdesign/core/Link';
import {MetadataList, MetadataListItem} from '@astryxdesign/core/MetadataList';
import {Selector} from '@astryxdesign/core/Selector';
import {Table, pixel, proportional} from '@astryxdesign/core/Table';
import {Heading, Text} from '@astryxdesign/core/Text';
import {TextArea} from '@astryxdesign/core/TextArea';
import {TextInput} from '@astryxdesign/core/TextInput';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useEffect, useState} from 'react';
import {useNavigate, useParams} from 'react-router';
import {ErrorState, Loading} from '../../components/Status.tsx';
import {FULFILLMENT_LABEL, PAYMENT_LABEL, REVIEW_LABEL, addDays, formatUah, kyivDateTime, kyivDayStartUtc, kyivToday} from '../../lib/format.ts';
import {admin} from '../../lib/supabase.ts';

type OrderRow = {
  id: string;
  number: number;
  first_name: string;
  last_name: string;
  phone: string;
  total_kop: number;
  payment_status: string;
  payment_method: string;
  prepay_kop: number;
  prepay_received_at: string | null;
  fulfillment_status: string;
  needs_review: boolean;
  created_at: string;
  delivery_method: string;
  np_settlement_name: string;
  np_area: string | null;
  np_warehouse_name: string;
  ttn: string | null;
  [k: string]: unknown;
};

function PaymentBadge({o, short = false}: {o: Pick<OrderRow, 'payment_method' | 'payment_status' | 'prepay_kop' | 'prepay_received_at'>; short?: boolean}) {
  if (o.payment_method === 'prepay_manual') {
    if (o.prepay_received_at) return <Badge variant="success" label={short ? 'Передоплата є' : 'Передоплату отримано'} />;
    return <Badge variant="warning" label={short ? `Чекає ${formatUah(o.prepay_kop)}` : `Чекає передоплату ${formatUah(o.prepay_kop)}`} />;
  }
  const p = PAYMENT_LABEL[o.payment_status];
  const label = short && o.payment_status === 'paid' ? 'Оплачено' : (p?.label ?? o.payment_status);
  return <Badge variant={p?.variant ?? 'neutral'} label={label} />;
}

const ERR: Record<string, string> = {
  NOT_READY_TO_SHIP: 'Спершу потрібна оплата (підтверджена monobank) або позначка «Передоплату отримано», і відсутність позначки «потребує перевірки».',
  TTN_REQUIRED: 'Для статусу «Відправлено» вкажіть ТТН.',
  NOTE_REQUIRED: 'Опишіть, як вирішено питання.',
  NOT_PREPAY_ORDER: 'Для цього замовлення обрано повну оплату онлайн.',
  FORBIDDEN: 'Немає прав.',
  ORDER_PAID: 'Замовлення оплачене через monobank. Спершу поверніть оплату в кабінеті web.monobank.ua, після повернення його можна видалити.',
  PAYMENT_IN_PROGRESS: 'Покупець саме зараз оплачує це замовлення. Спробуйте за кілька хвилин.',
  ORDER_NOT_FOUND: 'Замовлення вже видалено.',
};
const errText = (e: unknown) => {
  const m = (e as {message?: string})?.message ?? '';
  return ERR[m] ?? (m.includes('ttn') ? 'ТТН — це 10–20 цифр.' : 'Не вдалося виконати дію.');
};

const day = (s: string) => s as ISODateString;
const DATE_PRESETS: DateRangePreset[] = [
  {label: 'Сьогодні', getRange: () => ({start: day(kyivToday()), end: day(kyivToday())})},
  {label: 'Вчора', getRange: () => ({start: day(addDays(kyivToday(), -1)), end: day(addDays(kyivToday(), -1))})},
  {label: 'Останні 7 днів', getRange: () => ({start: day(addDays(kyivToday(), -6)), end: day(kyivToday())})},
  {label: 'Останні 30 днів', getRange: () => ({start: day(addDays(kyivToday(), -29)), end: day(kyivToday())})},
  {label: 'Цей місяць', getRange: () => ({start: day(`${kyivToday().slice(0, 8)}01`), end: day(kyivToday())})},
];

export function AdminOrders() {
  const [q, setQ] = useState('');
  const [range, setRange] = useState<DateRange | null>(null);
  const [pay, setPay] = useState<string | null>(null);
  const [ful, setFul] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setSearch(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);
  const list = useQuery({
    queryKey: ['admin-orders', search, pay, ful, range?.start, range?.end],
    queryFn: async () => {
      let r = admin().from('orders').select('id,number,first_name,last_name,phone,total_kop,payment_status,payment_method,prepay_kop,prepay_received_at,fulfillment_status,needs_review,created_at,delivery_method,np_settlement_name,np_area,np_warehouse_name,ttn').order('created_at', {ascending: false}).limit(500);
      // Calendar days are Kyiv days; the database stores UTC.
      if (range) r = r.gte('created_at', kyivDayStartUtc(range.start)).lt('created_at', kyivDayStartUtc(addDays(range.end, 1)));
      if (pay) r = r.eq('payment_status', pay);
      if (ful) r = r.eq('fulfillment_status', ful);
      if (search) {
        const s = search.replace(/[%,()]/g, '');
        r = /^\d+$/.test(s) && s.length < 9 ? r.eq('number', Number(s)) : r.or(`phone.ilike.%${s.replace(/^0/, '')}%,last_name.ilike.%${s}%,first_name.ilike.%${s}%`);
      }
      const {data, error} = await r;
      if (error) throw error;
      return data as OrderRow[];
    },
    refetchInterval: 30_000,
  });
  const qc = useQueryClient();
  const [toDelete, setToDelete] = useState<OrderRow | null>(null);
  const remove = useMutation({
    mutationFn: async (orderId: string) => {
      const {error} = await admin().rpc('admin_delete_order', {p_order: orderId});
      if (error) throw error;
    },
    onSettled: () => {
      setToDelete(null);
      void qc.invalidateQueries({queryKey: ['admin-orders']});
    },
  });
  return (
    <VStack gap={4}>
      <Heading level={1}>Замовлення</Heading>
      {remove.isError && <Banner status="error" title={errText(remove.error)} collapsible={false} />}
      <Grid columns={{minWidth: 200}} gap={3}>
        <TextInput label="Пошук" value={q} onChange={setQ} placeholder="Номер, телефон або прізвище" hasClear />
        <Selector label="Оплата" hasClear value={pay} onChange={setPay} options={Object.entries(PAYMENT_LABEL).map(([value, v]) => ({value, label: v.label}))} placeholder="Усі" />
        <Selector label="Обробка" hasClear value={ful} onChange={setFul} options={Object.entries(FULFILLMENT_LABEL).map(([value, label]) => ({value, label}))} placeholder="Усі" />
        <DateRangeInput label="Дата (Київ)" value={range} onChange={setRange} presets={DATE_PRESETS} placeholder="За весь час" weekStartsOn="mon" max={day(kyivToday())} />
      </Grid>
      {list.isSuccess && list.data.length > 0 && (
        <Text type="supporting" color="secondary">
          {`Знайдено: ${list.data.length === 500 ? 'показано останні 500, звузьте фільтр' : list.data.length} · сума ${formatUah(list.data.reduce((a, o) => a + o.total_kop, 0))}`}
        </Text>
      )}
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.isPending ? (
        <Loading />
      ) : list.data.length === 0 ? (
        <EmptyState title="Замовлень не знайдено" />
      ) : (
        <Table<OrderRow>
          data={list.data}
          idKey="id"
          density="compact"
          hasHover
          columns={[
            {key: 'number', header: '№', width: pixel(60), renderCell: o => <Link href={`/admin/zamovlennia/${o.id}`} label={`№${o.number}`}>{`№${o.number}`}</Link>},
            {key: 'created_at', header: 'Дата (Київ)', width: pixel(130), renderCell: o => kyivDateTime(o.created_at)},
            {
              key: 'name',
              header: 'Покупець',
              width: proportional(1, {minWidth: 140}),
              renderCell: o => (
                <VStack gap={0.5}>
                  <Text type="body">{`${o.first_name} ${o.last_name}`}</Text>
                  <Text type="supporting" color="secondary">{o.phone}</Text>
                </VStack>
              ),
            },
            {
              key: 'delivery',
              header: 'Куди відправити (Нова пошта)',
              width: proportional(2, {minWidth: 200}),
              renderCell: o => (
                <VStack gap={0.5}>
                  <Text type="body">{`${o.np_settlement_name}${o.np_area ? `, ${o.np_area} обл.` : ''}`}</Text>
                  <Text type="supporting" color="secondary">{o.np_warehouse_name}</Text>
                  {o.ttn && <Text type="supporting" color="secondary">{`ТТН ${o.ttn}`}</Text>}
                </VStack>
              ),
            },
            {key: 'total_kop', header: 'Сума', align: 'end', width: pixel(90), renderCell: o => formatUah(o.total_kop)},
            {key: 'payment_status', header: 'Оплата', width: pixel(150), renderCell: o => <PaymentBadge o={o} short />},
            {
              key: 'fulfillment_status',
              header: 'Обробка',
              width: pixel(110),
              renderCell: o => (
                <HStack gap={1} wrap="wrap">
                  <Text type="body">{FULFILLMENT_LABEL[o.fulfillment_status]}</Text>
                  {o.needs_review && <Badge variant="warning" label="Перевірити" />}
                </HStack>
              ),
            },
            {
              key: 'actions',
              header: '',
              align: 'end',
              width: pixel(240),
              renderCell: o => (
                <HStack gap={1} hAlign="end">
                <Button label="Деталі" size="sm" variant="secondary" href={`/admin/zamovlennia/${o.id}`} />
                <Button
                  label="Видалити"
                  size="sm"
                  variant="ghost"
                  isDisabled={o.payment_status === 'paid'}
                  tooltip={o.payment_status === 'paid' ? 'Оплачене замовлення: спершу поверніть оплату в кабінеті monobank' : undefined}
                  onClick={() => {
                    remove.reset();
                    setToDelete(o);
                  }}
                />
                </HStack>
              ),
            },
          ]}
        />
      )}
      <AlertDialog
        isOpen={toDelete !== null}
        onOpenChange={open => !open && setToDelete(null)}
        title={`Видалити замовлення №${toDelete?.number ?? ''}?`}
        description={toDelete ? `${toDelete.first_name} ${toDelete.last_name}, ${formatUah(toDelete.total_kop)}. Цю дію не можна скасувати.` : ''}
        actionLabel="Видалити"
        cancelLabel="Скасувати"
        isActionLoading={remove.isPending}
        onAction={() => toDelete && remove.mutate(toDelete.id)}
      />
    </VStack>
  );
}

type Detail = OrderRow & {
  email: string | null;
  comment: string | null;
  delivery_method: string;
  np_settlement_name: string;
  np_area: string | null;
  np_warehouse_name: string;
  np_warehouse_number: string | null;
  subtotal_kop: number;
  discount_kop: number;
  ttn: string | null;
  owner_note: string | null;
  review_reasons: string[];
  paid_at: string | null;
  prepay_note: string | null;
  order_lines: {id: string; line_no: number; kind: string; name: string; volume: string | null; qty: number; unit_base_kop: number; unit_price_kop: number; line_total_kop: number; order_line_components: {name: string; volume: string | null; qty_per_kit: number; sort: number}[]}[];
  payment_attempts: {id: string; status: string; provider_order_id: string | null; amount_kop: number; created_at: string; failure_reason: string | null}[];
  order_timeline: {id: number; event: string; at: string}[];
};

export function AdminOrder() {
  const {id = ''} = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const o = useQuery({
    queryKey: ['admin-order', id],
    queryFn: async () => {
      const {data, error} = await admin()
        .from('orders')
        .select(
          'id,number,first_name,last_name,phone,email,comment,delivery_method,np_settlement_name,np_area,np_warehouse_name,np_warehouse_number,subtotal_kop,discount_kop,total_kop,payment_status,payment_method,prepay_kop,prepay_received_at,prepay_note,paid_at,fulfillment_status,needs_review,review_reasons,ttn,owner_note,created_at,' +
            'order_lines(id,line_no,kind,name,volume,qty,unit_base_kop,unit_price_kop,line_total_kop,order_line_components(name,volume,qty_per_kit,sort)),' +
            'payment_attempts!payment_attempts_order_id_fkey(id,status,provider_order_id,amount_kop,created_at,failure_reason),order_timeline(id,event,at)',
        )
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as unknown as Detail;
    },
  });
  const [status, setStatus] = useState<string>('');
  const [ttn, setTtn] = useState('');
  const [note, setNote] = useState('');
  const [prepayNote, setPrepayNote] = useState('');
  useEffect(() => {
    if (o.data) {
      setStatus(o.data.fulfillment_status);
      setTtn(o.data.ttn ?? '');
    }
  }, [o.data]);
  const refresh = () => {
    void qc.invalidateQueries({queryKey: ['admin-order', id]});
    void qc.invalidateQueries({queryKey: ['admin-orders']});
  };
  const save = useMutation({
    mutationFn: async () => {
      const {error} = await admin().rpc('admin_update_order', {p_order: id, p_fulfillment: status, p_ttn: ttn || null, p_note: null});
      if (error) throw error;
    },
    onSuccess: refresh,
  });
  const resolve = useMutation({
    mutationFn: async () => {
      const {error} = await admin().rpc('admin_resolve_review', {p_order: id, p_note: note});
      if (error) throw error;
    },
    onSuccess: () => {
      setNote('');
      refresh();
    },
  });
  const prepay = useMutation({
    mutationFn: async () => {
      const {error} = await admin().rpc('admin_mark_prepay', {p_order: id, p_note: prepayNote || null});
      if (error) throw error;
    },
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async () => {
      const {error} = await admin().rpc('admin_delete_order', {p_order: id});
      if (error) throw error;
    },
    onSuccess: () => {
      setConfirmDelete(false);
      qc.removeQueries({queryKey: ['admin-order', id]});
      void qc.invalidateQueries({queryKey: ['admin-orders']});
      void navigate('/admin');
    },
    onError: () => setConfirmDelete(false),
  });
  if (o.isPending) return <Loading />;
  if (o.isError) return <ErrorState error={o.error} onRetry={() => o.refetch()} />;
  const d = o.data;
  const viber = `viber://chat?number=${encodeURIComponent(d.phone)}`;
  const p = PAYMENT_LABEL[d.payment_status] ?? {label: d.payment_status, variant: 'neutral' as const};
  const lines = [...d.order_lines].sort((a, b) => a.line_no - b.line_no);

  return (
    <VStack gap={5}>
      <HStack gap={3} vAlign="center" wrap="wrap">
        <Button label="← Усі замовлення" variant="ghost" size="sm" href="/admin" />
        <Heading level={1}>Замовлення №{d.number}</Heading>
      </HStack>
      {d.needs_review && (
        <Banner
          status="warning"
          title="Потребує перевірки перед відправленням"
          description={d.review_reasons.map(r => REVIEW_LABEL[r] ?? r).join('; ')}
          collapsible={false}
        />
      )}
      <Grid columns={{minWidth: 320, repeat: 'fit'}} gap={5}>
        <Card padding={5}>
          <MetadataList title="Статуси">
            <MetadataListItem label="Спосіб оплати">{d.payment_method === 'prepay_manual' ? `Передоплата ${formatUah(d.prepay_kop)} + накладений платіж` : 'Повна оплата онлайн (monobank)'}</MetadataListItem>
            {d.payment_method === 'full_online' ? (
              <MetadataListItem label="Онлайн-оплата (лише від monobank)">
                <Badge variant={p.variant} label={p.label} />
              </MetadataListItem>
            ) : (
              <>
                <MetadataListItem label="Передоплата">
                  <PaymentBadge o={d} />
                </MetadataListItem>
                <MetadataListItem label="Накладений платіж на НП">{formatUah(d.total_kop - d.prepay_kop)}</MetadataListItem>
              </>
            )}
            {d.paid_at && <MetadataListItem label="Оплачено">{kyivDateTime(d.paid_at)}</MetadataListItem>}
            <MetadataListItem label="Обробка">{FULFILLMENT_LABEL[d.fulfillment_status]}</MetadataListItem>
            <MetadataListItem label="Створено">{kyivDateTime(d.created_at)}</MetadataListItem>
          </MetadataList>
        </Card>
        <Card padding={5}>
          <MetadataList title="Покупець і доставка">
            <MetadataListItem label="Отримувач">{`${d.first_name} ${d.last_name}`}</MetadataListItem>
            <MetadataListItem label="Телефон">
              <HStack gap={2} wrap="wrap">
                <Link href={`tel:${d.phone}`} label={d.phone}>{d.phone}</Link>
                <Link href={viber} label="Написати у Viber">Viber</Link>
              </HStack>
            </MetadataListItem>
            {d.email && <MetadataListItem label="Email">{d.email}</MetadataListItem>}
            <MetadataListItem label={d.delivery_method === 'np_postomat' ? 'Поштомат' : 'Відділення'}>{`${d.np_warehouse_name}`}</MetadataListItem>
            <MetadataListItem label="Населений пункт">{`${d.np_settlement_name}${d.np_area ? `, ${d.np_area} обл.` : ''}`}</MetadataListItem>
            {d.comment && <MetadataListItem label="Коментар">{d.comment}</MetadataListItem>}
          </MetadataList>
        </Card>
      </Grid>

      {d.payment_method === 'prepay_manual' && !d.prepay_received_at && d.fulfillment_status !== 'cancelled' && (
        <Card padding={5}>
          <VStack gap={3}>
            <Heading level={2}>Передоплата {formatUah(d.prepay_kop)}</Heading>
            <Text type="body">
              Напишіть покупцю у Viber і надішліть реквізити. Коли гроші надійдуть — позначте тут. При відправленні оформіть ТТН з накладеним платежем {formatUah(d.total_kop - d.prepay_kop)}.
            </Text>
            <HStack gap={2} wrap="wrap">
              <Button label="Написати у Viber" href={viber} />
            </HStack>
            <TextInput label="Примітка (необовʼязково)" value={prepayNote} onChange={setPrepayNote} placeholder="напр. переказ на картку 16.11" isOptional />
            {prepay.isError && <Banner status="error" title={errText(prepay.error)} collapsible={false} />}
            <Button label="Передоплату отримано" variant="primary" isLoading={prepay.isPending} onClick={() => prepay.mutate()} />
          </VStack>
        </Card>
      )}
      <Card padding={5}>
        <VStack gap={3}>
          <Heading level={2}>Комплектація</Heading>
          {lines.map(l => (
            <VStack key={l.id} gap={1}>
              <HStack hAlign="between" gap={3}>
                <Text type="body" weight="semibold">
                  {l.kind === 'kit' ? 'Набір: ' : ''}
                  {l.name}
                  {l.volume ? `, ${l.volume}` : ''} × {l.qty}
                </Text>
                <Text type="body">
                  {formatUah(l.unit_price_kop)} × {l.qty} = {formatUah(l.line_total_kop)}
                </Text>
              </HStack>
              {l.kind === 'kit' && (
                <VStack gap={0.5} as="ul" aria-label={`Склад набору ${l.name}`}>
                  {[...l.order_line_components].sort((a, b) => a.sort - b.sort).map(c => (
                    <Text key={c.name} as="p" type="body" color="secondary">
                      • {c.name}
                      {c.volume ? `, ${c.volume}` : ''} — {c.qty_per_kit * l.qty} шт. ({c.qty_per_kit} × {l.qty})
                    </Text>
                  ))}
                  <Text type="supporting" color="secondary">
                    Окремо {formatUah(l.unit_base_kop)}, ціна набору {formatUah(l.unit_price_kop)}
                  </Text>
                </VStack>
              )}
            </VStack>
          ))}
          <Divider />
          {d.discount_kop > 0 && <Text type="body">Знижка на наборах: −{formatUah(d.discount_kop)}</Text>}
          <Text type="large" weight="bold">
            Разом: {formatUah(d.total_kop)}
          </Text>
        </VStack>
      </Card>

      <Card padding={5}>
        <VStack gap={3}>
          <Heading level={2}>Обробка замовлення</Heading>
          <Grid columns={{minWidth: 220}} gap={3}>
            <Selector label="Статус обробки" value={status} onChange={setStatus} options={Object.entries(FULFILLMENT_LABEL).map(([value, label]) => ({value, label}))} />
            <TextInput label="ТТН Нової пошти" value={ttn} onChange={setTtn} placeholder="20450000000000" isOptional />
          </Grid>
          {save.isError && <Banner status="error" title={errText(save.error)} collapsible={false} />}
          {save.isSuccess && <Banner status="success" title="Збережено" collapsible={false} />}
          <HStack gap={2}>
            <Button label="Зберегти" variant="primary" isLoading={save.isPending} onClick={() => save.mutate()} />
          </HStack>
          <Text type="supporting" color="secondary">
            Статус онлайн-оплати тут змінити не можна: його встановлює лише підтверджене повідомлення від monobank. Передоплату за реквізитами ви позначаєте самі.
          </Text>
          {d.needs_review && (
            <VStack gap={2}>
              <TextArea label="Як вирішено (обовʼязково)" value={note} onChange={setNote} rows={2} />
              {resolve.isError && <Banner status="error" title={errText(resolve.error)} collapsible={false} />}
              <Button label="Позначити перевіреним" onClick={() => resolve.mutate()} isLoading={resolve.isPending} />
            </VStack>
          )}
        </VStack>
      </Card>

      <Grid columns={{minWidth: 320, repeat: 'fit'}} gap={5}>
        <Card padding={5}>
          <VStack gap={2}>
            <Heading level={3}>Спроби оплати</Heading>
            {d.payment_attempts.length === 0 && <Text type="body" color="secondary">Ще не було</Text>}
            {[...d.payment_attempts].sort((a, b) => a.created_at.localeCompare(b.created_at)).map(a => (
              <Text key={a.id} type="supporting">
                {kyivDateTime(a.created_at)} · {a.status} · {formatUah(a.amount_kop)}
                {a.provider_order_id ? ` · ${a.provider_order_id}` : ''}
                {a.failure_reason ? ` · ${a.failure_reason}` : ''}
              </Text>
            ))}
          </VStack>
        </Card>
        <Card padding={5}>
          <VStack gap={2}>
            <Heading level={3}>Історія</Heading>
            {[...d.order_timeline].sort((a, b) => a.at.localeCompare(b.at)).map(t => (
              <Text key={t.id} type="supporting">
                {kyivDateTime(t.at)} · {t.event}
              </Text>
            ))}
          </VStack>
        </Card>
      </Grid>

      <Card padding={5}>
        <VStack gap={3}>
          <Heading level={3}>Видалення</Heading>
          <Text type="body" color="secondary">
            {d.payment_status === 'paid'
              ? 'Оплачене замовлення видалити не можна: спершу поверніть оплату в кабінеті web.monobank.ua.'
              : 'Замовлення зникне назавжди разом зі складом та історією. Неоплачений рахунок monobank буде анульовано.'}
          </Text>
          {remove.isError && <Banner status="error" title={errText(remove.error)} collapsible={false} />}
          <HStack gap={2}>
            <Button label="Видалити замовлення" variant="destructive" isDisabled={d.payment_status === 'paid'} onClick={() => setConfirmDelete(true)} />
          </HStack>
        </VStack>
      </Card>
      <AlertDialog
        isOpen={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Видалити замовлення №${d.number}?`}
        description={`${d.first_name} ${d.last_name}, ${formatUah(d.total_kop)}. Цю дію не можна скасувати.`}
        actionLabel="Видалити"
        cancelLabel="Скасувати"
        isActionLoading={remove.isPending}
        onAction={() => remove.mutate()}
      />
    </VStack>
  );
}
