import {Badge} from '@astryxdesign/core/Badge';
import {Banner} from '@astryxdesign/core/Banner';
import {BottomSheet} from '@astryxdesign/core/BottomSheet';
import {Button} from '@astryxdesign/core/Button';
import {CheckboxList, CheckboxListItem} from '@astryxdesign/core/CheckboxList';
import {FormLayout} from '@astryxdesign/core/FormLayout';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {Icon} from '@astryxdesign/core/Icon';
import {List, ListItem} from '@astryxdesign/core/List';
import {NumberInput} from '@astryxdesign/core/NumberInput';
import {Switch} from '@astryxdesign/core/Switch';
import {Text} from '@astryxdesign/core/Text';
import {TextArea} from '@astryxdesign/core/TextArea';
import {TextInput} from '@astryxdesign/core/TextInput';
import {VStack} from '@astryxdesign/core/VStack';
import {useToast} from '@astryxdesign/core/Toast';
import {PencilSimple, Plus} from '@phosphor-icons/react';
import {useMutation, useQuery} from '@tanstack/react-query';
import {useState} from 'react';
import {useTenant} from '../../../app/tenant.tsx';
import {InlineEmpty, InlineError, RowsSkeleton} from '../../../components/StatusScreens.tsx';
import {randomKey} from '../../../lib/booking-store.ts';
import {errorText} from '../../../lib/errors.ts';
import {formatDuration, formatPrice} from '../../../lib/format.ts';
import {fieldErrors, serviceEditSchema} from '../../../lib/schemas.ts';
import {ownerKey, useOwner} from '../ownerContext.tsx';
import {errorStatus, useRefreshStudio} from './shared.tsx';

type ServiceRow = {
  id: string;
  name: string;
  description: string;
  category: string;
  price: number;
  price_from: boolean;
  duration_minutes: number;
  buffer_minutes: number | null;
  is_active: boolean;
  service_resources: {resource_id: string}[];
};
type ResourceRow = {id: string; name: string; is_active: boolean};

export function ServicesSettings() {
  const tenant = useTenant();
  const {api, slug} = useOwner();
  const services = useQuery({queryKey: ownerKey(slug, 'services'), queryFn: () => api.services() as Promise<ServiceRow[]>});
  const resources = useQuery({queryKey: ownerKey(slug, 'resources'), queryFn: () => api.resources() as Promise<ResourceRow[]>});
  const [editing, setEditing] = useState<ServiceRow | 'new' | null>(null);

  if (services.isPending || resources.isPending) return <RowsSkeleton rows={5} />;
  if (services.isError) return <InlineError message={services.error.message} onRetry={() => void services.refetch()} />;
  if (resources.isError) return <InlineError message={resources.error.message} onRetry={() => void resources.refetch()} />;

  return (
    <VStack gap={3}>
      <HStack justify="between" align="center">
        <Text color="secondary">Цена и длительность новой записи берутся отсюда. Уже созданные записи сохраняют свою цену.</Text>
      </HStack>
      <Button label="Добавить услугу" icon={<Icon icon={Plus} />} onClick={() => setEditing('new')} />
      {services.data.length === 0 ? (
        <InlineEmpty title="Услуг пока нет" />
      ) : (
        <List hasDividers>
          {services.data.map(s => (
            <ListItem
              key={s.id}
              label={s.name}
              description={`${s.category} · ${formatPrice(s.price, s.price_from, tenant.currency)} · ${formatDuration(s.duration_minutes)}`}
              endContent={
                <HStack gap={2} align="center">
                  {!s.is_active && <Badge label="Скрыта" />}
                  <Icon icon={PencilSimple} color="secondary" />
                </HStack>
              }
              onClick={() => setEditing(s)}
            />
          ))}
        </List>
      )}
      <ServiceEditor
        key={editing === 'new' ? 'new' : editing?.id ?? 'none'}
        service={editing}
        resources={resources.data}
        onClose={() => setEditing(null)}
      />
    </VStack>
  );
}

function ServiceEditor({service, resources, onClose}: {service: ServiceRow | 'new' | null; resources: ResourceRow[]; onClose: () => void}) {
  const {api} = useOwner();
  const refresh = useRefreshStudio();
  const showToast = useToast();
  const existing = service && service !== 'new' ? service : null;
  const [f, setF] = useState({
    name: existing?.name ?? '',
    description: existing?.description ?? '',
    category: existing?.category ?? 'Услуги',
    price: existing?.price ?? null as number | null,
    price_from: existing?.price_from ?? false,
    duration_minutes: existing?.duration_minutes ?? 60 as number | null,
    buffer_minutes: existing?.buffer_minutes ?? null as number | null,
    is_active: existing?.is_active ?? true,
    resource_ids: existing?.service_resources.map(r => r.resource_id) ?? resources.filter(r => r.is_active).map(r => r.id),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: async () => {
      const parsed = serviceEditSchema.safeParse(f);
      if (!parsed.success) {
        setErrors(fieldErrors(parsed.error));
        throw new Error('Проверьте выделенные поля');
      }
      setErrors({});
      const {resource_ids, ...row} = parsed.data;
      const saved = await api.upsertService(existing?.id ?? null, {
        ...row,
        is_active: f.is_active,
        ...(existing ? {} : {key: `svc-${randomKey().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10)}`}),
      });
      await api.setServiceResources((saved as unknown as {id: string}).id, resource_ids);
    },
    onSuccess: () => {
      refresh();
      showToast({body: existing ? 'Услуга сохранена' : 'Услуга добавлена'});
      onClose();
    },
  });

  return (
    <BottomSheet isOpen={!!service} onOpenChange={o => !o && onClose()} label="Услуга" height="tall" purpose="form">
      <VStack gap={4}>
        <Heading level={2}>{existing ? 'Услуга' : 'Новая услуга'}</Heading>
        <FormLayout defaultOptionality="required">
          <TextInput label="Название" value={f.name} onChange={v => setF(x => ({...x, name: v}))} status={errorStatus(errors.name)} />
          <TextInput label="Раздел" value={f.category} onChange={v => setF(x => ({...x, category: v}))} description="Например: Мойка, Полировка, Защита" status={errorStatus(errors.category)} />
          <TextArea label="Описание" isOptional value={f.description} onChange={v => setF(x => ({...x, description: v}))} rows={2} maxLength={400} />
          <NumberInput label="Цена, ₽" value={f.price} onChange={v => setF(x => ({...x, price: v}))} min={0} step={100} status={errorStatus(errors.price)} />
          <Switch label="Цена «от»" description="Окончательная стоимость зависит от машины" value={f.price_from} onChange={v => setF(x => ({...x, price_from: v}))} />
          <NumberInput
            label="Длительность, минут"
            value={f.duration_minutes}
            onChange={v => setF(x => ({...x, duration_minutes: v}))}
            min={15}
            step={15}
            description={f.duration_minutes ? `= ${formatDuration(f.duration_minutes)}. Сутки = 1440 минут: бокс будет занят непрерывно.` : undefined}
            status={errorStatus(errors.duration_minutes)}
          />
          <NumberInput
            label="Подготовка бокса после машины, минут"
            isOptional
            description="Пусто — как в правилах записи"
            value={f.buffer_minutes}
            onChange={v => setF(x => ({...x, buffer_minutes: Number.isFinite(v) ? v : null}))}
            min={0}
            step={5}
          />
          <CheckboxList label="Боксы для услуги" value={f.resource_ids} onChange={v => setF(x => ({...x, resource_ids: v}))} status={errorStatus(errors.resource_ids)}>
            {resources.map(r => (
              <CheckboxListItem key={r.id} value={r.id} label={r.name} description={r.is_active ? undefined : 'Бокс отключён'} />
            ))}
          </CheckboxList>
          <Switch label="Показывать клиентам" value={f.is_active} onChange={v => setF(x => ({...x, is_active: v}))} description="Скрытая услуга остаётся в истории записей" />
        </FormLayout>
        {save.isError && <Banner status="error" title={errorText(save.error)} collapsible={false} />}
        <HStack gap={2}>
          <Button label="Отмена" variant="ghost" onClick={onClose} style={{flexShrink: 0}} />
          <Button label="Сохранить" variant="primary" width="100%" isLoading={save.isPending} onClick={() => save.mutate()} />
        </HStack>
      </VStack>
    </BottomSheet>
  );
}
