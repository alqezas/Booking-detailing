import {Button} from '@astryxdesign/core/Button';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {Avatar} from '@astryxdesign/core/Avatar';
import {useTenant} from '../../app/tenant.tsx';
import {useLiquidGlass} from '../../lib/glass.ts';
import {mediaUrl} from '../../lib/media.ts';
import {useBookingFlow} from '../booking/BookingFlow.tsx';

/**
 * Full-bleed photo with the studio name and a wide glass «Записаться» button.
 * The lens may refract ONLY the photo element (snapshot = the photo), so no
 * letters from neighbouring sections ever appear inside it; the label is a
 * normal DOM layer above the lens and stays crisp. The button is part of the
 * hero, so it scrolls with the photo.
 */
export function Hero() {
  const t = useTenant();
  const flow = useBookingFlow();
  const hero = mediaUrl(t.hero_path);
  const logo = mediaUrl(t.logo_path);
  useLiquidGlass({target: '[data-glass="hero-cta"]', snapshot: '[data-glass-snapshot="hero"]', enabled: !!hero, resolution: 1.5, frost: 1});

  return (
    <VStack as="header" style={{position: 'relative', minHeight: 'min(78dvh, 720px)', overflow: 'hidden'}}>
      <VStack data-glass-snapshot="hero" style={{position: 'absolute', inset: 0, zIndex: 0}} aria-hidden="true">
        {hero && (
          <img
            src={hero}
            alt=""
            crossOrigin="anonymous"
            fetchPriority="high"
            decoding="async"
            style={{width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 72%', display: 'block'}}
          />
        )}
      </VStack>
      {/* Readability scrim: separate from the snapshot so the lens sees the clean photo. */}
      <VStack
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          background: 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.88) 100%)',
        }}
      />
      <VStack
        gap={4}
        padding={4}
        justify="end"
        style={{position: 'relative', flex: 1, paddingTop: 'calc(env(safe-area-inset-top, 0px) + var(--spacing-4))'}}
      >
        <HStack gap={2} align="center" style={{marginBottom: 'auto'}}>
          {logo && <Avatar src={logo} name={t.name} size="md" />}
          <Text weight="semibold">{t.short_name ?? t.name}</Text>
        </HStack>
        <VStack gap={2} maxWidth={640}>
          <Heading level={1} type="display-2" textWrap="balance">
            {t.name}
          </Heading>
          {t.tagline && (
            <Text type="large" color="secondary" textWrap="pretty">
              {t.tagline}
            </Text>
          )}
        </VStack>
        <VStack width="100%" maxWidth={640} style={{position: 'relative'}}>
          {/* The lens: a decorative layer under the real button. liquid-gl makes its
              target non-interactive, so the clickable button sits above it. */}
          <VStack
            data-glass="hero-cta"
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 5,
              borderRadius: 'var(--radius-page)',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              background: 'rgba(255, 255, 255, 0.10)',
              backdropFilter: 'blur(14px)',
              WebkitBackdropFilter: 'blur(14px)',
            }}
          />
          <Button
            label="Записаться"
            size="lg"
            variant="ghost"
            width="100%"
            onClick={() => flow.open()}
            style={{
              position: 'relative',
              zIndex: 6,
              minHeight: 60,
              borderRadius: 'var(--radius-page)',
              background: 'transparent',
              color: 'var(--color-text-primary)',
              fontWeight: 700,
              fontSize: 'var(--text-heading-4-size, 1.125rem)',
              textShadow: '0 1px 2px rgba(0, 0, 0, 0.45)',
            }}
          />
        </VStack>
      </VStack>
    </VStack>
  );
}
