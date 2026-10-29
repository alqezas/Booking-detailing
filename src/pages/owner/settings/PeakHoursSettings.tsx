import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {CheckboxList, CheckboxListItem} from '@astryxdesign/core/CheckboxList';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {NumberInput} from '@astryxdesign/core/NumberInput';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {Text} from '@astryxdesign/core/Text';
import {TimeInput, type ISOTimeString} from '@astryxdesign/core/TimeInput';
import {VStack} from '@astryxdesign/core/VStack';
import {useToast} from '@astryxdesign/core/Toast';
import {useMutation} from '@tanstack/react-query';
import {useState} from 'react';
import {useTenant} from '../../../app/tenant.tsx';
import {washMsg, weekdayShort} from '../../../i18n/wash.ts';
import {errorText} from '../../../lib/errors.ts';
import type {PeakRule} from '../../../../supabase/functions/_shared/wash.ts';
import {useOwner} from '../ownerContext.tsx';
import {useRefreshStudio} from './shared.tsx';

/** Peak hours: windows where online booking is closed (walk-ins only) or limited to N posts. */
export function PeakHoursSettings() {
  const tenant = useTenant();
  const {api} = useOwner();
  const refresh = useRefreshStudio();
  const showToast = useToast();
  const P = washMsg().peak;
  const names = weekdayShort();
  const [rules, setRules] = useState<PeakRule[]>(() => tenant.peak_hours ?? []);
  const save = useMutation({
    mutationFn: () => api.setPeakHours(rules.map(r => ({...r, posts: r.mode === 'limit' ? (r.posts ?? 1) : null}))),
    onSuccess: () => {
      refresh();
      showToast({body: P.saved});
    },
  });
  const set = (i: number, patch: Partial<PeakRule>) => setRules(rs => rs.map((r, j) => (j === i ? {...r, ...patch} : r)));

  return (
    <Card padding={4}>
      <VStack gap={4}>
        <VStack gap={1}>
          <Heading level={2}>{P.title}</Heading>
          <Text color="secondary">{P.lead}</Text>
        </VStack>
        {rules.map((r, i) => (
          <VStack key={i} gap={2}>
            <CheckboxList label={P.days} value={r.days.map(String)} onChange={v => set(i, {days: v.map(Number).sort()})}>
              {names.map((n, d) => (
                <CheckboxListItem key={d} value={String(d + 1)} label={n} />
              ))}
            </CheckboxList>
            <HStack gap={2} wrap="wrap" align="end">
              <TimeInput label={P.from} value={r.from as ISOTimeString} onChange={v => v && set(i, {from: v})} hourFormat="24h" />
              <TimeInput label={P.to} value={r.to as ISOTimeString} onChange={v => v && set(i, {to: v})} hourFormat="24h" />
            </HStack>
            <SegmentedControl label={P.title} value={r.mode} onChange={v => set(i, {mode: v as PeakRule['mode']})} layout="fill">
              <SegmentedControlItem value="walkin" label={P.walkin} />
              <SegmentedControlItem value="limit" label={P.limit} />
            </SegmentedControl>
            {r.mode === 'limit' && <NumberInput label={P.posts} value={r.posts ?? 1} onChange={v => set(i, {posts: v ?? 1})} min={1} max={20} step={1} width={160} />}
            <Button label={P.remove} variant="ghost" onClick={() => setRules(rs => rs.filter((_, j) => j !== i))} />
          </VStack>
        ))}
        {rules.length < 10 && (
          <Button label={P.add} variant="secondary" onClick={() => setRules(rs => [...rs, {days: [6], from: '08:00', to: '12:00', mode: 'walkin', posts: null}])} />
        )}
        {save.isError && <Banner status="error" title={errorText(save.error)} collapsible={false} />}
        <Button label={P.save} variant="primary" isLoading={save.isPending} onClick={() => save.mutate()} />
      </VStack>
    </Card>
  );
}
