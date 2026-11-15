import {Button} from '@astryxdesign/core/Button';
import {Center} from '@astryxdesign/core/Center';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Spinner} from '@astryxdesign/core/Spinner';

export function Loading({label = 'Завантаження…'}: {label?: string}) {
  return (
    <Center minHeight={240}>
      <Spinner size="lg" label={label} />
    </Center>
  );
}

export function ErrorState({error, onRetry}: {error: unknown; onRetry?: () => void}) {
  const text = error instanceof Error ? error.message : 'Сталася помилка.';
  return (
    <Center minHeight={240}>
      <EmptyState title="Не вдалося завантажити" description={text} actions={onRetry ? <Button label="Спробувати ще раз" onClick={onRetry} /> : undefined} />
    </Center>
  );
}

export function NotFound() {
  return (
    <Center minHeight={320}>
      <EmptyState title="Сторінку не знайдено" description="Можливо, товар знято з продажу або посилання застаріло." actions={<Button label="До каталогу" variant="primary" href="/katalog" />} />
    </Center>
  );
}
