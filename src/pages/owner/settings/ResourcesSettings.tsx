import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {DateInput} from '@astryxdesign/core/DateInput';
import {FormLayout} from '@astryxdesign/core/FormLayout';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {List, ListItem} from '@astryxdesign/core/List';
import {Selector} from '@astryxdesign/core/Selector';
import {Switch} from '@astryxdesign/core/Switch';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {TimeInput, type ISOTimeString} from '@astryxdesign/core/TimeInput';
import {VStack} from '@astryxdesign/core/VStack';
import {useToast} from '@astryxdesign/core/Toast';
import {useMutation, useQuery} from '@tanstack/react-query';
import {fromZonedTime} from 'date-fns-tz';
import {useState} from 'react';
import {useTenant} from '../../../app/tenant.tsx';
import {InlineError, RowsSkeleton} from '../../../components/StatusScreens.tsx';
import {errorText} from '../../../lib/errors.ts';
import {formatWhen, todayIn} from '../../../lib/format.ts';
import {ownerKey, useOwner} from '../ownerContext.tsx';
import {useRefreshStudio} from './shared.tsx';

type ResourceRow = {id: string; name: string; is_active: boolean; sort: number};
type ISODate = `${number}${number}${number}${number}-${number}${number}-${number}${number}`;

export function ResourcesSettings() {
  const {api, slug} = useOwner();
  const q = useQuery({queryKey: ownerKey(slug, 'resources'), queryFn: () => api.resources() as Promise<ResourceRow[]>});
  if (q.isPending) return <RowsSkeleton rows={3} />;
  if (q.isError) return <InlineError message={q.error.message} onRetry={() => void q.refetch()} />;
  return (
    <VStack gap={6}>
      <Card padding={4}>
        <VStack gap={3}>
          <Heading level={2}>Боксы и посты</Heading>
          <Text color="secondary">Каждый бокс принимает одну машину. Услуга занимает подходящий бокс на всё время работы и подготовки.</Text>
          {q.data.map(r => (
            <ResourceRowEditor key={r.id} resource={r} />
          ))}
          <ResourceRowEditor resource={null} />
        </VStack>
      </Card>
      <BlockForm resources={q.data.filter(r => r.is_active)} />
    </VStack>
  );
}

function ResourceRowEditor({resource}: {resource: ResourceRow | null}) {
  const {api} = useOwner();
  const refresh = useRefreshStudio();
  const [name, setName] = useState(resource?.name ?? '');
  const [active, setActive] = useState(resource?.is_active ?? true);
  const save = useMutation({
    mutationFn: () =>
      api.upsertResource(resource?.id ?? null, {
        name: name.trim(),
        is_active: active,
        ...(resource ? {} : {key: `bay-${Date.now().toString(36)}`, sort: 100}),
      }),
    onSuccess: () => {
      refresh();
      if (!resource) setName('');
    },
  });
  const dirty = resource ? name.trim() !== resource.name || active !== resource.is_active : name.trim().length > 0;
  return (
    <VStack gap={1}>
      <HStack gap={2} align="end" wrap="wrap">
        <TextInput label={resource ? 'Название бокса' : 'Новый бокс'} value={name} onChange={setName} placeholder="Например: Бокс 3" width={240} />
        {resource && <Switch label="Работает" value={active} onChange={setActive} />}
        <Button label={resource ? 'Сохранить' : 'Добавить'} isDisabled={!dirty || name.trim().length < 1} isLoading={save.isPending} onClick={() => save.mutate()} />
      </HStack>
      {save.isError && (
        <Text color="accent" role="alert">
          {errorText(save.error)}
        </Text>
      )}
    </VStack>
  );
}

type Block = {id: string; resource_id: string; period: string; note: string | null};

/** Close a bay for maintenance: it uses the same occupancy table as bookings. */
function BlockForm({resources}: {resources: ResourceRow[]}) {
  const tenant = useTenant();
  const {api, slug} = useOwner();
  const refresh = useRefreshStudio();
  const showToast = useToast();
  const today = todayIn(tenant.timezone);
  const [resourceId, setResourceId] = useState(resources[0]?.id ?? '');
  const [day, setDay] = useState<ISODate | undefined>(today as ISODate);
  const [from, setFrom] = useState<ISOTimeString | undefined>('09:00' as ISOTimeString);
  const [toDay, setToDay] = useState<ISODate | undefined>(today as ISODate);
  const [to, setTo] = useState<ISOTimeString | undefined>('13:00' as ISOTimeString);
  const [note, setNote] = useState('');
  const range = {from: new Date().toISOString(), to: new Date(Date.now() + 60 * 86400e3).toISOString()};
  const blocks = useQuery({queryKey: ownerKey(slug, 'blocks'), queryFn: () => api.blocks(range.from, range.to) as Promise<Block[]>});
  const add = useMutation({
    mutationFn: () => {
      if (!day || !from || !toDay || !to) throw new Error('Укажите начало и конец');
      const start = fromZonedTime(`${day}T${from.slice(0, 5)}:00`, tenant.timezone).toISOString();
      const end = fromZonedTime(`${toDay}T${to.slice(0, 5)}:00`, tenant.timezone).toISOString();
      return api.blockResource(resourceId, start, end, note);
    },
    onSuccess: () => {
      refresh();
      void blocks.refetch();
      showToast({body: 'Бокс закрыт на это время'});
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.removeBlock(id),
    onSuccess: () => {
      refresh();
      void blocks.refetch();
    },
  });
  const nameOf = (id: string) => resources.find(r => r.id === id)?.name ?? 'Бокс';
  const bounds = (p: string) => p.replace(/[[\]()"]/g, '').split(',');

  return (
    <Card padding={4}>
      <VStack gap={4}>
        <Heading level={2}>Закрыть бокс на время</Heading>
        <FormLayout>
          <Selector label="Бокс" value={resourceId} onChange={v => v && setResourceId(v)} options={resources.map(r => ({value: r.id, label: r.name}))} />
          <HStack gap={2} wrap="wrap">
            <DateInput label="С даты" value={day} onChange={setDay} min={today as ISODate} />
            <TimeInput label="Время" value={from} onChange={setFrom} hourFormat="24h" />
          </HStack>
          <HStack gap={2} wrap="wrap">
            <DateInput label="По дату" value={toDay} onChange={setToDay} min={day ?? (today as ISODate)} />
            <TimeInput label="Время" value={to} onChange={setTo} hourFormat="24h" />
          </HStack>
          <TextInput label="Причина" isOptional value={note} onChange={setNote} placeholder="Ремонт подъёмника" />
        </FormLayout>
        {add.isError && <Banner status="error" title={errorText(add.error)} collapsible={false} />}
        <Button label="Закрыть бокс" isLoading={add.isPending} isDisabled={!resourceId} onClick={() => add.mutate()} />
        {blocks.data && blocks.data.length > 0 && (
          <List header={<Heading level={3}>Ближайшие закрытия</Heading>} hasDividers>
            {blocks.data.map(b => {
              const [s, e] = bounds(b.period);
              return (
                <ListItem
                  key={b.id}
                  label={`${nameOf(b.resource_id)}: ${formatWhen(s!, tenant.timezone)} — ${formatWhen(e!, tenant.timezone)}`}
                  description={b.note ?? undefined}
                  endContent={<Button label="Открыть" size="sm" variant="ghost" isLoading={remove.isPending && remove.variables === b.id} onClick={() => remove.mutate(b.id)} />}
                />
              );
            })}
          </List>
        )}
      </VStack>
    </Card>
  );
}
