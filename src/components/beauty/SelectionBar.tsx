import {Button} from '@astryxdesign/core/Button';
import {HStack} from '@astryxdesign/core/HStack';
import {Icon} from '@astryxdesign/core/Icon';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {PencilSimple, X} from '@phosphor-icons/react';
import type {CSSProperties} from 'react';
import {useLocation} from 'react-router';
import {isLightTenant, useTenant} from '../../app/tenant.tsx';
import {beautyMsg} from '../../i18n/beauty.ts';
import {formatDuration, formatPrice} from '../../lib/format.ts';
import {useLiquidGlass} from '../../lib/glass.ts';
import {useBeauty} from './BeautyFlow.tsx';

/** Extra room the page keeps at the bottom while the bar is shown. */
export const SELECTION_BAR_SPACE = '96px';

/**
 * The chosen service sits right above the tab bar: total duration and price
 * and a wide accent «Выбрать время». Frosted milky glass (heavy frost + white
 * tint) so text scrolling underneath never reads through; the labels are DOM
 * above the lens and stay crisp. The page reserves its height (no overlap).
 */
export function SelectionBar() {
  const t = useTenant();
  const B = beautyMsg();
  const beauty = useBeauty();
  const {pathname} = useLocation();
  const shown = !!beauty.service && !!beauty.total && !pathname.endsWith('/my') && !pathname.endsWith('/assistant');
  const light = isLightTenant(t);
  useLiquidGlass({target: '[data-glass="selection"]', snapshot: 'body', enabled: shown, refreshKey: beauty.selection, frost: light ? 8 : 4, tint: light ? 'rgba(255, 255, 255, 0.8)' : 'rgba(14, 14, 18, 0.7)', resolution: 1});
  if (!shown) return null;
  const s = beauty.service!;
  const total = beauty.total!;

  const bar: CSSProperties = {
    position: 'fixed',
    zIndex: 39,
    insetInline: 'var(--spacing-3)',
    // Sits on top of the tab bar (≈ 66 px + its 8 px offset).
    bottom: 'calc(env(safe-area-inset-bottom, 0px) + var(--spacing-2) + 74px)',
    maxWidth: 480,
    marginInline: 'auto',
    borderRadius: 'var(--radius-page)',
    border: '1px solid var(--color-border)',
    background: light ? 'rgba(255, 255, 255, 0.82)' : 'rgba(16, 16, 20, 0.86)',
    backdropFilter: 'blur(26px) saturate(160%)',
    WebkitBackdropFilter: 'blur(26px) saturate(160%)',
    boxShadow: light ? '0 12px 32px rgba(60, 40, 90, 0.16)' : '0 12px 32px rgba(0, 0, 0, 0.5)',
  };

  return (
    <VStack as="section" aria-label={s.name} data-glass="selection" style={bar} padding={2} gap={2}>
      <HStack gap={2} align="center" style={{position: 'relative', zIndex: 3, pointerEvents: 'auto', paddingInline: 'var(--spacing-1)'}}>
        <VStack gap={0} style={{flex: 1, minWidth: 0}}>
          <Text weight="semibold" maxLines={1}>
            {s.name}
            {beauty.selection!.addons.length ? ` +${beauty.selection!.addons.length}` : ''}
          </Text>
          <Text type="supporting" hasTabularNumbers aria-live="polite">
            {B.bar.summary(formatDuration(total.minutes), formatPrice(total.price, total.priceFrom, t.currency))}
          </Text>
        </VStack>
        {!!s.addons?.length && (
          <Button label={B.bar.change} variant="ghost" size="sm" isIconOnly icon={<Icon icon={PencilSimple} />} onClick={beauty.openOptions} />
        )}
        <Button label={B.bar.remove} variant="ghost" size="sm" isIconOnly icon={<Icon icon={X} />} onClick={beauty.clear} />
      </HStack>
      <Button
        label={B.bar.chooseTime}
        variant="primary"
        size="lg"
        width="100%"
        onClick={beauty.openTime}
        style={{position: 'relative', zIndex: 3, pointerEvents: 'auto', borderRadius: 'var(--radius-container)', fontWeight: 700, minHeight: 52}}
      />
    </VStack>
  );
}
