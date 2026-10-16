import {Icon} from '@astryxdesign/core/Icon';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {HStack} from '@astryxdesign/core/HStack';
import {CalendarCheck, House, IconContext, ListBullets, type Icon as PhosphorIcon} from '@phosphor-icons/react';
import type {CSSProperties} from 'react';
import {NavLink, useLocation} from 'react-router';
import {useLiquidGlass} from '../lib/glass.ts';

/** Height the page must keep free at the bottom so the bar never covers content. */
export const BOTTOM_NAV_SPACE = 'calc(96px + env(safe-area-inset-bottom, 0px))';

type Item = {to: string; label: string; icon: PhosphorIcon; end?: boolean};

export function BottomNav({slug}: {slug: string}) {
  const base = `/s/${slug}`;
  const items: Item[] = [
    {to: `${base}/`, label: 'Главная', icon: House, end: true},
    {to: `${base}/services`, label: 'Услуги', icon: ListBullets},
    {to: `${base}/my`, label: 'Моя запись', icon: CalendarCheck},
  ];
  const {pathname} = useLocation();
  // Real refraction of whatever scrolls under the bar.
  useLiquidGlass({target: '[data-glass="nav"]', snapshot: 'body', refreshKey: pathname, resolution: 1, frost: 3});

  const bar: CSSProperties = {
    position: 'fixed',
    zIndex: 40,
    insetInline: 'var(--spacing-3)',
    bottom: 'calc(env(safe-area-inset-bottom, 0px) + var(--spacing-2))',
    maxWidth: 480,
    marginInline: 'auto',
    borderRadius: 'var(--radius-page)',
    border: '1px solid var(--color-border)',
    background: 'rgba(14, 14, 18, 0.55)',
    backdropFilter: 'blur(18px) saturate(140%)',
    WebkitBackdropFilter: 'blur(18px) saturate(140%)',
  };

  return (
    <HStack as="nav" aria-label="Разделы" data-glass="nav" style={bar} padding={1} gap={1}>
      {items.map(item => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          style={({isActive}) => ({
            position: 'relative',
            zIndex: 3,
            flex: 1,
            minHeight: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 'var(--radius-container)',
            textDecoration: 'none',
            color: isActive ? 'var(--color-text-accent)' : 'var(--color-text-secondary)',
            background: isActive ? 'var(--color-accent-muted)' : 'transparent',
            touchAction: 'manipulation',
            // liquid-gl turns its target's pointer events off; the links opt back in.
            pointerEvents: 'auto',
          })}
        >
          {({isActive}) => (
            <VStack gap={0.5} align="center">
              <IconContext.Provider value={{weight: isActive ? 'fill' : 'regular'}}>
                <Icon icon={item.icon} size="md" color="inherit" />
              </IconContext.Provider>
              <Text type="label" color="inherit" weight={isActive ? 'semibold' : 'medium'}>
                {item.label}
              </Text>
            </VStack>
          )}
        </NavLink>
      ))}
    </HStack>
  );
}
