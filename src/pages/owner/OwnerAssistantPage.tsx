import {Heading} from '@astryxdesign/core/Heading';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {useLayoutEffect, useRef, useState} from 'react';
import {AssistantChat} from '../../components/AssistantChat.tsx';
import {BOTTOM_NAV_SPACE} from '../../components/BottomNav.tsx';
import {msg} from '../../i18n/index.ts';
import {useMatchMedia} from '../../lib/motion.ts';
import {useOwner} from './ownerContext.tsx';

export default function OwnerAssistantPage() {
  const {slug, session} = useOwner();
  // The chat scrolls inside itself and needs a definite height: from its top
  // to the bottom bar on phones, to the page padding on wide screens.
  const wide = useMatchMedia('(min-width: 720px)');
  const box = useRef<HTMLElement | null>(null);
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    const measure = () => setTop(Math.max(0, (box.current?.getBoundingClientRect().top ?? 0) + window.scrollY));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [wide]);
  return (
    <VStack ref={box} width="100%" style={{height: `calc(100svh - ${top}px - ${wide ? 'var(--spacing-8)' : BOTTOM_NAV_SPACE})`, minHeight: 360}}>
      <AssistantChat
        key={session.user.id}
        endpoint="owner-assistant"
        slug={slug}
        token={session.access_token}
        examples={msg.ownerAssistant.examples}
        intro={msg.ownerAssistant.intro}
        header={
          <VStack gap={1}>
            <Heading level={1}>{msg.ownerAssistant.title}</Heading>
            <Text color="secondary">{msg.ownerAssistant.lead}</Text>
          </VStack>
        }
      />
    </VStack>
  );
}
