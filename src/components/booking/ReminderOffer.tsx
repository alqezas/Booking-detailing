import {Button} from '@astryxdesign/core/Button';
import {HStack} from '@astryxdesign/core/HStack';
import {Icon} from '@astryxdesign/core/Icon';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {BellRinging, CalendarPlus, CheckCircle, GoogleLogo} from '@phosphor-icons/react';
import {useMutation, useQueryClient} from '@tanstack/react-query';
import {useState, type ReactNode} from 'react';
import {errorText} from '../../lib/errors.ts';
import {formatWhen} from '../../lib/format.ts';
import {downloadIcs, googleCalendarUrl, type IcsInput} from '../../lib/ics.ts';
import {enableReminder, pushSupport} from '../../lib/push.ts';
import {bookingKey} from '../../lib/queries.ts';
import type {PublicBooking} from '../../lib/types.ts';

/**
 * After booking: offer a reminder 24 h before. Web Push where it really
 * works; otherwise — and always as an extra — a calendar event. The text
 * says plainly which channel is active; nothing pretends to be enabled.
 */
export function ReminderOffer({booking, token}: {booking: PublicBooking; token: string}) {
  const qc = useQueryClient();
  const [support] = useState(pushSupport);
  const slug = booking.tenant.slug;
  const tz = booking.tenant.timezone;
  const within24h = new Date(booking.start_at).getTime() - Date.now() < 24 * 3600_000;
  const enable = useMutation({
    mutationFn: () => enableReminder(slug, token),
    onSuccess: b => qc.setQueryData(bookingKey(slug, token), b),
  });
  const reminder = enable.data?.reminder ?? booking.reminder;

  const ics: IcsInput = {
    uid: `${booking.id}@studio-booking`,
    title: `${booking.service_name} — ${booking.tenant.name}`,
    start: booking.start_at,
    end: booking.end_at,
    location: booking.tenant.address,
    description: `Телефон студии: ${booking.tenant.phone}`,
  };
  const calendarButtons = (
    <HStack gap={2} wrap="wrap">
      <Button label="Добавить в календарь" icon={<Icon icon={CalendarPlus} />} onClick={() => downloadIcs(ics, 'zapis-v-studiyu.ics')} />
      <Button label="Google Календарь" variant="ghost" icon={<Icon icon={GoogleLogo} />} href={googleCalendarUrl(ics)} target="_blank" />
    </HStack>
  );

  let status: string;
  let action: ReactNode = null;
  if (booking.status !== 'confirmed') {
    return null;
  } else if (booking.tenant.status !== 'live' || booking.is_demo) {
    status = 'В образце приложения напоминания не отправляются. Можно добавить запись в календарь.';
  } else if (reminder?.status === 'pending' || reminder?.status === 'sent') {
    status = `Напоминание включено: придёт ${formatWhen(reminder.run_at, tz)}.`;
  } else if (within24h) {
    status = 'До записи меньше суток — добавьте её в календарь, чтобы не забыть.';
  } else if (support === 'available' || support === 'granted') {
    status = 'Пришлём уведомление за сутки до записи.';
    action = (
      <Button
        label="Напомнить за сутки"
        variant="primary"
        icon={<Icon icon={BellRinging} />}
        isLoading={enable.isPending}
        onClick={() => enable.mutate()}
      />
    );
  } else if (support === 'needs-install') {
    status = 'На iPhone уведомления работают, когда приложение добавлено на экран «Домой» (Поделиться → На экран «Домой»). Пока можно добавить запись в календарь.';
  } else if (support === 'denied') {
    status = 'Уведомления запрещены в настройках браузера. Добавьте запись в календарь — он напомнит сам.';
  } else {
    status = 'Этот браузер не поддерживает уведомления. Добавьте запись в календарь — он напомнит за сутки.';
  }

  return (
    <VStack gap={3}>
      <HStack gap={2} align="start">
        <Icon icon={reminder?.status === 'pending' ? CheckCircle : BellRinging} color={reminder?.status === 'pending' ? 'success' : 'secondary'} />
        <Text>{status}</Text>
      </HStack>
      {enable.isError && (
        <Text color="accent" role="alert">
          {errorText(enable.error)}
        </Text>
      )}
      {action}
      {calendarButtons}
    </VStack>
  );
}
