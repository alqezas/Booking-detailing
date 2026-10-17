import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {HStack} from '@astryxdesign/core/HStack';
import {Icon} from '@astryxdesign/core/Icon';
import {Section} from '@astryxdesign/core/Section';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {DeviceMobile, Export} from '@phosphor-icons/react';
import {useInstallOffer} from '../lib/pwa.ts';
import {msg} from '../i18n/index.ts';

/** Optional: put the studio on the home screen. Never blocks anything. */
export function InstallHint() {
  const offer = useInstallOffer();
  if (!offer.kind) return null;
  return (
    <Section variant="transparent" padding={0}>
      <Card padding={4} variant="muted">
        <HStack gap={3} align="start">
          <Icon icon={DeviceMobile} color="accent" />
          <VStack gap={2}>
            <Text weight="semibold">{msg.install.title}</Text>
            {offer.kind === 'prompt' ? (
              <>
                <Text color="secondary">{msg.install.text}</Text>
                <Button label={msg.install.install} size="sm" onClick={() => void offer.install()} />
              </>
            ) : (
              <HStack gap={1} align="center" wrap="wrap">
                <Text color="secondary">{msg.install.safariTap}</Text>
                <Icon icon={Export} label={msg.install.share} />
                <Text color="secondary">{msg.install.addToHome}</Text>
              </HStack>
            )}
          </VStack>
        </HStack>
      </Card>
    </Section>
  );
}
