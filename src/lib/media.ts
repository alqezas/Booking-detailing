import {resolveMediaUrl} from '../../shared/media.ts';
import {env} from './env.ts';

/** URL for an image path stored in the database (site media or owner upload). */
export const mediaUrl = (path: string | null | undefined, version?: string) => resolveMediaUrl(path, env.supabaseUrl, version);
