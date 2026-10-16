import {Theme} from '@astryxdesign/core';
import {Center} from '@astryxdesign/core/Center';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Icon} from '@astryxdesign/core/Icon';
import {Car} from '@phosphor-icons/react';
import {DEFAULT_ACCENT, studioTheme} from '../app/theme.ts';

/** The bare domain lists nothing: every studio is reached by its own link. */
export function RootPage() {
  return (
    <Theme theme={studioTheme(DEFAULT_ACCENT)} mode="dark">
      <Center minHeight="100dvh" padding={4}>
        <EmptyState
          headingLevel={1}
          icon={<Icon icon={Car} size="lg" />}
          title="Онлайн-запись в студию"
          description="Откройте ссылку, которую прислала ваша студия, — она выглядит как …/s/название-студии/"
        />
      </Center>
    </Theme>
  );
}
