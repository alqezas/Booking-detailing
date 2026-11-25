/**
 * Telegram bot card: connect the bot (sets its webhook) and see / disconnect the
 * chats that receive order notifications. A chat is added only by signing in in
 * the bot with an admin's email and password.
 */
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {VStack} from '@astryxdesign/core/Layout';
import {List, ListItem} from '@astryxdesign/core/List';
import {Heading, Text} from '@astryxdesign/core/Text';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {kyivDateTime} from '../../lib/format.ts';
import {admin} from '../../lib/supabase.ts';

type Chat = {chat_id: number; tg_username: string | null; tg_name: string | null; linked_at: string};

export function TelegramCard() {
  const qc = useQueryClient();
  const chats = useQuery({
    queryKey: ['admin-telegram-chats'],
    queryFn: async () => {
      const {data, error} = await admin().from('telegram_chats').select('chat_id,tg_username,tg_name,linked_at').order('linked_at');
      if (error) throw error;
      return data as Chat[];
    },
    refetchInterval: 15_000,
  });
  const connect = useMutation({
    mutationFn: async () => {
      const {data, error} = await admin().functions.invoke('telegram', {body: {action: 'setup'}});
      if (error) {
        const code = await (error as {context?: Response}).context?.json?.().then((b: {error?: string}) => b.error).catch(() => undefined);
        throw new Error(code === 'TELEGRAM_NOT_CONFIGURED' ? 'Токен бота ще не додано в налаштування сервера (TELEGRAM_BOT_TOKEN).' : 'Не вдалося підключити бота. Перевірте токен і спробуйте ще раз.');
      }
      return data as {username: string};
    },
  });
  const disconnect = useMutation({
    mutationFn: async (chatId: number) => {
      const {error} = await admin().from('telegram_chats').delete().eq('chat_id', chatId);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({queryKey: ['admin-telegram-chats']}),
  });
  const bot = connect.data?.username;

  return (
    <Card padding={5}>
      <VStack gap={3}>
        <Heading level={2}>Telegram-бот: сповіщення про замовлення</Heading>
        <Text type="body" color="secondary">
          Бот пише про кожне нове замовлення та онлайн-оплату. Сповіщення отримує лише той, хто увійшов у боті з email і паролем від цієї адмінки.
        </Text>
        <Button label={bot ? 'Бот підключено' : 'Підключити бота'} variant={bot ? 'secondary' : 'primary'} isLoading={connect.isPending} onClick={() => connect.mutate()} />
        {connect.isError && <Banner status="error" title={connect.error.message} collapsible={false} />}
        {bot && (
          <Banner
            status="success"
            title={`Бот готовий: @${bot}`}
            description="Відкрийте бота, натисніть «Старт» і надішліть email та пароль від адмінки. Повідомлення з паролем бот одразу видаляє."
            collapsible={false}
            endContent={<Button label="Відкрити бота" size="sm" href={`https://t.me/${bot}`} target="_blank" rel="noopener" />}
          />
        )}
        {chats.data && chats.data.length > 0 ? (
          <List header={<Text type="label">Отримують сповіщення</Text>} hasDividers>
            {chats.data.map(c => (
              <ListItem
                key={c.chat_id}
                label={c.tg_name ?? (c.tg_username ? `@${c.tg_username}` : `Чат ${c.chat_id}`)}
                description={`${c.tg_username ? `@${c.tg_username} · ` : ''}підключено ${kyivDateTime(c.linked_at)}`}
                endContent={<Button label="Відключити" size="sm" variant="ghost" isLoading={disconnect.isPending && disconnect.variables === c.chat_id} onClick={() => disconnect.mutate(c.chat_id)} />}
              />
            ))}
          </List>
        ) : (
          chats.data && (
            <Text type="supporting" color="secondary">
              Поки жоден чат не підключено.
            </Text>
          )
        )}
      </VStack>
    </Card>
  );
}
