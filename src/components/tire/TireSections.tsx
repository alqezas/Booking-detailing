import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {HStack} from '@astryxdesign/core/HStack';
import {Icon} from '@astryxdesign/core/Icon';
import {List, ListItem} from '@astryxdesign/core/List';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {Snowflake, Sun, Warehouse} from '@phosphor-icons/react';
import {useState} from 'react';
import {useTenant} from '../../app/tenant.tsx';
import {monthDay, tireMsg} from '../../i18n/tire.ts';
import {formatMoney, todayIn} from '../../lib/format.ts';
import {RevealSection} from '../home/Sections.tsx';
import {useBookingFlow} from '../booking/BookingFlow.tsx';
import {RIMS, VEHICLES, currentOrNextSeason, priceRange, type Rim, type Vehicle} from '../../../supabase/functions/_shared/tire.ts';
import {TireCalculator, initialCalc, tireServices, type CalcValue} from './TireCalculator.tsx';

/** Home page booking card of a tyre service: the calculator itself, then «choose a time». */
export function TireBookingCard() {
  const t = useTenant();
  const flow = useBookingFlow();
  const T = tireMsg();
  const [calc, setCalc] = useState<CalcValue>(() => initialCalc(t));
  if (!tireServices(t).length) return null;
  return (
    <RevealSection title={T.calc.title} id="calc-title">
      <Card padding={4}>
        <VStack gap={4}>
          <Text color="secondary">{T.calc.lead}</Text>
          <TireCalculator value={calc} onChange={setCalc} />
          <Button label={T.calc.choose} variant="primary" size="lg" width="100%" onClick={() => flow.open(calc.serviceId, calc)} />
        </VStack>
      </Card>
    </RevealSection>
  );
}

/** Price list: every operation for the chosen vehicle and rims, «from – to» over the diameters. */
export function TirePricesSection() {
  const t = useTenant();
  const T = tireMsg();
  const [vehicle, setVehicle] = useState<Vehicle>('car');
  const [rim, setRim] = useState<Rim>('alloy');
  const ops = tireServices(t);
  if (!ops.length || !t.tire) return null;
  const names = t.tire.names;
  return (
    <RevealSection title={T.home.pricesTitle} id="tire-prices-title">
      <Text color="secondary">{T.home.pricesLead}</Text>
      <HStack gap={2} wrap="wrap">
        <SegmentedControl label={T.calc.vehicle} value={vehicle} onChange={v => setVehicle(v as Vehicle)}>
          {VEHICLES.map(v => (
            <SegmentedControlItem key={v} value={v} label={names.vehicles[v]} />
          ))}
        </SegmentedControl>
        <SegmentedControl label={T.calc.rim} value={rim} onChange={v => setRim(v as Rim)}>
          {RIMS.map(r => (
            <SegmentedControlItem key={r} value={r} label={names.rims[r]} />
          ))}
        </SegmentedControl>
      </HStack>
      <List hasDividers>
        {ops.map(({service, op}) => {
          const r = priceRange(op, vehicle, rim);
          const price = !r || (!r.min && !r.max) ? T.calc.onRequest : T.home.range(formatMoney(r.min, t.currency), formatMoney(r.max, t.currency));
          return (
            <ListItem
              key={service.id}
              label={service.name}
              description={[service.description, r?.onRequest && r.max ? T.home.partlyOnRequest : ''].filter(Boolean).join(' · ')}
              endContent={
                <VStack gap={0} align="end">
                  <Text weight="semibold" hasTabularNumbers textWrap="nowrap">
                    {price}
                  </Text>
                  <Text type="supporting" textWrap="nowrap">
                    {op.unit === 'set' ? T.calc.forWheels(4) : T.calc.perJob}
                  </Text>
                </VStack>
              }
            />
          );
        })}
      </List>
    </RevealSection>
  );
}

/** The running or next tyre season, the booking horizon in season and the tyre hotel. */
export function TireSeasonSection() {
  const t = useTenant();
  const T = tireMsg();
  const seasons = t.tire_seasons ?? [];
  if (!t.tire || (!seasons.length && !t.tire.storage)) return null;
  const today = todayIn(t.timezone);
  const next = currentOrNextSeason(seasons, today);
  const fmtDay = (iso: string) => monthDay(iso.slice(5));
  return (
    <RevealSection title={T.home.seasonTitle} id="season-title">
      <VStack gap={3}>
        {next && (
          <Card padding={4}>
            <HStack gap={3} align="start">
              <Icon icon={next.season.mount === 'winter' ? Snowflake : Sun} color="accent" size="lg" />
              <VStack gap={1}>
                <Text weight="semibold">
                  {next.startsInDays === 0
                    ? T.home.seasonNow(fmtDay(next.end), T.mountTo[next.season.mount]!)
                    : T.home.seasonNext(fmtDay(next.start), T.mountTo[next.season.mount]!)}
                </Text>
                {next.season.horizonDays ? <Text color="secondary">{T.home.seasonHorizon(next.season.horizonDays)}</Text> : null}
                <Text type="supporting">{T.home.seasonList(seasons.map(s => `${monthDay(s.from)}–${monthDay(s.to)}`).join(', '))}</Text>
              </VStack>
            </HStack>
          </Card>
        )}
        {t.tire.storage && (
          <Card padding={4}>
            <HStack gap={3} align="start">
              <Icon icon={Warehouse} color="accent" size="lg" />
              <VStack gap={2}>
                <Text weight="semibold">{T.home.storageTitle}</Text>
                <Text color="secondary">{T.home.storageText}</Text>
              </VStack>
            </HStack>
          </Card>
        )}
      </VStack>
    </RevealSection>
  );
}
