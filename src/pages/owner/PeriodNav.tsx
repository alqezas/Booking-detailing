import {Button} from '@astryxdesign/core/Button';
import {HStack} from '@astryxdesign/core/HStack';
import {Icon} from '@astryxdesign/core/Icon';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {CaretLeft, CaretRight} from '@phosphor-icons/react';
import {addDays, addMonths, format, parseISO} from 'date-fns';
import {ru} from 'date-fns/locale';
import {todayIn} from '../../lib/format.ts';

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
    const prefix = fromDate === today ? 'Сегодня, ' : fromDate === tomorrow ? 'Завтра, ' : '';
    return prefix + format(f, 'EEEEEE, d MMMM', {locale: ru});
  }
  if (period === 'month') return format(f, 'LLLL yyyy', {locale: ru});
  return `${format(f, 'd MMM', {locale: ru})} – ${format(parseISO(toDate), 'd MMM', {locale: ru})}`;
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
  const names: Record<Period, string> = {day: 'День', week: 'Неделя', month: 'Месяц'};
  return (
    <VStack gap={2}>
      <SegmentedControl label="Период" value={period} onChange={v => onPeriod(v as Period)} layout="fill">
        {periods.map(p => (
          <SegmentedControlItem key={p} value={p} label={names[p]} />
        ))}
      </SegmentedControl>
      <HStack justify="between" align="center" gap={2}>
        <Button label="Назад" isIconOnly variant="ghost" icon={<Icon icon={CaretLeft} />} onClick={() => onAnchor(shiftAnchor(anchor, period, -1))} />
        <VStack gap={0} align="center">
          <Text weight="semibold" justify="center">
            {label}
          </Text>
          {anchor !== todayIn(timezone) && (
            <Button label="К сегодняшнему дню" variant="ghost" size="sm" onClick={() => onAnchor(todayIn(timezone))}>
              Сегодня
            </Button>
          )}
        </VStack>
        <Button label="Вперёд" isIconOnly variant="ghost" icon={<Icon icon={CaretRight} />} onClick={() => onAnchor(shiftAnchor(anchor, period, 1))} />
      </HStack>
    </VStack>
  );
}
