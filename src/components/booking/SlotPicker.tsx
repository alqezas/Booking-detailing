import {Button} from '@astryxdesign/core/Button';
import {Grid} from '@astryxdesign/core/Grid';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {addDays, format, parseISO} from 'date-fns';
import {useEffect, useMemo, useState} from 'react';
import {formatDayLabel, formatTime, todayIn} from '../../lib/format.ts';
import {useAvailability} from '../../lib/queries.ts';
import type {AvailabilityDay} from '../../lib/types.ts';
import {InlineEmpty, InlineError, RowsSkeleton} from '../StatusScreens.tsx';

const PAGE_DAYS = 7;

type Props = {
  slug: string;
  serviceId: string;
  timezone: string;
  horizonDays: number;
  value: string | null;
  onChange: (startAt: string) => void;
  /** Message to show above the grid, e.g. after the chosen slot was taken. */
  notice?: string | null;
};

export function SlotPicker({slug, serviceId, timezone, horizonDays, value, onChange, notice}: Props) {
  const today = todayIn(timezone);
  const [from, setFrom] = useState(today);
  const q = useAvailability(slug, serviceId, from, PAGE_DAYS);
  const days = useMemo(() => q.data?.days ?? [], [q.data]);
  const [day, setDay] = useState<string | null>(null);

  // Pick the first day that has a free slot whenever a new week arrives.
  useEffect(() => {
    if (!days.length) return;
    if (day && days.some(d => d.date === day)) return;
    const firstFree = days.find(d => d.slots.some(s => s.available)) ?? days[0]!;
    setDay(firstFree.date);
  }, [days, day]);

  const current: AvailabilityDay | undefined = days.find(d => d.date === day);
  const canGoBack = from > today;
  const lastAllowed = format(addDays(parseISO(today), horizonDays - 1), 'yyyy-MM-dd');
  const nextFrom = format(addDays(parseISO(from), PAGE_DAYS), 'yyyy-MM-dd');
  const canGoForward = nextFrom <= lastAllowed;

  const shift = (to: string) => {
    setDay(null);
    setFrom(to);
  };

  if (q.isPending) return <RowsSkeleton rows={3} height={48} />;
  if (q.isError) return <InlineError message={q.error.message} onRetry={() => void q.refetch()} />;

  return (
    <VStack gap={4}>
      {notice && (
        <Text color="accent" weight="semibold" role="status">
          {notice}
        </Text>
      )}
      <VStack gap={2}>
        <HStack justify="between" align="center">
          <Heading level={3}>Дата</Heading>
          <HStack gap={1}>
            <Button
              label="Раньше"
              size="sm"
              variant="ghost"
              isDisabled={!canGoBack}
              onClick={() => shift(format(addDays(parseISO(from), -PAGE_DAYS), 'yyyy-MM-dd') < today ? today : format(addDays(parseISO(from), -PAGE_DAYS), 'yyyy-MM-dd'))}
            />
            <Button label="Позже" size="sm" variant="ghost" isDisabled={!canGoForward} onClick={() => shift(nextFrom)} />
          </HStack>
        </HStack>
        {days.length === 0 ? (
          <InlineEmpty title="На эти дни записи нет" description="Посмотрите следующую неделю или позвоните в студию." />
        ) : (
          <HStack gap={2} isScrollable role="radiogroup" aria-label="Выбор даты" style={{paddingBlockEnd: 'var(--spacing-1)'}}>
            {days.map(d => {
              const free = d.slots.filter(s => s.available).length;
              const selected = d.date === day;
              return (
                <Button
                  key={d.date}
                  label={`${formatDayLabel(d.date, timezone)}, свободно ${free}`}
                  variant={selected ? 'primary' : 'secondary'}
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setDay(d.date)}
                  style={{flexShrink: 0, minHeight: 56}}
                >
                  <VStack gap={0} align="center">
                    <Text weight="semibold" color="inherit">
                      {formatDayLabel(d.date, timezone)}
                    </Text>
                    <Text type="supporting" color="inherit">
                      {free ? `${free} своб.` : 'занято'}
                    </Text>
                  </VStack>
                </Button>
              );
            })}
          </HStack>
        )}
      </VStack>

      {current && (
        <VStack gap={2}>
          <Heading level={3}>Время</Heading>
          {current.slots.every(s => !s.available) && (
            <Text color="secondary">В этот день всё занято — выберите другую дату.</Text>
          )}
          <Grid columns={{minWidth: 76, max: 6}} gap={2} role="radiogroup" aria-label="Выбор времени">
            {current.slots.map(s => {
              const t = formatTime(s.start_at, timezone);
              const selected = value === s.start_at;
              return s.available ? (
                <Button
                  key={s.start_at}
                  label={t}
                  role="radio"
                  aria-checked={selected}
                  variant={selected ? 'primary' : 'secondary'}
                  onClick={() => onChange(s.start_at)}
                  width="100%"
                  style={{minHeight: 48}}
                />
              ) : (
                <Button
                  key={s.start_at}
                  label={`${t}, занято`}
                  isDisabled
                  variant="ghost"
                  width="100%"
                  tooltip="Это время занято"
                  style={{minHeight: 48}}
                >
                  <VStack gap={0} align="center">
                    <Text hasStrikethrough color="inherit">
                      {t}
                    </Text>
                    <Text type="supporting" color="inherit">
                      занято
                    </Text>
                  </VStack>
                </Button>
              );
            })}
          </Grid>
          {Intl.DateTimeFormat().resolvedOptions().timeZone !== timezone && (
            <Text type="supporting">Время указано по часовому поясу студии.</Text>
          )}
        </VStack>
      )}
    </VStack>
  );
}
