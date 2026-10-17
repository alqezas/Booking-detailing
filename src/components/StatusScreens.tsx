import {Button} from '@astryxdesign/core/Button';
import {Center} from '@astryxdesign/core/Center';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Icon} from '@astryxdesign/core/Icon';
import {Skeleton} from '@astryxdesign/core/Skeleton';
import {Spinner} from '@astryxdesign/core/Spinner';
import {VStack} from '@astryxdesign/core/VStack';
import {CloudSlash, MagnifyingGlass, Tray} from '@phosphor-icons/react';
import type {ReactNode} from 'react';
import {msg} from '../i18n/index.ts';

export function FullScreenLoading({label = msg.common.loading}: {label?: string}) {
  return (
    <Center minHeight="100dvh">
      <Spinner size="lg" label={label} />
    </Center>
  );
}

export function FullScreenError({title, description, onRetry}: {title: string; description?: string; onRetry?: () => void}) {
  return (
    <Center minHeight="100dvh" padding={4}>
      <EmptyState
        headingLevel={1}
        icon={<Icon icon={onRetry ? CloudSlash : MagnifyingGlass} size="lg" />}
        title={title}
        description={description}
        actions={onRetry ? <Button label={msg.common.retry} variant="primary" onClick={onRetry} /> : undefined}
      />
    </Center>
  );
}

/** Inline error block with a retry action, for sections that load separately. */
export function InlineError({message, onRetry}: {message: string; onRetry?: () => void}) {
  return (
    <EmptyState
      isCompact
      icon={<Icon icon={CloudSlash} />}
      title={msg.common.notLoaded}
      description={message}
      actions={onRetry ? <Button label={msg.common.retry} size="sm" onClick={onRetry} /> : undefined}
    />
  );
}

export function InlineEmpty({title, description, action}: {title: string; description?: string; action?: ReactNode}) {
  return <EmptyState isCompact icon={<Icon icon={Tray} />} title={title} description={description} actions={action} />;
}

export function RowsSkeleton({rows = 4, height = 56}: {rows?: number; height?: number}) {
  return (
    <VStack gap={2} aria-busy="true" aria-label={msg.common.loadingAria}>
      {Array.from({length: rows}, (_, i) => (
        <Skeleton key={i} height={height} index={i} />
      ))}
    </VStack>
  );
}
