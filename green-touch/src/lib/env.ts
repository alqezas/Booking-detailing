import {z} from 'zod';

/** Public (browser) configuration. Only the URL and the publishable anon key — never secrets. */
const schema = z.object({
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(20),
  VITE_SITE_URL: z.url().optional(),
});
const parsed = schema.safeParse(import.meta.env);
if (!parsed.success) {
  throw new Error(`Invalid environment: ${parsed.error.issues.map(i => i.path.join('.')).join(', ')}. See .env.example`);
}
export const env = {
  supabaseUrl: parsed.data.VITE_SUPABASE_URL.replace(/\/$/, ''),
  anonKey: parsed.data.VITE_SUPABASE_ANON_KEY,
  siteUrl: (parsed.data.VITE_SITE_URL ?? (typeof location !== 'undefined' ? location.origin : '')).replace(/\/$/, ''),
};
