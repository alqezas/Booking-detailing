import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {HStack} from '@astryxdesign/core/HStack';
import {Icon} from '@astryxdesign/core/Icon';
import {List, ListItem} from '@astryxdesign/core/List';
import {Selector} from '@astryxdesign/core/Selector';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {Timer} from '@phosphor-icons/react';
import {useState} from 'react';
import {useTenant} from '../../app/tenant.tsx';
import {daysLabel, washMsg} from '../../i18n/wash.ts';
import {formatDuration, formatMoney} from '../../lib/format.ts';
import {RevealSection} from '../home/Sections.tsx';
import {useBookingFlow} from '../booking/BookingFlow.tsx';
import {CAR_CLASSES, type CarClass} from '../../../supabase/functions/_shared/wash.ts';
import {WashCalculator, initialWash, washServices, type WashValue} from './WashCalculator.tsx';

/** Home page booking card of a car wash: the calculator, then «choose a time». */
export function WashBookingCard() {
  const t = useTenant();
  const flow = useBookingFlow();
  const W = washMsg();
  const [value, setValue] = useState<WashValue>(() => initialWash(t));
  if (!washServices(t).length) return null;
  return (
    <RevealSection title={W.calc.title} id="calc-title">
      <Card padding={4}>
        <VStack gap={4}>
          <Text color="secondary">{W.calc.lead}</Text>
          <WashCalculator value={value} onChange={setValue} />
          <Button label={W.calc.choose} variant="primary" size="lg" width="100%" onClick={() => flow.open(value.serviceId, value)} />
        </VStack>
      </Card>
    </RevealSection>
  );
}

/** Price list for one car class: programs, then extras. */
export function WashPricesSection() {
  const t = useTenant();
  const W = washMsg();
  const [cls, setCls] = useState<CarClass>('medium');
  const programs = washServices(t);
  if (!programs.length || !t.wash) return null;
  const price = (p: {price: number | null; minutes: number} | undefined) => (!p || p.price === null ? W.calc.onRequest : formatMoney(p.price, t.currency));
  return (
    <RevealSection title={W.home.pricesTitle} id="wash-prices-title">
      <Text color="secondary">{W.home.pricesLead}</Text>
      <Selector label={W.calc.carClass} value={cls} onChange={v => v && setCls(v as CarClass)} options={CAR_CLASSES.map(c => ({value: c, label: t.wash!.classes[c]}))} />
      <List hasDividers>
        {programs.map(({service, program}) => {
          const row = program.prices[cls];
          return (
            <ListItem
              key={service.id}
              label={service.name}
              description={service.description}
              endContent={
                <VStack gap={0} align="end">
                  <Text weight="semibold" hasTabularNumbers textWrap="nowrap">
                    {price(row)}
                  </Text>
                  {row && (
                    <Text type="supporting" textWrap="nowrap">
                      {formatDuration(row.minutes)}
                    </Text>
                  )}
                </VStack>
              }
            />
          );
        })}
      </List>
      {t.wash.extras.length > 0 && (
        <List hasDividers header={<Text weight="semibold">{W.home.extrasTitle}</Text>}>
          {t.wash.extras.map(e => (
            <ListItem
              key={e.key}
              label={e.name}
              endContent={
                <Text hasTabularNumbers textWrap="nowrap">
                  {e.prices[cls]?.price != null ? `+ ${formatMoney(e.prices[cls]!.price!, t.currency)}` : W.calc.onRequest}
                </Text>
              }
            />
          ))}
        </List>
      )}
    </RevealSection>
  );
}

/** When online booking is closed or limited (peak hours), so nobody is surprised. */
export function PeakHoursSection() {
  const t = useTenant();
  const W = washMsg();
  const rules = t.peak_hours ?? [];
  if (!rules.length) return null;
  return (
    <RevealSection title={W.home.peakTitle} id="peak-title">
      <Card padding={4}>
        <HStack gap={3} align="start">
          <Icon icon={Timer} color="accent" size="lg" />
          <VStack gap={1}>
            {rules.map((r, i) => (
              <Text key={i}>{r.mode === 'walkin' ? W.home.peakWalkin(daysLabel(r.days), r.from, r.to) : W.home.peakLimit(daysLabel(r.days), r.from, r.to, r.posts ?? 1)}</Text>
            ))}
          </VStack>
        </HStack>
      </Card>
    </RevealSection>
  );
}
