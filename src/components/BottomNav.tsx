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

export type NavItem = {to: string; label: string; icon: PhosphorIcon; end?: boolean};

export const clientNavItems = (slug: string): NavItem[] => [
  {to: `/s/${slug}/`, label: 'Главная', icon: House, end: true},
  {to: `/s/${slug}/services`, label: 'Услуги', icon: ListBullets},
  {to: `/s/${slug}/my`, label: 'Моя запись', icon: CalendarCheck},
];

/** Floating glass tab bar: the client app, and the owner cabinet on phones. */
export function BottomNav({items, label = 'Разделы'}: {items: NavItem[]; label?: string}) {
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
    <HStack as="nav" aria-label={label} data-glass="nav" style={bar} padding={1} gap={1}>
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
              {/* Same weight in both states: the label never changes width, so nothing shifts. */}
              <Text type="label" color="inherit" weight="semibold" size={items.length > 3 ? 'xsm' : undefined} maxLines={1} hasTruncateTooltip={false}>
                {item.label}
              </Text>
            </VStack>
          )}
        </NavLink>
      ))}
    </HStack>
  );
}
