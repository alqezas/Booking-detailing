import {env} from './env.ts';

/**
 * Public Storage URL of an uploaded photo; null → neutral placeholder.
 * Photos are resized to WebP in the browser before upload (optimizeImage), so no
 * paid image-transformation endpoint is needed.
 */
export function imageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${env.supabaseUrl}/storage/v1/object/public/catalog/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** Downscale and re-encode a photo in the browser before upload (WebP, max 1600 px). */
export async function optimizeImage(file: File, max = 1600): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp|avif)$/.test(file.type)) throw new Error('Підтримуються JPEG, PNG, WebP, AVIF');
  if (file.size > 20 * 1024 * 1024) throw new Error('Файл більший за 20 МБ');
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await canvas.convertToBlob({type: 'image/webp', quality: 0.86});
  if (blob.size > 5 * 1024 * 1024) throw new Error('Після стиснення файл більший за 5 МБ');
  return blob;
}
