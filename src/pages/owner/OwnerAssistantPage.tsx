import {Heading} from '@astryxdesign/core/Heading';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {AssistantChat} from '../../components/AssistantChat.tsx';
import {useOwner} from './ownerContext.tsx';

const EXAMPLES = ['Что у меня завтра?', 'Сколько машин было на неделе?', 'Сколько денег получено?'];

export default function OwnerAssistantPage() {
  const {slug, session} = useOwner();
  return (
    <VStack width="100%" style={{minHeight: 'calc(100dvh - 140px)'}}>
      <AssistantChat
        key={session.user.id}
        endpoint="owner-assistant"
        slug={slug}
        token={session.access_token}
        examples={EXAMPLES}
        intro="Отвечаю по записям и оплатам вашей студии. Только читаю данные — изменения делаются в разделе «Записи»."
        header={
          <VStack gap={1}>
            <Heading level={1}>Помощник владельца</Heading>
            <Text color="secondary">Записи, заезды и полученные деньги</Text>
          </VStack>
        }
      />
    </VStack>
  );
}
