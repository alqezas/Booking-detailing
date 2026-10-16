import {Heading} from '@astryxdesign/core/Heading';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {forwardRef, type CSSProperties, type ReactNode} from 'react';

/**
 * One content line for every page: the hero text, the sections below it, the
 * cabinet header and its tabs all start at the same left edge.
 *
 * Responsive contract (no breakpoints to drift):
 *   gutter  16 px on phones → grows with the viewport → 32 px from ~800 px
 *   width   fills the screen up to 1120 px, then centres
 *   columns sections that pair up use Grid {minWidth, max: 2}: one column on
 *           phones, two side by side once each gets ≥ its minWidth
 */
export const GUTTER = 'clamp(var(--spacing-4), 4vw, var(--spacing-8))';
export const PAGE_MAX_WIDTH = 1120;
/** Comfortable measure for prose and forms inside the page column. */
export const TEXT_MAX_WIDTH = 720;

type ContainerProps = {children: ReactNode; style?: CSSProperties; as?: 'div' | 'header' | 'main' | 'section' | 'nav'};

export const PageContainer = forwardRef<HTMLElement, ContainerProps>(function PageContainer({children, style, as}, ref) {
  return (
    <VStack ref={ref} as={as} width="100%" maxWidth={PAGE_MAX_WIDTH} style={{marginInline: 'auto', paddingInline: GUTTER, ...style}}>
      {children}
    </VStack>
  );
});

/** Title block of a secondary page: same position and spacing on every page. */
export function PageTitle({title, description, action}: {title: string; description?: ReactNode; action?: ReactNode}) {
  return (
    <VStack gap={1} style={{paddingBlockStart: 'calc(env(safe-area-inset-top, 0px) + var(--spacing-6))', paddingBlockEnd: 'var(--spacing-4)'}}>
      <Heading level={1}>{title}</Heading>
      {description && <Text color="secondary">{description}</Text>}
      {action}
    </VStack>
  );
}
