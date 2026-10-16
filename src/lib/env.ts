import {z} from 'zod';

const schema = z.object({
  VITE_SUPABASE_URL: z.url(),
  /** Publishable (anon) key: safe in the browser, RLS and grants do the guarding. */
  VITE_SUPABASE_ANON_KEY: z.string().min(20),
  VITE_VAPID_PUBLIC_KEY: z.string().min(40).optional().or(z.literal('')),
});

const parsed = schema.safeParse(import.meta.env);
if (!parsed.success) {
  throw new Error(`Invalid environment: ${parsed.error.issues.map(i => i.path.join('.')).join(', ')}. See .env.example`);
}

export const env = {
  supabaseUrl: parsed.data.VITE_SUPABASE_URL.replace(/\/$/, ''),
  supabaseAnonKey: parsed.data.VITE_SUPABASE_ANON_KEY,
  vapidPublicKey: parsed.data.VITE_VAPID_PUBLIC_KEY || null,
  functionsUrl: `${parsed.data.VITE_SUPABASE_URL.replace(/\/$/, '')}/functions/v1`,
};
