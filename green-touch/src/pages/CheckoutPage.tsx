import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {CheckboxInput} from '@astryxdesign/core/CheckboxInput';
import {Grid} from '@astryxdesign/core/Grid';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {Link} from '@astryxdesign/core/Link';
import {Heading, Text} from '@astryxdesign/core/Text';
import {TextArea} from '@astryxdesign/core/TextArea';
import {TextInput} from '@astryxdesign/core/TextInput';
import {useEffect, useRef, useState} from 'react';
import {useNavigate} from 'react-router';
import {customerSchema, type CustomerInput} from '../../supabase/functions/_shared/contracts.ts';
import {NpPicker, type NpValue} from '../components/NpPicker.tsx';
import {Page} from '../components/ShopLayout.tsx';
import {Loading} from '../components/Status.tsx';
import {PageTitle} from '../components/ui.tsx';
import {ApiError, submitCheckout} from '../lib/api.ts';
import {dropDraft, loadDraft, rememberOrder, saveDraft, useMeta, useOnline} from '../lib/browser.ts';
import {cartPayload, dispatchCart, useCart} from '../lib/cart.ts';
import {formatUah} from '../lib/format.ts';
import {goToLiqPay} from '../lib/liqpay.ts';
import {Totals, priceChanges, useQuote} from './CartPage.tsx';

const DRAFT = 'gt-checkout-v1';
type Draft = {customer: CustomerInput; np: NpValue; consent: boolean; key?: {value: string; fingerprint: string}};
type Errors = Partial<Record<'first_name' | 'last_name' | 'phone' | 'email' | 'comment' | 'method' | 'settlement' | 'warehouse' | 'consent', string>>;

const emptyDraft: Draft = {customer: {first_name: '', last_name: '', phone: '', email: '', comment: ''}, np: {method: null, settlement: null, warehouse: null}, consent: false};

function newKey(): string {
  const b = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function validate(d: Draft): Errors {
  const e: Errors = {};
  const c = customerSchema.safeParse(d.customer);
  if (!c.success) for (const i of c.error.issues) e[i.path[0] as keyof Errors] ??= i.message;
  if (!d.np.method) e.method = 'Оберіть спосіб доставки';
  if (!d.np.settlement) e.settlement = 'Оберіть населений пункт зі списку';
  if (!d.np.warehouse) e.warehouse = d.np.method === 'np_postomat' ? 'Оберіть поштомат зі списку' : 'Оберіть відділення зі списку';
  if (!d.consent) e.consent = 'Потрібна ваша згода';
  return e;
}

export default function CheckoutPage() {
  useMeta({title: 'Оформлення замовлення', path: '/oformlennia', noindex: true});
  const cart = useCart();
  const online = useOnline();
  const quote = useQuote();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(() => ({...emptyDraft, ...(loadDraft<Draft>(DRAFT) ?? {})}));
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errorRef = useRef<HTMLElement>(null);

  // The draft survives reloads and app updates; it is removed after a successful order.
  useEffect(() => saveDraft(DRAFT, draft), [draft]);

  if (cart.lines.length === 0) {
    navigate('/koshyk', {replace: true});
    return null;
  }
  if (quote.isPending && online) return <Loading />;

  const set = (patch: Partial<Draft['customer']>) => {
    setDraft(d => ({...d, customer: {...d.customer, ...patch}}));
    setErrors(e => ({...e, ...Object.fromEntries(Object.keys(patch).map(k => [k, undefined]))}));
  };
  const changes = priceChanges(cart.lines, quote.data);

  async function submit() {
    setFormError(null);
    if (!online) {
      setFormError('Немає зʼєднання. Замовлення можна оформити лише онлайн.');
      return;
    }
    const e = validate(draft);
    setErrors(e);
    if (Object.keys(e).length) {
      setFormError('Перевірте позначені поля.');
      return;
    }
    const lines = cartPayload(cart);
    const body = {
      lines,
      customer: draft.customer,
      delivery: {method: draft.np.method!, settlement_ref: draft.np.settlement!.settlement_ref, city_ref: draft.np.settlement!.city_ref, warehouse_ref: draft.np.warehouse!.ref},
      consent: true as const,
    };
    // Same content → same idempotency key (a retry never creates a second order).
    const fingerprint = JSON.stringify(body);
    const key = draft.key?.fingerprint === fingerprint ? draft.key.value : newKey();
    if (draft.key?.value !== key) setDraft(d => ({...d, key: {value: key, fingerprint}}));
    setBusy(true);
    try {
      const r = await submitCheckout({...body, idempotency_key: key, ...(quote.data ? {expected_total_kop: quote.data.total_kop} : {})});
      rememberOrder(r.order_id, r.token);
      dispatchCart({type: 'clear'});
      dropDraft(DRAFT);
      if (r.payment.state === 'redirect') {
        goToLiqPay(r.payment.checkout);
        return;
      }
      navigate(`/zamovlennia/${r.order_id}`);
    } catch (err) {
      const a = err instanceof ApiError ? err : null;
      if (a?.code === 'BAD_REQUEST') {
        const fields = (a.details as {fields?: {path: string; message: string}[]} | null)?.fields ?? [];
        const map: Errors = {};
        for (const f of fields) {
          const k = f.path.replace(/^customer\./, '').replace(/^delivery\.(settlement_ref|city_ref)$/, 'settlement').replace(/^delivery\.warehouse_ref$/, 'warehouse').replace(/^delivery\.method$/, 'method');
          map[k as keyof Errors] ??= f.message;
        }
        setErrors(map);
      }
      if (a?.code === 'NP_POINT_INVALID') setErrors(x => ({...x, warehouse: a.message}));
      if (a?.code === 'PRICE_CHANGED' || a?.code === 'ITEM_UNAVAILABLE') void quote.refetch();
      setFormError(a?.message ?? 'Не вдалося оформити замовлення. Дані форми збережено — спробуйте ще раз.');
      errorRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  const st = (k: keyof Errors) => (errors[k] ? {type: 'error' as const, message: errors[k]!} : undefined);

  return (
    <Page width={1100}>
      <PageTitle title="Оформлення замовлення" subtitle="Без реєстрації. Обовʼязкові поля позначено." />
      <Grid columns={{minWidth: 320, repeat: 'fit'}} gap={8}>
        <VStack gap={6} as="form" aria-label="Дані замовлення" onSubmit={(e: React.FormEvent) => (e.preventDefault(), void submit())}>
          <VStack gap={4}>
            <Heading level={2}>Отримувач</Heading>
            <Grid columns={{minWidth: 200}} gap={3}>
              <TextInput label="Імʼя" value={draft.customer.first_name ?? ''} onChange={v => set({first_name: v})} status={st('first_name')} isRequired autoComplete="given-name" />
              <TextInput label="Прізвище" value={draft.customer.last_name ?? ''} onChange={v => set({last_name: v})} status={st('last_name')} isRequired autoComplete="family-name" />
            </Grid>
            <TextInput label="Телефон" value={draft.customer.phone ?? ''} onChange={v => set({phone: v})} status={st('phone')} placeholder="+380 67 123 45 67" isRequired autoComplete="tel" />
            <TextInput label="Email" type="email" value={draft.customer.email ?? ''} onChange={v => set({email: v})} status={st('email')} isOptional autoComplete="email" />
          </VStack>
          <VStack gap={4}>
            <Heading level={2}>Доставка</Heading>
            <NpPicker
              value={draft.np}
              onChange={np => {
                setDraft(d => ({...d, np}));
                setErrors(e => ({...e, method: undefined, settlement: undefined, warehouse: undefined}));
              }}
              errors={{method: errors.method, settlement: errors.settlement, warehouse: errors.warehouse}}
            />
          </VStack>
          <TextArea label="Коментар до замовлення" value={draft.customer.comment ?? ''} onChange={v => set({comment: v})} status={st('comment')} isOptional rows={3} maxLength={1000} />
          <CheckboxInput
            label="Погоджуюся з умовами покупки та обробкою персональних даних"
            description="Умови покупки та повернення й політика конфіденційності — посилання нижче."
            value={draft.consent}
            onChange={v => {
              setDraft(d => ({...d, consent: v}));
              setErrors(e => ({...e, consent: undefined}));
            }}
            status={st('consent')}
            isRequired
          />
          <HStack gap={4} wrap="wrap">
            <Link href="/umovy-pokupky" label="Умови покупки та повернення">Умови покупки та повернення</Link>
            <Link href="/polityka-konfidentsiinosti" label="Політика конфіденційності">Політика конфіденційності</Link>
          </HStack>
        </VStack>
        <VStack gap={4}>
          <Card padding={5}>
            <VStack gap={4}>
              <Heading level={2}>Ваше замовлення</Heading>
              <VStack gap={2} as="ul" aria-label="Склад замовлення">
                {cart.lines.map(l => {
                  const q = quote.data?.lines.find(x => x.id === l.id);
                  return (
                    <HStack key={l.id} as="li" gap={3} hAlign="between">
                      <VStack gap={0}>
                        <Text type="body">
                          {l.name} × {l.qty}
                        </Text>
                        {q?.components?.length ? (
                          <Text type="supporting" color="secondary">
                            {q.components.map(c => `${c.name}${c.qty > 1 ? ` ×${c.qty}` : ''}`).join(', ')}
                          </Text>
                        ) : null}
                      </VStack>
                      <Text type="body">{formatUah((q?.unit_price_kop ?? l.price_kop) * l.qty)}</Text>
                    </HStack>
                  );
                })}
              </VStack>
              <Totals quote={quote.data} fallbackTotal={cart.lines.reduce((s, l) => s + l.price_kop * l.qty, 0)} />
            </VStack>
          </Card>
          {!online && <Banner status="warning" title="Ви офлайн" description="Оформлення й оплата недоступні без мережі. Ваші дані збережено в цьому браузері." collapsible={false} />}
          {changes.length > 0 && <Banner status="warning" title="Ціни змінилися — перевірте суму" description={changes.join('; ')} collapsible={false} />}
          {quote.data && !quote.data.ok && <Banner status="error" title="Деякі товари зараз недоступні. Поверніться до кошика." collapsible={false} endContent={<Button label="До кошика" size="sm" href="/koshyk" />} />}
          <section ref={errorRef} tabIndex={-1} aria-live="assertive">
            {formError && <Banner status="error" title={formError} collapsible={false} />}
          </section>
          <Button
            label={quote.data ? `Підтвердити й оплатити ${formatUah(quote.data.total_kop)}` : 'Підтвердити й оплатити'}
            variant="primary"
            size="lg"
            width="100%"
            isLoading={busy}
            isDisabled={!online || !quote.data?.ok}
            onClick={() => void submit()}
          />
          <Text type="supporting" color="secondary">
            Після підтвердження відкриється сторінка оплати LiqPay. Замовлення вважається оплаченим лише після підтвердження від LiqPay; виготовлення починається після оплати.
          </Text>
        </VStack>
      </Grid>
    </Page>
  );
}
