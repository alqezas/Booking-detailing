import {Badge} from '@astryxdesign/core/Badge';
import {Banner} from '@astryxdesign/core/Banner';
import {BottomSheet} from '@astryxdesign/core/BottomSheet';
import {Button} from '@astryxdesign/core/Button';
import {DateInput} from '@astryxdesign/core/DateInput';
import {FormLayout} from '@astryxdesign/core/FormLayout';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {Icon} from '@astryxdesign/core/Icon';
import {List, ListItem} from '@astryxdesign/core/List';
import {NumberInput} from '@astryxdesign/core/NumberInput';
import {Section} from '@astryxdesign/core/Section';
import {Selector} from '@astryxdesign/core/Selector';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {VStack} from '@astryxdesign/core/VStack';
import {useToast} from '@astryxdesign/core/Toast';
import {Plus} from '@phosphor-icons/react';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useState} from 'react';
import {useTenant} from '../../app/tenant.tsx';
import {InlineEmpty, InlineError, RowsSkeleton} from '../../components/StatusScreens.tsx';
import {plateError} from '../../components/tire/TireDetails.tsx';
import {washServices} from '../../components/wash/WashCalculator.tsx';
import {msg} from '../../i18n/index.ts';
import {tireMsg} from '../../i18n/tire.ts';
import {washMsg} from '../../i18n/wash.ts';
import {errorText} from '../../lib/errors.ts';
import {formatDate, formatMoney, formatPhone, todayIn} from '../../lib/format.ts';
import {customerSchema, fieldErrors} from '../../lib/schemas.ts';
import type {WashPass} from '../../lib/types.ts';
import {normalizePlate} from '../../../supabase/functions/_shared/tire.ts';
import {ownerKey, useOwner} from './ownerContext.tsx';

type ISODate = `${number}${number}${number}${number}-${number}${number}-${number}${number}`;
const shortDate = (iso: string) => formatDate(iso.slice(0, 10), {day: 'numeric', month: 'numeric', year: 'numeric'});

/**
 * Wash passes: «N washes» sold to a phone + plate. The cabinet only records
 * them; a wash is taken by the database when a matching booking is marked
 * ready, and given back if that is undone. Payment is taken as usual.
 */
export default function OwnerPassesPage() {
  const tenant = useTenant();
  const {api, slug} = useOwner();
  const W = washMsg().passes;
  const [editing, setEditing] = useState<WashPass | 'new' | null>(null);
  const q = useQuery({queryKey: ownerKey(slug, 'wash-passes'), queryFn: () => api.washPasses()});
  const today = todayIn(tenant.timezone);

  return (
    <VStack>
      <Section variant="transparent" padding={4} paddingInline={0}>
        <VStack gap={4}>
          <HStack justify="between" align="center" gap={2}>
            <VStack gap={1}>
              <Heading level={1}>{W.title}</Heading>
              <Text color="secondary">{W.lead}</Text>
            </VStack>
            <Button label={W.add} variant="primary" icon={<Icon icon={Plus} />} onClick={() => setEditing('new')} />
          </HStack>
          <Banner status="info" title={W.paymentNote} collapsible={false} />
        </VStack>
      </Section>
      <Section variant="transparent" padding={4} paddingInline={0} paddingBlockStart={0}>
        {q.isPending ? (
          <RowsSkeleton rows={4} height={64} />
        ) : q.isError ? (
          <InlineError message={q.error.message} onRetry={() => void q.refetch()} />
        ) : q.data.length === 0 ? (
          <InlineEmpty title={W.empty} />
        ) : (
          <List hasDividers>
            {q.data.map(p => {
              const expired = !!p.expires_at && p.expires_at < today;
              const left = p.remaining ?? p.total;
              return (
                <ListItem
                  key={p.id}
                  label={`${p.plate} · ${p.customer_name}`}
                  description={[p.service_name ?? washMsg().passes.anyProgram, p.expires_at ? W.until(shortDate(p.expires_at)) : '', p.price != null ? formatMoney(p.price, tenant.currency) : '']
                    .filter(Boolean)
                    .join(' · ')}
                  endContent={
                    <Badge label={expired ? W.expired : left > 0 ? W.left(left, p.total) : W.used} variant={expired || left === 0 ? 'neutral' : 'success'} />
                  }
                  onClick={() => setEditing(p)}
                />
              );
            })}
          </List>
        )}
      </Section>
      <PassSheet pass={editing} onClose={() => setEditing(null)} />
    </VStack>
  );
}

type Form = {customer_name: string; customer_phone: string; plate: string; service_id: string; total: number | null; price: number | null; sold_at: string; expires_at: string; note: string};

function PassSheet({pass, onClose}: {pass: WashPass | 'new' | null; onClose: () => void}) {
  const tenant = useTenant();
  const {api, slug} = useOwner();
  const qc = useQueryClient();
  const showToast = useToast();
  const W = washMsg().passes;
  const existing = pass && pass !== 'new' ? pass : null;
  const today = todayIn(tenant.timezone);
  const toForm = (p: WashPass | null): Form => ({
    customer_name: p?.customer_name ?? '',
    customer_phone: p ? formatPhone(p.customer_phone) : '',
    plate: p?.plate ?? '',
    service_id: p?.service_id ?? '',
    total: p?.total ?? 10,
    price: p?.price ?? null,
    sold_at: p?.sold_at ?? today,
    expires_at: p?.expires_at ?? '',
    note: p?.note ?? '',
  });
  const [form, setForm] = useState<Form>(() => toForm(existing));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [openedFor, setOpenedFor] = useState<WashPass | 'new' | null>(null);
  if (pass !== openedFor) {
    setOpenedFor(pass);
    setForm(toForm(existing));
    setErrors({});
  }
  const f = <K extends keyof Form>(k: K) => (v: Form[K]) => setForm(x => ({...x, [k]: v}));

  const save = useMutation({
    mutationFn: async () => {
      const c = customerSchema.pick({name: true, phone: true}).safeParse({name: form.customer_name, phone: form.customer_phone});
      const pErr = plateError(form.plate);
      if (!c.success || pErr || !form.total) {
        setErrors({...(c.success ? {} : fieldErrors(c.error)), ...(pErr ? {plate: pErr} : {})});
        throw new Error('invalid');
      }
      setErrors({});
      return api.saveWashPass(existing?.id ?? null, {
        customer_name: c.data.name,
        customer_phone: c.data.phone,
        plate: normalizePlate(form.plate),
        service_id: form.service_id || null,
        total: form.total,
        price: form.price,
        sold_at: form.sold_at,
        expires_at: form.expires_at || null,
        note: form.note.trim(),
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({queryKey: ownerKey(slug, 'wash-passes')});
      showToast({body: W.saved});
      onClose();
    },
  });

  return (
    <BottomSheet isOpen={!!pass} onOpenChange={o => !o && onClose()} label={existing ? W.sheetEdit : W.sheetNew} height="tall" purpose="form">
      <VStack gap={4}>
        <Heading level={2}>{existing ? `${existing.plate} · ${existing.customer_name}` : W.sheetNew}</Heading>
        {existing && <Text color="secondary">{W.left(existing.remaining ?? existing.total, existing.total)}</Text>}
        <FormLayout>
          <TextInput label={W.customer} value={form.customer_name} onChange={f('customer_name')} status={errors.name ? {type: 'error', message: errors.name} : undefined} />
          <TextInput label={msg.flow.phone} value={form.customer_phone} onChange={f('customer_phone')} placeholder={msg.phonePlaceholder} status={errors.phone ? {type: 'error', message: errors.phone} : undefined} />
          <TextInput label={tireMsg().details.plate} value={form.plate} onChange={v => f('plate')(v.toUpperCase())} status={errors.plate ? {type: 'error', message: errors.plate} : undefined} />
          <Selector
            label={W.program}
            value={form.service_id || 'any'}
            onChange={v => f('service_id')(!v || v === 'any' ? '' : v)}
            options={[{value: 'any', label: W.anyProgram}, ...washServices(tenant).map(p => ({value: p.service.id, label: p.service.name}))]}
          />
          <NumberInput label={W.total} value={form.total} onChange={v => f('total')(v)} min={1} max={100} step={1} />
          <NumberInput label={W.price} isOptional value={form.price} onChange={v => f('price')(v)} min={0} step={100} hasClear />
          <DateInput label={W.soldAt} value={form.sold_at as ISODate} onChange={v => v && f('sold_at')(v)} />
          <DateInput label={W.expiresAt} isOptional value={(form.expires_at || undefined) as ISODate | undefined} onChange={v => f('expires_at')(v ?? '')} min={form.sold_at as ISODate} />
          <TextInput label={W.note} isOptional value={form.note} onChange={f('note')} />
        </FormLayout>
        {save.isError && (save.error as Error).message !== 'invalid' && <Banner status="error" title={errorText(save.error)} collapsible={false} />}
        <HStack gap={2}>
          <Button label={msg.common.close} variant="ghost" onClick={onClose} style={{flexShrink: 0}} />
          <Button label={W.save} variant="primary" width="100%" isLoading={save.isPending} onClick={() => save.mutate()} />
        </HStack>
      </VStack>
    </BottomSheet>
  );
}
