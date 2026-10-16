import {AlertDialog} from '@astryxdesign/core/AlertDialog';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {FileInput} from '@astryxdesign/core/FileInput';
import {Grid} from '@astryxdesign/core/Grid';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {VStack} from '@astryxdesign/core/VStack';
import {useToast} from '@astryxdesign/core/Toast';
import {useMutation, useQuery} from '@tanstack/react-query';
import {useState} from 'react';
import {InlineEmpty, InlineError, RowsSkeleton} from '../../../components/StatusScreens.tsx';
import {errorText} from '../../../lib/errors.ts';
import {prepareImage, uniqueName} from '../../../lib/image.ts';
import {mediaUrl} from '../../../lib/media.ts';
import {captionSchema} from '../../../lib/schemas.ts';
import {ownerKey, useOwner} from '../ownerContext.tsx';
import {IMAGE_ACCEPT, MAX_UPLOAD, useRefreshStudio} from './shared.tsx';

type Item = {id: string; image_path: string; caption: string; sort: number; updated_at: string};

/**
 * Three separate actions, each touching exactly one row:
 *   add a new card · replace the photo of one card · edit the caption of one card.
 * Uploading one photo never moves or removes the others.
 */
export function GallerySettings() {
  const {api, slug} = useOwner();
  const q = useQuery({queryKey: ownerKey(slug, 'gallery'), queryFn: () => api.gallery() as Promise<Item[]>});
  if (q.isPending) return <RowsSkeleton rows={3} height={160} />;
  if (q.isError) return <InlineError message={q.error.message} onRetry={() => void q.refetch()} />;
  const nextSort = Math.max(0, ...q.data.map(i => i.sort)) + 10;
  return (
    <VStack gap={4}>
      <AddCard nextSort={nextSort} />
      {q.data.length === 0 ? (
        <InlineEmpty title="Фото работ пока нет" description="Добавьте первую карточку выше." />
      ) : (
        <Grid columns={{minWidth: 260, max: 3}} gap={3}>
          {q.data.map(item => (
            <GalleryCard key={item.id} item={item} />
          ))}
        </Grid>
      )}
    </VStack>
  );
}

function AddCard({nextSort}: {nextSort: number}) {
  const {api} = useOwner();
  const refresh = useRefreshStudio();
  const showToast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const add = useMutation({
    mutationFn: async () => {
      const cap = captionSchema.parse(caption);
      const {blob, ext} = await prepareImage(file!);
      const path = await api.upload(blob, uniqueName('work', ext));
      await api.addGalleryItem(path, cap, nextSort);
    },
    onSuccess: () => {
      setFile(null);
      setCaption('');
      refresh();
      showToast({body: 'Карточка добавлена'});
    },
  });
  return (
    <Card padding={4}>
      <VStack gap={3}>
        <Heading level={2}>Добавить работу</Heading>
        <FileInput label="Фото" value={file} accept={IMAGE_ACCEPT} maxSize={MAX_UPLOAD} onChange={f => setFile(Array.isArray(f) ? (f[0] ?? null) : f)} />
        <TextInput label="Подпись" isOptional value={caption} onChange={setCaption} placeholder="Керамика, BMW X5" />
        {add.isError && <Banner status="error" title={errorText(add.error)} collapsible={false} />}
        <Button label="Добавить карточку" variant="primary" isDisabled={!file} isLoading={add.isPending} onClick={() => add.mutate()} />
      </VStack>
    </Card>
  );
}

function GalleryCard({item}: {item: Item}) {
  const {api} = useOwner();
  const refresh = useRefreshStudio();
  const showToast = useToast();
  const [caption, setCaption] = useState(item.caption);
  const [confirm, setConfirm] = useState(false);

  const replace = useMutation({
    mutationFn: async (file: File) => {
      const {blob, ext} = await prepareImage(file);
      const path = await api.upload(blob, uniqueName('work', ext));
      await api.updateGalleryItem(item.id, {image_path: path}); // only this card's photo
    },
    onSuccess: () => {
      refresh();
      showToast({body: 'Фото заменено'});
    },
  });
  const saveCaption = useMutation({
    mutationFn: () => api.updateGalleryItem(item.id, {caption: captionSchema.parse(caption)}), // only this card's caption
    onSuccess: () => {
      refresh();
      showToast({body: 'Подпись сохранена'});
    },
  });
  const remove = useMutation({
    mutationFn: () => api.removeGalleryItem(item.id),
    onSuccess: () => {
      setConfirm(false);
      refresh();
    },
  });

  return (
    <Card padding={3}>
      <VStack gap={3}>
        <img
          src={mediaUrl(item.image_path, item.updated_at) ?? ''}
          alt={item.caption || 'Фото работы'}
          loading="lazy"
          style={{width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 'var(--radius-element)'}}
        />
        <FileInput
          label="Заменить это фото"
          value={null}
          accept={IMAGE_ACCEPT}
          maxSize={MAX_UPLOAD}
          isLoading={replace.isPending}
          onChange={f => {
            const file = Array.isArray(f) ? f[0] : f;
            if (file) replace.mutate(file);
          }}
        />
        <HStack gap={2} align="end">
          <TextInput label="Подпись" value={caption} onChange={setCaption} width="100%" />
          <Button label="Сохранить подпись" size="md" isDisabled={caption === item.caption} isLoading={saveCaption.isPending} onClick={() => saveCaption.mutate()}>
            Сохранить
          </Button>
        </HStack>
        {(replace.isError || saveCaption.isError) && (
          <Text color="accent" role="alert">
            {errorText(replace.error ?? saveCaption.error)}
          </Text>
        )}
        <Button label="Удалить карточку" variant="ghost" size="sm" onClick={() => setConfirm(true)} />
      </VStack>
      <AlertDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title="Удалить карточку?"
        description="Фото и подпись исчезнут с главной страницы. Остальные работы останутся на месте."
        actionLabel="Удалить"
        cancelLabel="Оставить"
        isActionLoading={remove.isPending}
        onAction={() => remove.mutate()}
      />
    </Card>
  );
}
