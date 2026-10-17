import {MetadataList, MetadataListItem} from '@astryxdesign/core/MetadataList';
import {Text} from '@astryxdesign/core/Text';
import {fmt, formatDuration, formatPhone, formatPrice, formatTime, formatWhen} from '../../lib/format.ts';
import {msg} from '../../i18n/index.ts';

type Props = {
  serviceName: string;
  price: number;
  priceFrom: boolean;
  durationMinutes: number;
  startAt: string;
  endAt?: string;
  timezone: string;
  currency: string;
  customer?: {name: string; phone: string; car: string};
  bay?: string;
};

export function BookingSummary(p: Props) {
  return (
    <MetadataList>
      <MetadataListItem label={msg.summary.service}>
        <Text weight="semibold">{p.serviceName}</Text>
      </MetadataListItem>
      <MetadataListItem label={msg.summary.when}>
        <Text>
          {formatWhen(p.startAt, p.timezone)}
          {p.endAt && p.durationMinutes >= 1440
            ? msg.summary.carStays(fmt(p.endAt, p.timezone, msg.fmt.dayMonth))
            : p.endAt
              ? `–${formatTime(p.endAt, p.timezone)}`
              : ''}
        </Text>
      </MetadataListItem>
      <MetadataListItem label={msg.summary.duration}>
        <Text>{formatDuration(p.durationMinutes)}</Text>
      </MetadataListItem>
      <MetadataListItem label={msg.summary.price}>
        <Text hasTabularNumbers>{formatPrice(p.price, p.priceFrom, p.currency)}</Text>
      </MetadataListItem>
      {p.bay && (
        <MetadataListItem label={msg.summary.bay}>
          <Text>{p.bay}</Text>
        </MetadataListItem>
      )}
      {p.customer && (
        <>
          <MetadataListItem label={msg.summary.client}>
            <Text>{p.customer.name}</Text>
          </MetadataListItem>
          <MetadataListItem label={msg.summary.phone}>
            {/* Never break a phone number across lines. */}
            <Text textWrap="nowrap">{formatPhone(p.customer.phone)}</Text>
          </MetadataListItem>
          <MetadataListItem label={msg.summary.car}>
            <Text>{p.customer.car}</Text>
          </MetadataListItem>
        </>
      )}
    </MetadataList>
  );
}
