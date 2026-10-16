import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {HStack} from '@astryxdesign/core/HStack';
import {Icon} from '@astryxdesign/core/Icon';
import {Section} from '@astryxdesign/core/Section';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {DeviceMobile, Export} from '@phosphor-icons/react';
import {useInstallOffer} from '../lib/pwa.ts';

/** Optional: put the studio on the home screen. Never blocks anything. */
export function InstallHint() {
  const offer = useInstallOffer();
  if (!offer.kind) return null;
  return (
    <Section variant="transparent" padding={4}>
      <Card padding={4} variant="muted">
        <HStack gap={3} align="start">
          <Icon icon={DeviceMobile} color="accent" />
          <VStack gap={2}>
            <Text weight="semibold">Приложение на экране телефона</Text>
            {offer.kind === 'prompt' ? (
              <>
                <Text color="secondary">Откроется без адресной строки, со значком студии.</Text>
                <Button label="Установить" size="sm" onClick={() => void offer.install()} />
              </>
            ) : (
              <HStack gap={1} align="center" wrap="wrap">
                <Text color="secondary">В Safari нажмите</Text>
                <Icon icon={Export} label="«Поделиться»" />
                <Text color="secondary">→ «На экран „Домой“».</Text>
              </HStack>
            )}
          </VStack>
        </HStack>
      </Card>
    </Section>
  );
}
