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
import {msg} from '../../../i18n/index.ts';

type Item = {id: string; image_path: string; before_path: string | null; caption: string; sort: number; updated_at: string};

/**
 * Separate actions, each touching exactly one row:
 *   add a new card · replace the photo (or the «before» photo) of one card · edit the caption of one card.
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
        <InlineEmpty title={msg.gallerySettings.none} description={msg.gallerySettings.noneHint} />
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
  const [before, setBefore] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const add = useMutation({
    mutationFn: async () => {
      const cap = captionSchema.parse(caption);
      const upload = async (f: File) => {
        const {blob, ext} = await prepareImage(f);
        return api.upload(blob, uniqueName('work', ext));
      };
      const path = await upload(file!);
      const beforePath = before ? await upload(before) : null;
      await api.addGalleryItem(path, cap, nextSort, beforePath);
    },
    onSuccess: () => {
      setFile(null);
      setBefore(null);
      setCaption('');
      refresh();
      showToast({body: msg.gallerySettings.added});
    },
  });
  return (
    <Card padding={4}>
      <VStack gap={3}>
        <Heading level={2}>{msg.gallerySettings.addTitle}</Heading>
        <FileInput label={msg.gallerySettings.photoAfter} value={file} accept={IMAGE_ACCEPT} maxSize={MAX_UPLOAD} onChange={f => setFile(Array.isArray(f) ? (f[0] ?? null) : f)} />
        <FileInput
          label={msg.gallerySettings.photoBefore}
          isOptional
          description={msg.gallerySettings.beforeHint}
          value={before}
          accept={IMAGE_ACCEPT}
          maxSize={MAX_UPLOAD}
          onChange={f => setBefore(Array.isArray(f) ? (f[0] ?? null) : f)}
        />
        <TextInput label={msg.gallerySettings.caption} isOptional value={caption} onChange={setCaption} placeholder={msg.gallerySettings.captionPlaceholder} />
        {add.isError && <Banner status="error" title={errorText(add.error)} collapsible={false} />}
        <Button label={msg.gallerySettings.addCard} variant="primary" isDisabled={!file} isLoading={add.isPending} onClick={() => add.mutate()} />
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
    mutationFn: async ({file, field}: {file: File; field: 'image_path' | 'before_path'}) => {
      const {blob, ext} = await prepareImage(file);
      const path = await api.upload(blob, uniqueName('work', ext));
      await api.updateGalleryItem(item.id, {[field]: path}); // only this card's photo
    },
    onSuccess: () => {
      refresh();
      showToast({body: msg.gallerySettings.replaced});
    },
  });
  const dropBefore = useMutation({
    mutationFn: () => api.updateGalleryItem(item.id, {before_path: null}),
    onSuccess: refresh,
  });
  const saveCaption = useMutation({
    mutationFn: () => api.updateGalleryItem(item.id, {caption: captionSchema.parse(caption)}), // only this card's caption
    onSuccess: () => {
      refresh();
      showToast({body: msg.gallerySettings.captionSaved});
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
        <HStack gap={1}>
          {item.before_path && (
            <img
              src={mediaUrl(item.before_path, item.updated_at) ?? ''}
              alt={`${item.caption || msg.gallerySettings.workPhoto} — ${msg.home.before}`}
              loading="lazy"
              style={{flex: 1, minWidth: 0, aspectRatio: '3 / 4', objectFit: 'cover', borderRadius: 'var(--radius-element)'}}
            />
          )}
          <img
            src={mediaUrl(item.image_path, item.updated_at) ?? ''}
            alt={item.caption || msg.gallerySettings.workPhoto}
            loading="lazy"
            style={{flex: 1, minWidth: 0, aspectRatio: item.before_path ? '3 / 4' : '4 / 3', objectFit: 'cover', borderRadius: 'var(--radius-element)'}}
          />
        </HStack>
        <FileInput
          label={item.before_path ? msg.gallerySettings.photoAfter : msg.gallerySettings.replacePhoto}
          value={null}
          accept={IMAGE_ACCEPT}
          maxSize={MAX_UPLOAD}
          isLoading={replace.isPending && replace.variables?.field === 'image_path'}
          onChange={f => {
            const file = Array.isArray(f) ? f[0] : f;
            if (file) replace.mutate({file, field: 'image_path'});
          }}
        />
        <FileInput
          label={msg.gallerySettings.replaceBefore}
          isOptional
          value={null}
          accept={IMAGE_ACCEPT}
          maxSize={MAX_UPLOAD}
          isLoading={replace.isPending && replace.variables?.field === 'before_path'}
          onChange={f => {
            const file = Array.isArray(f) ? f[0] : f;
            if (file) replace.mutate({file, field: 'before_path'});
          }}
        />
        {item.before_path && (
          <Button label={msg.gallerySettings.removeBefore} variant="ghost" size="sm" isLoading={dropBefore.isPending} onClick={() => dropBefore.mutate()} />
        )}
        <HStack gap={2} align="end">
          <TextInput label={msg.gallerySettings.caption} value={caption} onChange={setCaption} width="100%" />
          <Button label={msg.gallerySettings.saveCaption} size="md" style={{flexShrink: 0}} isDisabled={caption === item.caption} isLoading={saveCaption.isPending} onClick={() => saveCaption.mutate()}>
            {msg.common.save}
          </Button>
        </HStack>
        {(replace.isError || saveCaption.isError || dropBefore.isError) && (
          <Text color="accent" role="alert">
            {errorText(replace.error ?? saveCaption.error ?? dropBefore.error)}
          </Text>
        )}
        <Button label={msg.gallerySettings.deleteCard} variant="ghost" size="sm" onClick={() => setConfirm(true)} />
      </VStack>
      <AlertDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={msg.gallerySettings.deleteTitle}
        description={msg.gallerySettings.deleteText}
        actionLabel={msg.gallerySettings.delete}
        cancelLabel={msg.gallerySettings.keep}
        isActionLoading={remove.isPending}
        onAction={() => remove.mutate()}
      />
    </Card>
  );
}
