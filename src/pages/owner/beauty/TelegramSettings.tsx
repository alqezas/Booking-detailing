import {Banner} from '@astryxdesign/core/Banner';
import {Badge} from '@astryxdesign/core/Badge';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {List, ListItem} from '@astryxdesign/core/List';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {VStack} from '@astryxdesign/core/VStack';
import {useToast} from '@astryxdesign/core/Toast';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useEffect, useState} from 'react';
import {useTenant} from '../../../app/tenant.tsx';
import {InlineError, RowsSkeleton} from '../../../components/StatusScreens.tsx';
import {beautyMsg} from '../../../i18n/beauty.ts';
import {errorText} from '../../../lib/errors.ts';
import {formatWhen} from '../../../lib/format.ts';
import {ownerKey, useOwner} from '../ownerContext.tsx';

const STATUS_VARIANT: Record<string, 'success' | 'error' | 'neutral' | 'warning' | 'info'> = {
  sent: 'success',
  failed: 'error',
  skipped: 'neutral',
  cancelled: 'neutral',
  pending: 'info',
  processing: 'warning',
};

/**
 * Telegram chat for instant notices (new booking, move, cancellation by a
 * client). The delivery state is read from the outbox, so the owner sees what
 * really happened — «skipped» in a preview, an error text if the bot failed.
 */
export function TelegramSettings() {
  const {api, slug} = useOwner();
  const t = useTenant();
  const B = beautyMsg().owner.telegram;
  const qc = useQueryClient();
  const showToast = useToast();
  const q = useQuery({queryKey: ownerKey(slug, 'notify-status'), queryFn: () => api.notificationStatus(), refetchInterval: 30_000});
  const [chat, setChat] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (q.data) setChat(q.data.telegram_chat_id ?? '');
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => api.setTelegram(chat.trim()),
    onSuccess: d => {
      qc.setQueryData(ownerKey(slug, 'notify-status'), d);
      setError(null);
      showToast({body: d.telegram_chat_id ? B.saved : B.cleared});
    },
    onError: e => setError(errorText(e)),
  });
  if (q.isPending) return <RowsSkeleton rows={2} />;
  if (q.isError) return <InlineError message={q.error.message} onRetry={() => void q.refetch()} />;
  return (
    <Card padding={4}>
      <VStack gap={3}>
        <Heading level={2}>{B.title}</Heading>
        <Text color="secondary">{B.lead}</Text>
        {q.data.tenant_status !== 'live' && <Banner status="info" title={B.previewNote} collapsible={false} />}
        {error && <Banner status="error" title={error} collapsible={false} />}
        <HStack gap={2} align="end" wrap="wrap">
          <TextInput label={B.chatId} description={B.chatIdHint} value={chat} onChange={setChat} placeholder="123456789" width={320} />
          <Button label={B.save} variant="primary" isLoading={save.isPending} onClick={() => save.mutate()} />
        </HStack>
        <Text weight="semibold">{B.recent}</Text>
        {q.data.recent.length === 0 ? (
          <Text color="secondary">{B.none}</Text>
        ) : (
          <List hasDividers>
            {q.data.recent.map((r, i) => (
              <ListItem
                key={i}
                label={B.kinds[r.kind] ?? r.kind}
                description={[formatWhen(r.created_at, t.timezone), r.last_error].filter(Boolean).join(' · ')}
                endContent={<Badge label={B.statuses[r.status] ?? r.status} variant={STATUS_VARIANT[r.status] ?? 'neutral'} />}
              />
            ))}
          </List>
        )}
      </VStack>
    </Card>
  );
}
