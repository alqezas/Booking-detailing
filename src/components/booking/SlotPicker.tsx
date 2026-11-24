import {Button} from '@astryxdesign/core/Button';
import {Grid} from '@astryxdesign/core/Grid';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {addDays, format, parseISO} from 'date-fns';
import {keepPreviousData, useQuery} from '@tanstack/react-query';
import {useEffect, useMemo, useState} from 'react';
import {formatDayLabel, formatTime, todayIn} from '../../lib/format.ts';
import {useAvailability} from '../../lib/queries.ts';
import type {Availability, AvailabilityDay} from '../../lib/types.ts';
import {InlineEmpty, InlineError, RowsSkeleton} from '../StatusScreens.tsx';
import {msg} from '../../i18n/index.ts';

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
  /** Owner cabinet: load slots with the owner's session instead of the public endpoint. */
  ownerLoad?: (from: string, days: number) => Promise<Availability>;
  /** Any other loader (the tyre calculator's priced availability); loadKey identifies its inputs. */
  load?: (from: string, days: number) => Promise<Availability>;
  loadKey?: unknown[];
  /** Called with every loaded page, e.g. to show the server's price quote. */
  onLoaded?: (a: Availability) => void;
  /** Group the day's slots into morning / day / evening blocks with these headings. */
  dayParts?: {morning: string; day: string; evening: string};
};

/** Local hour of a slot → part of day: before 12, 12–17, from 17. */
export function dayPartOf(iso: string, tz: string): 'morning' | 'day' | 'evening' {
  const h = Number(formatTime(iso, tz).slice(0, 2));
  return h < 12 ? 'morning' : h < 17 ? 'day' : 'evening';
}

export function SlotPicker({slug, serviceId, timezone, horizonDays, value, onChange, notice, ownerLoad, load, loadKey, onLoaded, dayParts}: Props) {
  const today = todayIn(timezone);
  const [from, setFrom] = useState(today);
  const custom = load ?? ownerLoad;
  const publicQ = useAvailability(slug, custom ? null : serviceId, from, PAGE_DAYS);
  const ownerQ = useQuery({
    queryKey: [...(load ? ['availability', slug, 'custom', ...(loadKey ?? [])] : ['owner', slug, 'availability']), serviceId, from, PAGE_DAYS],
    queryFn: () => custom!(from, PAGE_DAYS),
    enabled: !!custom,
    placeholderData: keepPreviousData,
  });
  const q = custom ? ownerQ : publicQ;
  useEffect(() => {
    if (q.data) onLoaded?.(q.data);
  }, [q.data, onLoaded]);
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

  const slotGrid = (slots: AvailabilityDay['slots'], label: string) => (
            <Grid columns={{minWidth: 76, max: 6}} gap={2} role="radiogroup" aria-label={label}>
              {slots.map(s => {
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
                    label={msg.slots.slotTaken(t)}
                    role="radio"
                    aria-checked={false}
                    isDisabled
                    variant="ghost"
                    width="100%"
                    tooltip={msg.slots.slotTakenTip}
                    style={{minHeight: 48}}
                  >
                    <VStack gap={0} align="center">
                      <Text hasStrikethrough color="inherit">
                        {t}
                      </Text>
                      <Text type="supporting" color="inherit">
                        {msg.slots.taken}
                      </Text>
                    </VStack>
                  </Button>
                );
              })}
            </Grid>
  );

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
          <Heading level={3}>{msg.slots.date}</Heading>
          <HStack gap={1}>
            <Button
              label={msg.slots.earlier}
              size="sm"
              variant="ghost"
              isDisabled={!canGoBack}
              onClick={() => shift(format(addDays(parseISO(from), -PAGE_DAYS), 'yyyy-MM-dd') < today ? today : format(addDays(parseISO(from), -PAGE_DAYS), 'yyyy-MM-dd'))}
            />
            <Button label={msg.slots.later} size="sm" variant="ghost" isDisabled={!canGoForward} onClick={() => shift(nextFrom)} />
          </HStack>
        </HStack>
        {days.length === 0 ? (
          <InlineEmpty title={msg.slots.noDays} description={msg.slots.noDaysHint} />
        ) : (
          <HStack gap={2} isScrollable role="radiogroup" aria-label={msg.slots.pickDate} style={{paddingBlockEnd: 'var(--spacing-1)'}}>
            {days.map(d => {
              const free = d.slots.filter(s => s.available).length;
              const selected = d.date === day;
              return (
                <Button
                  key={d.date}
                  label={msg.slots.dayLabel(formatDayLabel(d.date, timezone), free)}
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
                      {free ? msg.slots.freeShort(free) : msg.slots.taken}
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
          <Heading level={3}>{msg.slots.time}</Heading>
          {current.slots.every(s => !s.available) && (
            <Text color="secondary">{msg.slots.allTaken}</Text>
          )}
          {dayParts
            ? (['morning', 'day', 'evening'] as const).map(part => {
                const slots = current.slots.filter(x => dayPartOf(x.start_at, timezone) === part);
                if (!slots.length) return null;
                const free = slots.filter(x => x.available).length;
                return (
                  <VStack key={part} gap={2}>
                    <HStack gap={2} align="center">
                      <Text weight="semibold">{dayParts[part]}</Text>
                      <Text type="supporting">{free ? msg.slots.freeShort(free) : msg.slots.taken}</Text>
                    </HStack>
                    {slotGrid(slots, `${msg.slots.pickTime}: ${dayParts[part]}`)}
                  </VStack>
                );
              })
            : slotGrid(current.slots, msg.slots.pickTime)}
          {Intl.DateTimeFormat().resolvedOptions().timeZone !== timezone && (
            <Text type="supporting">{msg.slots.tzNote}</Text>
          )}
        </VStack>
      )}
    </VStack>
  );
}
