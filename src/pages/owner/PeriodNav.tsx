import {Button} from '@astryxdesign/core/Button';
import {HStack} from '@astryxdesign/core/HStack';
import {Icon} from '@astryxdesign/core/Icon';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {CaretLeft, CaretRight} from '@phosphor-icons/react';
import {addDays, addMonths, format, parseISO} from 'date-fns';
import {todayIn} from '../../lib/format.ts';
import {msg} from '../../i18n/index.ts';

export type Period = 'day' | 'week' | 'month';

export function shiftAnchor(anchor: string, period: Period, dir: 1 | -1): string {
  const d = parseISO(anchor);
  const next = period === 'day' ? addDays(d, dir) : period === 'week' ? addDays(d, 7 * dir) : addMonths(d, dir);
  return format(next, 'yyyy-MM-dd');
}

/** Human label for server-provided bounds (inclusive local dates). */
export function periodLabel(period: Period, fromDate: string, toDate: string, timezone: string): string {
  const today = todayIn(timezone);
  const f = parseISO(fromDate);
  if (period === 'day') {
    const tomorrow = format(addDays(parseISO(today), 1), 'yyyy-MM-dd');
    const prefix = fromDate === today ? `${msg.fmt.Today}, ` : fromDate === tomorrow ? `${msg.fmt.Tomorrow}, ` : '';
    return prefix + format(f, msg.fmt.periodDay, {locale: msg.dateLocale});
  }
  if (period === 'month') {
    const m = format(f, msg.fmt.periodMonth, {locale: msg.dateLocale});
    return m.charAt(0).toUpperCase() + m.slice(1);
  }
  const edge = (d: Date) => format(d, msg.fmt.periodWeekEdge, {locale: msg.dateLocale});
  return `${edge(f)} – ${edge(parseISO(toDate))}`;
}

type Props = {
  period: Period;
  periods?: Period[];
  onPeriod: (p: Period) => void;
  anchor: string;
  onAnchor: (a: string) => void;
  label: string;
  timezone: string;
};

export function PeriodNav({period, periods = ['day', 'week'], onPeriod, anchor, onAnchor, label, timezone}: Props) {
  const names: Record<Period, string> = {day: msg.period.day, week: msg.period.week, month: msg.period.month};
  return (
    <VStack gap={2}>
      <SegmentedControl label={msg.period.label} value={period} onChange={v => onPeriod(v as Period)} layout="fill">
        {periods.map(p => (
          <SegmentedControlItem key={p} value={p} label={names[p]} />
        ))}
      </SegmentedControl>
      <HStack justify="between" align="center" gap={2}>
        <Button label={msg.period.back} isIconOnly variant="ghost" icon={<Icon icon={CaretLeft} />} onClick={() => onAnchor(shiftAnchor(anchor, period, -1))} />
        <VStack gap={0} align="center">
          <Text weight="semibold" justify="center">
            {label}
          </Text>
          {anchor !== todayIn(timezone) && (
            <Button label={msg.period.toToday} variant="ghost" size="sm" onClick={() => onAnchor(todayIn(timezone))}>
              {msg.period.today}
            </Button>
          )}
        </VStack>
        <Button label={msg.period.forward} isIconOnly variant="ghost" icon={<Icon icon={CaretRight} />} onClick={() => onAnchor(shiftAnchor(anchor, period, 1))} />
      </HStack>
    </VStack>
  );
}
