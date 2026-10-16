import {Heading} from '@astryxdesign/core/Heading';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {useLayoutEffect, useRef, useState} from 'react';
import {useSearchParams} from 'react-router';
import {useTenant} from '../../app/tenant.tsx';
import {BOTTOM_NAV_SPACE} from '../../components/BottomNav.tsx';
import {AssistantChat} from '../../components/AssistantChat.tsx';
import {useBookingFlow} from '../../components/booking/BookingFlow.tsx';
import {ASSISTANT_EXAMPLES} from '../../components/home/Sections.tsx';
import {InlineEmpty} from '../../components/StatusScreens.tsx';
import {GUTTER, TEXT_MAX_WIDTH} from '../../components/layout/Page.tsx';

export default function AssistantPage() {
  const t = useTenant();
  const flow = useBookingFlow();
  const [params] = useSearchParams();
  // The chat scrolls inside itself; it ends exactly where the bottom bar begins.
  const box = useRef<HTMLElement | null>(null);
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    const measure = () => setTop(Math.max(0, (box.current?.getBoundingClientRect().top ?? 0) + window.scrollY));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  if (!t.assistant_enabled) {
    return <InlineEmpty title="Помощник выключен" description={`Позвоните в студию: ${t.phone}`} />;
  }
  return (
    <VStack
      ref={box}
      maxWidth={TEXT_MAX_WIDTH}
      width="100%"
      style={{
        marginInline: 'auto',
        height: `calc(100svh - ${top}px - ${BOTTOM_NAV_SPACE})`,
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingInline: `calc(${GUTTER} - var(--spacing-4))`,
      }}
    >
      <AssistantChat
        endpoint="assistant"
        slug={t.slug}
        examples={ASSISTANT_EXAMPLES}
        intro="Спросите о ценах, свободном времени или как нас найти. Отвечаю только по данным студии."
        initialQuestion={params.get('q')}
        onBook={id => flow.open(id)}
        header={
          <VStack gap={1}>
            <Heading level={1}>Помощник</Heading>
            <Text color="secondary">{t.name}</Text>
          </VStack>
        }
      />
    </VStack>
  );
}
