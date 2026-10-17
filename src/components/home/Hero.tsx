import {Button} from '@astryxdesign/core/Button';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {Avatar} from '@astryxdesign/core/Avatar';
import type {CSSProperties, ReactNode} from 'react';
import {useTenant} from '../../app/tenant.tsx';
import {useLiquidGlass} from '../../lib/glass.ts';
import {mediaUrl} from '../../lib/media.ts';
import {useBookingFlow} from '../booking/BookingFlow.tsx';
import {PageContainer} from '../layout/Page.tsx';
import {useMatchMedia} from '../../lib/motion.ts';
import {msg} from '../../i18n/index.ts';

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
  // Phones: full-bleed photo. Wide screens: a rounded card on the page column, so
  // photos are shown near their own size instead of being stretched edge to edge.
  const wide = useMatchMedia('(min-width: 900px)');
  useLiquidGlass({target: '[data-glass="hero-cta"]', snapshot: '[data-glass-snapshot="hero"]', enabled: !!hero, resolution: 1.5, frost: 1, refreshKey: String(wide)});

  const content: CSSProperties = {
    position: 'relative',
    flex: 1,
    justifyContent: 'flex-end',
    gap: 'var(--spacing-4)',
    paddingBlockStart: wide ? 'var(--spacing-6)' : 'calc(env(safe-area-inset-top, 0px) + var(--spacing-4))',
    paddingBlockEnd: wide ? 'var(--spacing-8)' : 'var(--spacing-6)',
  };
  const card = (
    <VStack
      data-hero-card
      style={{
        position: 'relative',
        overflow: 'hidden',
        minHeight: wide ? 'clamp(420px, 62svh, 600px)' : 'clamp(460px, 74svh, 720px)',
        ...(wide ? {borderRadius: 'var(--radius-page)', border: '1px solid var(--color-border)'} : {}),
      }}
    >
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
      <Inner wide={wide} style={content}>
        <HStack gap={2} align="center" style={{marginBottom: 'auto'}}>
          {logo && <Avatar src={logo} name={t.name} size="md" />}
          <Text weight="semibold">{t.short_name ?? t.name}</Text>
        </HStack>
        <VStack gap={2} maxWidth={720}>
          <Heading level={1} type="display-2" textWrap="balance">
            {t.name}
          </Heading>
          {t.tagline && (
            <Text type="large" color="secondary" textWrap="pretty">
              {t.tagline}
            </Text>
          )}
        </VStack>
        {/* Full width of the page column, on phones and on desktop alike. */}
        <VStack width="100%" style={{position: 'relative'}}>
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
            label={msg.home.book}
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
      </Inner>
    </VStack>
  );

  return wide ? (
    <PageContainer as="header" style={{paddingBlockStart: 'calc(env(safe-area-inset-top, 0px) + var(--spacing-4))'}}>
      {card}
    </PageContainer>
  ) : (
    <VStack as="header">{card}</VStack>
  );
}

/** Hero text column: the page column on phones, an inset inside the card on wide screens. */
function Inner({wide, style, children}: {wide: boolean; style: CSSProperties; children: ReactNode}) {
  return wide ? <VStack style={{...style, paddingInline: 'var(--spacing-8)'}}>{children}</VStack> : <PageContainer style={style}>{children}</PageContainer>;
}
