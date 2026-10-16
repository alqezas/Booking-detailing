/**
 * Shrink a phone photo before upload: max side `max` px, WebP (JPEG fallback).
 * Keeps uploads small on mobile data and within the bucket's 8 MB limit.
 */
export async function prepareImage(file: File, max = 1800, quality = 0.82): Promise<{blob: Blob; ext: string}> {
  if (!/^image\/(jpeg|png|webp|avif|heic|heif)$/i.test(file.type)) {
    throw new Error('Нужна фотография: JPG, PNG, WebP или HEIC');
  }
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('Не удалось открыть фото. Попробуйте JPG или PNG.');
  });
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const toBlob = (type: string) => new Promise<Blob | null>(res => canvas.toBlob(res, type, quality));
  const webp = await toBlob('image/webp');
  if (webp && webp.type === 'image/webp') return {blob: webp, ext: 'webp'};
  const jpeg = await toBlob('image/jpeg');
  if (!jpeg) throw new Error('Не удалось подготовить фото');
  return {blob: jpeg, ext: 'jpg'};
}

export const uniqueName = (prefix: string, ext: string) =>
  `${prefix}-${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(1))[0]!.toString(36)}.${ext}`;
