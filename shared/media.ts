/**
 * Image paths stored in the database are either
 *   - "/s/<slug>/media/<file>"  — shipped with the site by the tenant pipeline, or
 *   - "<tenant-id>/<file>"      — uploaded by the owner to the `tenant-media` bucket.
 */
export function mediaFileName(relPath: string): string {
  const base = relPath.split('/').pop() ?? relPath;
  const stem = base.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  const isLogo = /logo|icon/.test(stem);
  return `${stem}.${isLogo ? 'png' : 'webp'}`;
}

export function configMediaUrl(slug: string, relPath: string): string {
  return `/s/${slug}/media/${mediaFileName(relPath)}`;
}

export function resolveMediaUrl(path: string | null | undefined, supabaseUrl: string, version?: string): string | null {
  if (!path) return null;
  if (path.startsWith('/') || /^https?:\/\//.test(path)) return path;
  const url = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/tenant-media/${path}`;
  return version ? `${url}?v=${encodeURIComponent(version)}` : url;
}
