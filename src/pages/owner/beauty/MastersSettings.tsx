import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {DateInput} from '@astryxdesign/core/DateInput';
import {FileInput} from '@astryxdesign/core/FileInput';
import {FormLayout} from '@astryxdesign/core/FormLayout';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {List, ListItem} from '@astryxdesign/core/List';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {Switch} from '@astryxdesign/core/Switch';
import {Text} from '@astryxdesign/core/Text';
import {TextArea} from '@astryxdesign/core/TextArea';
import {TextInput} from '@astryxdesign/core/TextInput';
import {TimeInput, type ISOTimeString} from '@astryxdesign/core/TimeInput';
import {VStack} from '@astryxdesign/core/VStack';
import {useToast} from '@astryxdesign/core/Toast';
import {useMutation, useQuery} from '@tanstack/react-query';
import {useState} from 'react';
import {useTenant} from '../../../app/tenant.tsx';
import {InlineError, RowsSkeleton} from '../../../components/StatusScreens.tsx';
import {beautyMsg} from '../../../i18n/beauty.ts';
import {msg} from '../../../i18n/index.ts';
import {errorText} from '../../../lib/errors.ts';
import {formatDate, todayIn} from '../../../lib/format.ts';
import {prepareImage, uniqueName} from '../../../lib/image.ts';
import {mediaUrl} from '../../../lib/media.ts';
import {ownerKey, useOwner} from '../ownerContext.tsx';
import {IMAGE_ACCEPT, MAX_UPLOAD, useRefreshStudio} from '../settings/shared.tsx';

type Row = {id: string; name: string; role: 'master' | 'place'; title: string; bio: string; photo_path: string | null; custom_hours: boolean; is_active: boolean};
type Shift = {weekday: number; opens: string; closes: string};
type DayOff = {id: string; resource_id: string; day: string; note: string | null};
type ISODate = `${number}${number}${number}${number}-${number}${number}-${number}${number}`;

/**
 * Masters (beauty): profile shown on the home page (photo, specialisation,
 * bio), an own weekly shift (off = studio hours) and days off. Names, active
 * state and time blocks stay in the common resources editor above.
 */
export function MastersSettings() {
  const {api, slug} = useOwner();
  const B = beautyMsg();
  const resources = useQuery({queryKey: ownerKey(slug, 'resources'), queryFn: () => api.resources() as Promise<Row[]>});
  const shifts = useQuery({queryKey: ownerKey(slug, 'resource-hours'), queryFn: () => api.resourceHours() as Promise<(Shift & {resource_id: string})[]>});
  const daysOff = useQuery({queryKey: ownerKey(slug, 'resource-days-off'), queryFn: () => api.resourceExceptions() as Promise<DayOff[]>});
  if (resources.isPending || shifts.isPending || daysOff.isPending) return <RowsSkeleton rows={3} />;
  const err = resources.error ?? shifts.error ?? daysOff.error;
  if (err) return <InlineError message={err.message} onRetry={() => void Promise.all([resources.refetch(), shifts.refetch(), daysOff.refetch()])} />;
  const active = resources.data!.filter(r => r.is_active);
  return (
    <VStack gap={4}>
      <VStack gap={1}>
        <Heading level={2}>{B.owner.masters.title}</Heading>
        <Text color="secondary">{B.owner.masters.lead}</Text>
      </VStack>
      {active.map(r => (
        <MasterCard
          key={r.id}
          r={r}
          shift={shifts.data!.filter(s => s.resource_id === r.id).map(s => ({weekday: s.weekday, opens: s.opens.slice(0, 5), closes: s.closes.slice(0, 5)}))}
          daysOff={daysOff.data!.filter(d => d.resource_id === r.id)}
        />
      ))}
    </VStack>
  );
}

function MasterCard({r, shift, daysOff}: {r: Row; shift: Shift[]; daysOff: DayOff[]}) {
  const {api} = useOwner();
  const t = useTenant();
  const B = beautyMsg().owner.masters;
  const refresh = useRefreshStudio();
  const showToast = useToast();
  const [f, setF] = useState({role: r.role, title: r.title, bio: r.bio});
  const [custom, setCustom] = useState(r.custom_hours);
  const [rows, setRows] = useState<Shift[]>(shift);
  const [day, setDay] = useState<ISODate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => api.upsertResource(r.id, {role: f.role, title: f.title.trim(), bio: f.bio.trim()}),
    onSuccess: () => {
      refresh();
      setError(null);
      showToast({body: B.saved});
    },
    onError: e => setError(errorText(e)),
  });
  const photo = useMutation({
    mutationFn: async (file: File) => {
      const {blob, ext} = await prepareImage(file, 900);
      const path = await api.upload(blob, uniqueName(`master-${r.id.slice(0, 8)}`, ext));
      await api.upsertResource(r.id, {photo_path: path});
    },
    onSuccess: () => {
      refresh();
      setError(null);
      showToast({body: B.photoUpdated});
    },
    onError: e => setError(errorText(e)),
  });
  const saveShift = useMutation({
    mutationFn: () => api.setResourceHours(r.id, custom, custom ? rows : []),
    onSuccess: () => {
      refresh();
      setError(null);
      showToast({body: B.shiftSaved});
    },
    onError: e => setError(errorText(e)),
  });
  const addDayOff = useMutation({
    mutationFn: () => api.addResourceDayOff(r.id, day!, ''),
    onSuccess: () => {
      setDay(null);
      refresh();
      showToast({body: B.dayOffAdded});
    },
    onError: e => setError(errorText(e)),
  });
  const removeDayOff = useMutation({
    mutationFn: (id: string) => api.removeResourceDayOff(id),
    onSuccess: () => refresh(),
    onError: e => setError(errorText(e)),
  });

  const studioHours = (wd: number) => t.hours.filter(h => h.weekday === wd);
  const setRow = (i: number, patch: Partial<Shift>) => setRows(x => x.map((row, j) => (j === i ? {...row, ...patch} : row)));
  const today = todayIn(t.timezone);

  return (
    <Card padding={4}>
      <VStack gap={4}>
        <HStack gap={3} align="center">
          {r.photo_path ? (
            <img src={mediaUrl(r.photo_path) ?? ''} alt={r.name} width={64} height={64} style={{borderRadius: 'var(--radius-full)', objectFit: 'cover'}} />
          ) : null}
          <Heading level={3}>{r.name}</Heading>
        </HStack>
        {error && <Banner status="error" title={error} collapsible={false} />}
        <FormLayout>
          <SegmentedControl
            label={B.role}
            value={f.role}
            onChange={v => setF(x => ({...x, role: v as Row['role']}))}
            layout="fill"
          >
            <SegmentedControlItem value="master" label={B.roleMaster} />
            <SegmentedControlItem value="place" label={B.rolePlace} />
          </SegmentedControl>
          <TextInput label={B.titleField} isOptional value={f.title} onChange={v => setF(x => ({...x, title: v}))} placeholder={B.titlePlaceholder} />
          <TextArea label={B.bio} isOptional value={f.bio} onChange={v => setF(x => ({...x, bio: v}))} rows={2} maxLength={300} />
        </FormLayout>
        <HStack gap={2} wrap="wrap" align="end">
          <Button label={msg.common.save} variant="primary" isLoading={save.isPending} onClick={() => save.mutate()} />
          <FileInput
            label={r.photo_path ? B.replacePhoto : B.photo}
            value={null}
            accept={IMAGE_ACCEPT}
            maxSize={MAX_UPLOAD}
            isLoading={photo.isPending}
            onChange={file => file && !Array.isArray(file) && photo.mutate(file)}
          />
        </HStack>

        <VStack gap={2}>
          <Switch label={B.shift} description={B.shiftHint} value={custom} onChange={setCustom} />
          {custom && (
            <VStack gap={2}>
              {[1, 2, 3, 4, 5, 6, 7].map(wd => {
                const own = rows.map((row, i) => ({row, i})).filter(x => x.row.weekday === wd);
                const studio = studioHours(wd);
                return (
                  <HStack key={wd} gap={2} align="center" wrap="wrap">
                    <Text weight="semibold" style={{minWidth: '3em'}}>
                      {msg.fmt.weekdayShort[wd]}
                    </Text>
                    {own.length === 0 && <Text color="secondary">{B.off}</Text>}
                    {own.map(({row, i}) => (
                      <HStack key={i} gap={1} align="center">
                        <TimeInput label={msg.schedule.from} isLabelHidden value={row.opens as ISOTimeString} onChange={v => v && setRow(i, {opens: v.slice(0, 5)})} />
                        <TimeInput label={msg.schedule.to} isLabelHidden value={row.closes as ISOTimeString} onChange={v => v && setRow(i, {closes: v.slice(0, 5)})} />
                        <Button label={msg.schedule.remove} size="sm" variant="ghost" onClick={() => setRows(x => x.filter((_, j) => j !== i))} />
                      </HStack>
                    ))}
                    {studio.length > 0 && own.length === 0 && (
                      <Button
                        label={B.addInterval}
                        size="sm"
                        variant="ghost"
                        onClick={() => setRows(x => [...x, {weekday: wd, opens: studio[0]!.opens, closes: studio[0]!.closes}])}
                      />
                    )}
                  </HStack>
                );
              })}
            </VStack>
          )}
          <HStack>
            <Button label={B.saveShift} variant="secondary" isLoading={saveShift.isPending} onClick={() => saveShift.mutate()} />
          </HStack>
        </VStack>

        <VStack gap={2}>
          <Text weight="semibold">{B.daysOff}</Text>
          {daysOff.filter(d => d.day >= today).length === 0 ? (
            <Text color="secondary">{B.noDaysOff}</Text>
          ) : (
            <List hasDividers>
              {daysOff
                .filter(d => d.day >= today)
                .map(d => (
                  <ListItem
                    key={d.id}
                    label={formatDate(d.day, {weekday: 'short', day: 'numeric', month: 'long'})}
                    description={d.note ?? undefined}
                    endContent={<Button label={msg.schedule.remove} size="sm" variant="ghost" isLoading={removeDayOff.isPending && removeDayOff.variables === d.id} onClick={() => removeDayOff.mutate(d.id)} />}
                  />
                ))}
            </List>
          )}
          <HStack gap={2} align="end" wrap="wrap">
            <DateInput label={msg.schedule.date} value={day ?? undefined} onChange={v => setDay(v as ISODate | null)} />
            <Button label={B.addDayOff} isDisabled={!day} isLoading={addDayOff.isPending} onClick={() => addDayOff.mutate()} />
          </HStack>
        </VStack>
      </VStack>
    </Card>
  );
}
