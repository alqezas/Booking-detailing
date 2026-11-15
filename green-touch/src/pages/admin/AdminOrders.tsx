import {Badge} from '@astryxdesign/core/Badge';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Divider} from '@astryxdesign/core/Divider';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Grid} from '@astryxdesign/core/Grid';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {Link} from '@astryxdesign/core/Link';
import {MetadataList, MetadataListItem} from '@astryxdesign/core/MetadataList';
import {Selector} from '@astryxdesign/core/Selector';
import {Table} from '@astryxdesign/core/Table';
import {Heading, Text} from '@astryxdesign/core/Text';
import {TextArea} from '@astryxdesign/core/TextArea';
import {TextInput} from '@astryxdesign/core/TextInput';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useEffect, useState} from 'react';
import {useParams} from 'react-router';
import {ErrorState, Loading} from '../../components/Status.tsx';
import {FULFILLMENT_LABEL, PAYMENT_LABEL, REVIEW_LABEL, formatUah, kyivDateTime} from '../../lib/format.ts';
import {admin} from '../../lib/supabase.ts';

type OrderRow = {
  id: string;
  number: number;
  first_name: string;
  last_name: string;
  phone: string;
  total_kop: number;
  payment_status: string;
  fulfillment_status: string;
  needs_review: boolean;
  created_at: string;
  [k: string]: unknown;
};

const ERR: Record<string, string> = {
  NOT_READY_TO_SHIP: 'Спершу потрібне підтвердження оплати від LiqPay і відсутність позначки «потребує перевірки».',
  TTN_REQUIRED: 'Для статусу «Відправлено» вкажіть ТТН.',
  NOTE_REQUIRED: 'Опишіть, як вирішено питання.',
  FORBIDDEN: 'Немає прав.',
};
const errText = (e: unknown) => {
  const m = (e as {message?: string})?.message ?? '';
  return ERR[m] ?? (m.includes('ttn') ? 'ТТН — це 10–20 цифр.' : 'Не вдалося зберегти.');
};

export function AdminOrders() {
  const [q, setQ] = useState('');
  const [pay, setPay] = useState<string | null>(null);
  const [ful, setFul] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setSearch(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);
  const list = useQuery({
    queryKey: ['admin-orders', search, pay, ful],
    queryFn: async () => {
      let r = admin().from('orders').select('id,number,first_name,last_name,phone,total_kop,payment_status,fulfillment_status,needs_review,created_at').order('created_at', {ascending: false}).limit(100);
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
  return (
    <VStack gap={4}>
      <Heading level={1}>Замовлення</Heading>
      <Grid columns={{minWidth: 200}} gap={3}>
        <TextInput label="Пошук" value={q} onChange={setQ} placeholder="Номер, телефон або прізвище" hasClear />
        <Selector label="Оплата" hasClear value={pay} onChange={setPay} options={Object.entries(PAYMENT_LABEL).map(([value, v]) => ({value, label: v.label}))} placeholder="Усі" />
        <Selector label="Обробка" hasClear value={ful} onChange={setFul} options={Object.entries(FULFILLMENT_LABEL).map(([value, label]) => ({value, label}))} placeholder="Усі" />
      </Grid>
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
            {key: 'number', header: '№', renderCell: o => <Link href={`/admin/zamovlennia/${o.id}`} label={`№${o.number}`}>{`№${o.number}`}</Link>},
            {key: 'created_at', header: 'Дата (Київ)', renderCell: o => kyivDateTime(o.created_at)},
            {key: 'name', header: 'Покупець', renderCell: o => `${o.first_name} ${o.last_name}, ${o.phone}`},
            {key: 'total_kop', header: 'Сума', align: 'end', renderCell: o => formatUah(o.total_kop)},
            {key: 'payment_status', header: 'Оплата', renderCell: o => <Badge variant={PAYMENT_LABEL[o.payment_status]?.variant ?? 'neutral'} label={PAYMENT_LABEL[o.payment_status]?.label ?? o.payment_status} />},
            {
              key: 'fulfillment_status',
              header: 'Обробка',
              renderCell: o => (
                <HStack gap={1} wrap="wrap">
                  <Text type="body">{FULFILLMENT_LABEL[o.fulfillment_status]}</Text>
                  {o.needs_review && <Badge variant="warning" label="Перевірити" />}
                </HStack>
              ),
            },
          ]}
        />
      )}
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
  order_lines: {id: string; line_no: number; kind: string; name: string; volume: string | null; qty: number; unit_base_kop: number; unit_price_kop: number; line_total_kop: number; order_line_components: {name: string; volume: string | null; qty_per_kit: number; sort: number}[]}[];
  payment_attempts: {id: string; status: string; provider_order_id: string | null; amount_kop: number; created_at: string; failure_reason: string | null}[];
  order_timeline: {id: number; event: string; at: string}[];
};

export function AdminOrder() {
  const {id = ''} = useParams();
  const qc = useQueryClient();
  const o = useQuery({
    queryKey: ['admin-order', id],
    queryFn: async () => {
      const {data, error} = await admin()
        .from('orders')
        .select(
          'id,number,first_name,last_name,phone,email,comment,delivery_method,np_settlement_name,np_area,np_warehouse_name,np_warehouse_number,subtotal_kop,discount_kop,total_kop,payment_status,paid_at,fulfillment_status,needs_review,review_reasons,ttn,owner_note,created_at,' +
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
  if (o.isPending) return <Loading />;
  if (o.isError) return <ErrorState error={o.error} onRetry={() => o.refetch()} />;
  const d = o.data;
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
            <MetadataListItem label="Оплата (лише від LiqPay)">
              <Badge variant={p.variant} label={p.label} />
            </MetadataListItem>
            {d.paid_at && <MetadataListItem label="Оплачено">{kyivDateTime(d.paid_at)}</MetadataListItem>}
            <MetadataListItem label="Обробка">{FULFILLMENT_LABEL[d.fulfillment_status]}</MetadataListItem>
            <MetadataListItem label="Створено">{kyivDateTime(d.created_at)}</MetadataListItem>
          </MetadataList>
        </Card>
        <Card padding={5}>
          <MetadataList title="Покупець і доставка">
            <MetadataListItem label="Отримувач">{`${d.first_name} ${d.last_name}`}</MetadataListItem>
            <MetadataListItem label="Телефон">
              <Link href={`tel:${d.phone}`} label={d.phone}>{d.phone}</Link>
            </MetadataListItem>
            {d.email && <MetadataListItem label="Email">{d.email}</MetadataListItem>}
            <MetadataListItem label={d.delivery_method === 'np_postomat' ? 'Поштомат' : 'Відділення'}>{`${d.np_warehouse_name}`}</MetadataListItem>
            <MetadataListItem label="Населений пункт">{`${d.np_settlement_name}${d.np_area ? `, ${d.np_area} обл.` : ''}`}</MetadataListItem>
            {d.comment && <MetadataListItem label="Коментар">{d.comment}</MetadataListItem>}
          </MetadataList>
        </Card>
      </Grid>

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
            Статус оплати тут змінити не можна: його встановлює лише підтверджене повідомлення від LiqPay.
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
    </VStack>
  );
}
