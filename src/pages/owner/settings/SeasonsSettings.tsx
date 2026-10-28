import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {NumberInput} from '@astryxdesign/core/NumberInput';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {VStack} from '@astryxdesign/core/VStack';
import {useToast} from '@astryxdesign/core/Toast';
import {useMutation} from '@tanstack/react-query';
import {useState} from 'react';
import {useTenant} from '../../../app/tenant.tsx';
import {monthDay, tireMsg} from '../../../i18n/tire.ts';
import {errorText} from '../../../lib/errors.ts';
import {MOUNT_SEASONS, parseDayMonth, type MountSeason, type SeasonPeriod} from '../../../../supabase/functions/_shared/tire.ts';
import {useOwner} from '../ownerContext.tsx';
import {useRefreshStudio} from './shared.tsx';

type Row = {from: string; to: string; mount: MountSeason; horizonDays: number | null};

/** Tyre seasons: when the seasonal posts work and how far ahead customers may book. */
export function SeasonsSettings() {
  const tenant = useTenant();
  const {api} = useOwner();
  const refresh = useRefreshStudio();
  const showToast = useToast();
  const T = tireMsg().seasonsSettings;
  const names = tireMsg().mountTo;
  const [rows, setRows] = useState<(Row & {fromText: string; toText: string})[]>(() =>
    (tenant.tire_seasons ?? []).map(s => ({
      from: s.from,
      to: s.to,
      mount: s.mount,
      horizonDays: s.horizonDays ?? null,
      fromText: monthDay(s.from).replace(/\.$/, ''),
      toText: monthDay(s.to).replace(/\.$/, ''),
    })),
  );
  const [invalid, setInvalid] = useState(false);

  const save = useMutation({
    mutationFn: () => {
      const parsed: SeasonPeriod[] = [];
      for (const r of rows) {
        const from = parseDayMonth(r.fromText);
        const to = parseDayMonth(r.toText);
        if (!from || !to) throw new Error(T.invalid);
        parsed.push({from, to, mount: r.mount, horizonDays: r.horizonDays});
      }
      return api.setTireSeasons(parsed);
    },
    onSuccess: () => {
      setInvalid(false);
      refresh();
      showToast({body: T.saved});
    },
    onError: e => setInvalid((e as Error).message === T.invalid),
  });

  const set = (i: number, patch: Partial<Row & {fromText: string; toText: string}>) => setRows(rs => rs.map((r, j) => (j === i ? {...r, ...patch} : r)));

  return (
    <Card padding={4}>
      <VStack gap={4}>
        <VStack gap={1}>
          <Heading level={2}>{T.title}</Heading>
          <Text color="secondary">{T.lead}</Text>
        </VStack>
        {rows.map((r, i) => (
          <VStack key={i} gap={2}>
            <HStack gap={2} wrap="wrap" align="end">
              <TextInput label={T.from} value={r.fromText} onChange={v => set(i, {fromText: v})} placeholder="15.10" width={120} />
              <TextInput label={T.to} value={r.toText} onChange={v => set(i, {toText: v})} placeholder="30.11" width={120} />
              <NumberInput
                label={T.horizon}
                description={T.horizonHint}
                value={r.horizonDays}
                onChange={v => set(i, {horizonDays: v ?? null})}
                min={1}
                max={120}
                width={180}
                hasClear
              />
            </HStack>
            <HStack gap={2} align="end" wrap="wrap">
              <SegmentedControl label={T.mount} value={r.mount} onChange={v => set(i, {mount: v as MountSeason})}>
                {MOUNT_SEASONS.map(m => (
                  <SegmentedControlItem key={m} value={m} label={names[m]!} />
                ))}
              </SegmentedControl>
              <Button label={T.remove} variant="ghost" onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} />
            </HStack>
          </VStack>
        ))}
        {rows.length < 4 && (
          <Button
            label={T.add}
            variant="secondary"
            onClick={() => setRows(rs => [...rs, {from: '', to: '', fromText: '', toText: '', mount: rs.at(-1)?.mount === 'winter' ? 'summer' : 'winter', horizonDays: null}])}
          />
        )}
        {(invalid || save.isError) && <Banner status="error" title={invalid ? T.invalid : errorText(save.error)} collapsible={false} />}
        <Button label={T.save} variant="primary" isLoading={save.isPending} onClick={() => save.mutate()} />
      </VStack>
    </Card>
  );
}
