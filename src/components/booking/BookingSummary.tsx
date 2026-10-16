import {MetadataList, MetadataListItem} from '@astryxdesign/core/MetadataList';
import {Text} from '@astryxdesign/core/Text';
import {fmt, formatDuration, formatPhone, formatPrice, formatTime, formatWhen} from '../../lib/format.ts';

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
      <MetadataListItem label="Услуга">
        <Text weight="semibold">{p.serviceName}</Text>
      </MetadataListItem>
      <MetadataListItem label="Когда">
        <Text>
          {formatWhen(p.startAt, p.timezone)}
          {p.endAt && p.durationMinutes >= 1440
            ? ` (машина у нас до ${fmt(p.endAt, p.timezone, 'd MMMM')})`
            : p.endAt
              ? `–${formatTime(p.endAt, p.timezone)}`
              : ''}
        </Text>
      </MetadataListItem>
      <MetadataListItem label="Длительность">
        <Text>{formatDuration(p.durationMinutes)}</Text>
      </MetadataListItem>
      <MetadataListItem label="Стоимость">
        <Text hasTabularNumbers>{formatPrice(p.price, p.priceFrom, p.currency)}</Text>
      </MetadataListItem>
      {p.bay && (
        <MetadataListItem label="Бокс">
          <Text>{p.bay}</Text>
        </MetadataListItem>
      )}
      {p.customer && (
        <MetadataListItem label="Клиент">
          <Text>
            {p.customer.name}, {formatPhone(p.customer.phone)}, {p.customer.car}
          </Text>
        </MetadataListItem>
      )}
    </MetadataList>
  );
}
