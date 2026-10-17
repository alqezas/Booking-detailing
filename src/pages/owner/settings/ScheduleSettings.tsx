import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {DateInput} from '@astryxdesign/core/DateInput';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {List, ListItem} from '@astryxdesign/core/List';
import {Switch} from '@astryxdesign/core/Switch';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {TimeInput, type ISOTimeString} from '@astryxdesign/core/TimeInput';
import {VStack} from '@astryxdesign/core/VStack';
import {useToast} from '@astryxdesign/core/Toast';
import {useMutation, useQuery} from '@tanstack/react-query';
import {useEffect, useState} from 'react';
import {useTenant} from '../../../app/tenant.tsx';
import {InlineError, RowsSkeleton} from '../../../components/StatusScreens.tsx';
import {errorText} from '../../../lib/errors.ts';
import {formatDate, todayIn} from '../../../lib/format.ts';
import {hoursRowSchema} from '../../../lib/schemas.ts';
import {ownerKey, useOwner} from '../ownerContext.tsx';
import {useRefreshStudio} from './shared.tsx';
import {ApiError} from '../../../lib/errors.ts';
import {msg} from '../../../i18n/index.ts';

const days = () => msg.fmt.weekdayLong;
type DayState = {open: boolean; opens: string; closes: string};

export function ScheduleSettings() {
  return (
    <VStack gap={6}>
      <WeekForm />
      <DaysOff />
    </VStack>
  );
}

function WeekForm() {
  const {api, slug} = useOwner();
  const refresh = useRefreshStudio();
  const showToast = useToast();
  const q = useQuery({
    queryKey: ownerKey(slug, 'hours'),
    queryFn: () => api.hours() as Promise<{weekday: number; opens: string; closes: string}[]>,
  });
  const [week, setWeek] = useState<DayState[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!q.data || week) return;
    setWeek(
      days().map((_, i) => {
        const row = q.data.find(r => r.weekday === i + 1);
        return row ? {open: true, opens: row.opens.slice(0, 5), closes: row.closes.slice(0, 5)} : {open: false, opens: '09:00', closes: '20:00'};
      }),
    );
  }, [q.data, week]);

  const save = useMutation({
    mutationFn: () => {
      const rows = week!.flatMap((d, i) => (d.open ? [{weekday: i + 1, opens: d.opens.slice(0, 5), closes: d.closes.slice(0, 5)}] : []));
      for (const r of rows) {
        const ok = hoursRowSchema.safeParse(r);
        if (!ok.success) throw new ApiError('CLIENT', msg.schedule.closeAfterOpen(days()[r.weekday - 1]!));
      }
      if (!rows.length) throw new ApiError('CLIENT', msg.schedule.needWorkday);
      return api.setHours(rows);
    },
    onSuccess: () => {
      setError(null);
      refresh();
      showToast({body: msg.schedule.saved});
    },
    onError: e => setError(errorText(e)),
  });

  if (q.isPending || !week) return <RowsSkeleton rows={7} height={48} />;
  if (q.isError) return <InlineError message={q.error.message} onRetry={() => void q.refetch()} />;
  const set = (i: number, patch: Partial<DayState>) => setWeek(w => w!.map((d, j) => (j === i ? {...d, ...patch} : d)));

  return (
    <Card padding={4}>
      <VStack gap={4}>
        <VStack gap={1}>
          <Heading level={2}>{msg.schedule.title}</Heading>
          <Text color="secondary">{msg.schedule.lead}</Text>
        </VStack>
        {week.map((d, i) => (
          <HStack key={i} gap={3} align="end" wrap="wrap">
            <Switch label={days()[i]!} value={d.open} onChange={v => set(i, {open: v})} width={180} />
            {d.open ? (
              <HStack gap={2}>
                <TimeInput label={msg.schedule.from} value={d.opens as ISOTimeString} onChange={v => v && set(i, {opens: v})} hourFormat="24h" />
                <TimeInput label={msg.schedule.to} value={d.closes as ISOTimeString} onChange={v => v && set(i, {closes: v})} hourFormat="24h" />
              </HStack>
            ) : (
              <Text color="secondary">{msg.fmt.dayOff}</Text>
            )}
          </HStack>
        ))}
        {error && <Banner status="error" title={error} collapsible={false} />}
        <Button label={msg.schedule.save} variant="primary" isLoading={save.isPending} onClick={() => save.mutate()} />
      </VStack>
    </Card>
  );
}

type Exception = {id: string; day: string; note: string | null; source: string};
type ISODate = `${number}${number}${number}${number}-${number}${number}-${number}${number}`;

function DaysOff() {
  const tenant = useTenant();
  const {api, slug} = useOwner();
  const refresh = useRefreshStudio();
  const today = todayIn(tenant.timezone);
  const q = useQuery({queryKey: ownerKey(slug, 'exceptions'), queryFn: () => api.exceptions() as Promise<Exception[]>});
  const [day, setDay] = useState<ISODate | undefined>();
  const [note, setNote] = useState('');
  const add = useMutation({
    mutationFn: () => api.addException(day!, note.trim() || msg.fmt.dayOff),
    onSuccess: () => {
      setDay(undefined);
      setNote('');
      refresh();
    },
  });
  const remove = useMutation({mutationFn: (id: string) => api.removeException(id), onSuccess: refresh});
  const upcoming = (q.data ?? []).filter(e => e.day >= today);

  return (
    <Card padding={4}>
      <VStack gap={4}>
        <Heading level={2}>{msg.schedule.daysOff}</Heading>
        <HStack gap={2} align="end" wrap="wrap">
          <DateInput label={msg.schedule.date} value={day} onChange={setDay} min={today as ISODate} />
          <TextInput label={msg.schedule.note} isOptional value={note} onChange={setNote} placeholder={msg.schedule.notePlaceholder} width={200} />
          <Button label={msg.common.add} isDisabled={!day} isLoading={add.isPending} onClick={() => add.mutate()} />
        </HStack>
        {add.isError && <Banner status="error" title={(add.error as {code?: string})?.code === '23505' ? msg.schedule.duplicate : errorText(add.error)} collapsible={false} />}
        {q.isError ? (
          <InlineError message={q.error.message} onRetry={() => void q.refetch()} />
        ) : upcoming.length === 0 ? (
          <Text color="secondary">{msg.schedule.none}</Text>
        ) : (
          <List hasDividers>
            {upcoming.map(e => (
              <ListItem
                key={e.id}
                label={formatDate(e.day, {weekday: 'short', day: 'numeric', month: 'long', year: 'numeric'})}
                description={e.note ?? undefined}
                endContent={<Button label={msg.schedule.remove} size="sm" variant="ghost" isLoading={remove.isPending && remove.variables === e.id} onClick={() => remove.mutate(e.id)} />}
              />
            ))}
          </List>
        )}
      </VStack>
    </Card>
  );
}
