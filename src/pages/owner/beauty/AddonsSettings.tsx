import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {NumberInput} from '@astryxdesign/core/NumberInput';
import {Switch} from '@astryxdesign/core/Switch';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {VStack} from '@astryxdesign/core/VStack';
import {useToast} from '@astryxdesign/core/Toast';
import {useMutation, useQuery} from '@tanstack/react-query';
import {useMemo, useState} from 'react';
import {useTenant} from '../../../app/tenant.tsx';
import {InlineError, RowsSkeleton} from '../../../components/StatusScreens.tsx';
import {beautyMsg} from '../../../i18n/beauty.ts';
import {msg} from '../../../i18n/index.ts';
import {errorText} from '../../../lib/errors.ts';
import {currencySymbol} from '../../../lib/format.ts';
import {ownerKey, useOwner} from '../ownerContext.tsx';
import {useRefreshStudio} from '../settings/shared.tsx';

type AddonRow = {id: string; service_id: string; key: string; name: string; price: number; duration_minutes: number; is_active: boolean; sort: number};
type ServiceRow = {id: string; name: string; category: string; is_active: boolean};

/** Keys are Latin slugs; a new option gets one from its name or a counter. */
const slugKey = (name: string, taken: Set<string>) => {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'option';
  let k = base;
  for (let i = 2; taken.has(k); i++) k = `${base}-${i}`;
  return k;
};

/**
 * Options of every service: name, price, extra minutes, visible. Price and
 * time add up on the server at booking time; old bookings keep their prices.
 */
export function AddonsSettings() {
  const {api, slug} = useOwner();
  const B = beautyMsg().owner.addons;
  const services = useQuery({queryKey: ownerKey(slug, 'services'), queryFn: () => api.services() as Promise<ServiceRow[]>});
  const addons = useQuery({queryKey: ownerKey(slug, 'addons'), queryFn: () => api.addons() as Promise<AddonRow[]>});
  if (services.isPending || addons.isPending) return <RowsSkeleton rows={3} />;
  const err = services.error ?? addons.error;
  if (err) return <InlineError message={err.message} onRetry={() => void Promise.all([services.refetch(), addons.refetch()])} />;
  return (
    <VStack gap={4}>
      <VStack gap={1}>
        <Heading level={2}>{B.title}</Heading>
        <Text color="secondary">{B.lead}</Text>
      </VStack>
      {services.data!
        .filter(s => s.is_active)
        .map(s => (
          <Card key={s.id} padding={4}>
            <VStack gap={3}>
              <Heading level={3}>{s.name}</Heading>
              {addons.data!.filter(a => a.service_id === s.id).length === 0 && <Text color="secondary">{B.none}</Text>}
              {addons.data!
                .filter(a => a.service_id === s.id)
                .map(a => (
                  <AddonEditor key={a.id} serviceId={s.id} row={a} taken={new Set()} />
                ))}
              <AddonEditor serviceId={s.id} row={null} taken={new Set(addons.data!.filter(a => a.service_id === s.id).map(a => a.key))} />
            </VStack>
          </Card>
        ))}
    </VStack>
  );
}

function AddonEditor({serviceId, row, taken}: {serviceId: string; row: AddonRow | null; taken: Set<string>}) {
  const {api} = useOwner();
  const t = useTenant();
  const B = beautyMsg().owner.addons;
  const refresh = useRefreshStudio();
  const showToast = useToast();
  const [f, setF] = useState({name: row?.name ?? '', price: row?.price ?? 0, minutes: row?.duration_minutes ?? 0, active: row?.is_active ?? true});
  const [error, setError] = useState<string | null>(null);
  const valid = f.name.trim().length >= 2 && f.price >= 0 && f.minutes >= 0 && f.minutes <= 240;
  const save = useMutation({
    mutationFn: () =>
      api.upsertAddon(row?.id ?? null, {
        ...(row ? {} : {service_id: serviceId, key: slugKey(f.name, taken), sort: 100}),
        name: f.name.trim(),
        price: Math.round(f.price),
        duration_minutes: Math.round(f.minutes),
        is_active: f.active,
      }),
    onSuccess: () => {
      refresh();
      setError(null);
      if (!row) setF({name: '', price: 0, minutes: 0, active: true});
      showToast({body: B.saved});
    },
    onError: e => setError(errorText(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.removeAddon(row!.id),
    onSuccess: () => {
      refresh();
      showToast({body: B.removed});
    },
    onError: e => setError(errorText(e)),
  });
  const sym = useMemo(() => currencySymbol(t.currency), [t.currency]);
  return (
    <VStack gap={2} paddingBlockStart={row ? 0 : 2}>
      {error && <Banner status="error" title={error} collapsible={false} />}
      <HStack gap={2} wrap="wrap" align="end">
        <TextInput label={B.name} value={f.name} onChange={v => setF(x => ({...x, name: v}))} width={220} />
        <NumberInput label={B.price(sym)} value={f.price} onChange={v => setF(x => ({...x, price: v ?? 0}))} min={0} step={10} width={120} />
        <NumberInput label={B.minutes} value={f.minutes} onChange={v => setF(x => ({...x, minutes: v ?? 0}))} min={0} max={240} step={5} width={120} />
        {row && <Switch label={B.active} value={f.active} onChange={v => setF(x => ({...x, active: v}))} />}
      </HStack>
      <HStack gap={2}>
        <Button label={row ? msg.common.save : B.add} variant={row ? 'secondary' : 'primary'} size="sm" isDisabled={!valid} isLoading={save.isPending} onClick={() => save.mutate()} />
        {row && <Button label={B.remove} variant="ghost" size="sm" isLoading={remove.isPending} onClick={() => remove.mutate()} />}
      </HStack>
    </VStack>
  );
}

/** Category tabs of the price list: rename one for all of its services at once. */
export function CategoriesSettings() {
  const {api, slug} = useOwner();
  const B = beautyMsg().owner.categories;
  const refresh = useRefreshStudio();
  const showToast = useToast();
  const services = useQuery({queryKey: ownerKey(slug, 'services'), queryFn: () => api.services() as Promise<ServiceRow[]>});
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const rename = useMutation({
    mutationFn: ({from, to}: {from: string; to: string}) => api.renameCategory(from, to),
    onSuccess: (_d, v) => {
      setNames(n => ({...n, [v.from]: ''}));
      refresh();
      setError(null);
      showToast({body: B.renamed});
    },
    onError: e => setError(errorText(e)),
  });
  if (services.isPending) return <RowsSkeleton rows={2} />;
  if (services.isError) return <InlineError message={services.error.message} onRetry={() => void services.refetch()} />;
  const categories = [...new Set(services.data.map(s => s.category))];
  return (
    <Card padding={4}>
      <VStack gap={3}>
        <Heading level={2}>{B.title}</Heading>
        <Text color="secondary">{B.lead}</Text>
        {error && <Banner status="error" title={error} collapsible={false} />}
        {categories.map(c => {
          const next = (names[c] ?? '').trim();
          return (
            <HStack key={c} gap={2} align="end" wrap="wrap">
              <TextInput label={`${c} → ${B.newName}`} value={names[c] ?? ''} placeholder={c} onChange={v => setNames(n => ({...n, [c]: v}))} width={260} />
              <Button
                label={B.rename}
                size="sm"
                isDisabled={!next || next === c || next.length > 40}
                isLoading={rename.isPending && rename.variables?.from === c}
                onClick={() => rename.mutate({from: c, to: next})}
              />
            </HStack>
          );
        })}
      </VStack>
    </Card>
  );
}
