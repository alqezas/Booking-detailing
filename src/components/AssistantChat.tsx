import {Button} from '@astryxdesign/core/Button';
import {ChatComposer, ChatLayout, ChatMessage, ChatMessageBubble, ChatMessageList, ChatSystemMessage} from '@astryxdesign/core/Chat';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {HStack} from '@astryxdesign/core/HStack';
import {Icon} from '@astryxdesign/core/Icon';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {ChatCircleDots} from '@phosphor-icons/react';
import {useMutation} from '@tanstack/react-query';
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {env} from '../lib/env.ts';
import {ApiError, toApiError} from '../lib/errors.ts';

type Turn = {role: 'user' | 'assistant'; content: string; data?: {options?: string[]; slots?: {start_at: string; label: string}[]; service_id?: string}; notice?: string};

export type AssistantReply = {text: string; mode: 'tools' | 'json' | 'fallback'; tools: string[]; data?: Turn['data']; notice?: string};

async function askAssistant(endpoint: string, token: string | null, body: unknown): Promise<AssistantReply> {
  let res: Response;
  try {
    res = await fetch(`${env.functionsUrl}/${endpoint}`, {
      method: 'POST',
      headers: {'content-type': 'application/json', apikey: env.supabaseAnonKey, authorization: `Bearer ${token ?? env.supabaseAnonKey}`},
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw toApiError(e);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(json?.error ?? 'ASSISTANT_ERROR', json?.message ?? 'Помощник сейчас недоступен. Запись работает как обычно.', res.status);
  return json as AssistantReply;
}

type Props = {
  endpoint: 'assistant' | 'owner-assistant';
  slug: string;
  token?: string | null;
  examples: string[];
  intro: string;
  initialQuestion?: string | null;
  /** Client: open booking for a service the assistant found time for. */
  onBook?: (serviceId: string) => void;
  header?: ReactNode;
};

export function AssistantChat({endpoint, slug, token = null, examples, intro, initialQuestion, onBook, header}: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const sentInitial = useRef(false);

  const ask = useMutation({
    mutationFn: (message: string) =>
      askAssistant(endpoint, token, {slug, message, history: turns.slice(-8).map(t => ({role: t.role, content: t.content}))}),
    onSuccess: r => setTurns(t => [...t, {role: 'assistant', content: r.text, data: r.data, notice: r.notice}]),
  });

  const send = (text: string) => {
    const q = text.trim();
    if (!q || ask.isPending) return;
    setTurns(t => [...t, {role: 'user', content: q}]);
    setDraft('');
    ask.mutate(q);
  };

  useEffect(() => {
    if (initialQuestion && !sentInitial.current) {
      sentInitial.current = true;
      send(initialQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  const chips = (list: string[]) => (
    <HStack gap={2} wrap="wrap">
      {list.map(q => (
        <Button key={q} label={q} size="sm" isDisabled={ask.isPending} onClick={() => send(q)} />
      ))}
    </HStack>
  );

  return (
    <ChatLayout
      density="balanced"
      composer={
        <ChatComposer
          value={draft}
          onChange={setDraft}
          onSubmit={send}
          placeholder="Напишите вопрос…"
          isDisabled={ask.isPending}
          status={ask.isError ? {type: 'error', message: toApiError(ask.error).message} : undefined}
        />
      }
    >
      <ChatMessageList
        isStreaming={ask.isPending}
        emptyState={
          <VStack gap={4} padding={4}>
            {header}
            <EmptyState isCompact icon={<Icon icon={ChatCircleDots} />} title="Помощник" description={intro} />
            {chips(examples)}
          </VStack>
        }
      >
        {turns.map((t, i) => (
          <ChatMessage key={i} sender={t.role} name={t.role === 'user' ? 'Вы' : 'Помощник'}>
            <ChatMessageBubble>
              <Text>{t.content}</Text>
            </ChatMessageBubble>
            {t.notice && <Text type="supporting">{t.notice}</Text>}
            {t.data?.options && t.data.options.length > 0 && chips(t.data.options)}
            {onBook && t.data?.service_id && t.data.slots && t.data.slots.length > 0 && (
              <Button label="Записаться на это время" variant="primary" size="sm" onClick={() => onBook(t.data!.service_id!)} />
            )}
          </ChatMessage>
        ))}
        {ask.isPending && <ChatSystemMessage>Помощник проверяет данные…</ChatSystemMessage>}
      </ChatMessageList>
    </ChatLayout>
  );
}
