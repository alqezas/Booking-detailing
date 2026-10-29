import {Card} from '@astryxdesign/core/Card';
import {Heading} from '@astryxdesign/core/Heading';
import {List, ListItem} from '@astryxdesign/core/List';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {useQuery} from '@tanstack/react-query';
import {fromZonedTime} from 'date-fns-tz';
import {useTenant} from '../../app/tenant.tsx';
import {washMsg} from '../../i18n/wash.ts';
import {formatTime, todayIn} from '../../lib/format.ts';
import type {OwnerBooking} from '../../lib/types.ts';
import {ownerKey, useOwner} from './ownerContext.tsx';

type Row = {id: string; name: string; is_active: boolean};

/**
 * Today on every post: how many jobs and from when it is free — the owner's
 * view for putting a walk-in somewhere. Busy = a booking that is not cancelled
 * or a no-show; back-to-back jobs are chained.
 */
export function PostsLoad() {
  const tenant = useTenant();
  const {api, slug} = useOwner();
  const W = washMsg();
  const today = todayIn(tenant.timezone);
  const from = fromZonedTime(`${today}T00:00:00`, tenant.timezone).toISOString();
  const to = fromZonedTime(`${today}T23:59:59`, tenant.timezone).toISOString();
  const resources = useQuery({queryKey: ownerKey(slug, 'resources'), queryFn: () => api.resources() as Promise<Row[]>});
  const bookings = useQuery({queryKey: ownerKey(slug, 'posts-today', today), queryFn: () => api.bookings(from, to), refetchInterval: 60_000});
  if (!resources.data || !bookings.data) return null;
  const now = Date.now();
  const live = bookings.data.filter(b => b.status !== 'cancelled' && b.status !== 'no_show');

  const freeFrom = (list: OwnerBooking[]): number => {
    let t = now;
    for (const b of list.sort((a, c) => a.start_at.localeCompare(c.start_at))) {
      if (Date.parse(b.start_at) <= t && Date.parse(b.occupancy_end_at) > t) t = Date.parse(b.occupancy_end_at);
    }
    return t;
  };

  return (
    <Card padding={4}>
      <VStack gap={2}>
        <Heading level={2}>{W.load.title}</Heading>
        <List hasDividers>
          {resources.data
            .filter(r => r.is_active)
            .map(r => {
              const mine = live.filter(b => b.resource_id === r.id);
              const free = freeFrom(mine);
              return (
                <ListItem
                  key={r.id}
                  label={r.name}
                  description={W.load.jobs(mine.length)}
                  endContent={
                    <Text weight="semibold" color={free <= now ? 'accent' : 'secondary'} textWrap="nowrap">
                      {free <= now ? W.load.freeNow : W.load.freeFrom(formatTime(new Date(free).toISOString(), tenant.timezone))}
                    </Text>
                  }
                />
              );
            })}
        </List>
      </VStack>
    </Card>
  );
}
