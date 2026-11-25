/** Runtime configuration of the Edge Functions (read from Supabase secrets). */
import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import type {Mailer} from './email.ts';
import type {MonoConfig} from './mono.ts';
import type {NpConfig} from './np.ts';

export type Ctx = {
  /** service-role client: bypasses RLS, used only inside functions */
  db: SupabaseClient;
  np: NpConfig;
  /** null when MONO_TOKEN is not set: orders are kept, online payment is reported unavailable */
  mono: MonoConfig | null;
  siteUrl: string;
  webhookUrl: string;
  tokenSecret: string;
  /** how long one mono invoice stays payable (validity) */
  paymentValidityMinutes: number;
  allowedOrigins: string[];
  jobsSecret: string | null;
  /** bot token set → notifications to chats connected in the bot (+ optional fixed TELEGRAM_CHAT_ID) */
  telegram: {token: string; chatId: string | null; apiUrl: string} | null;
  supabaseUrl: string;
  /** public anon key: the bot checks the owner's email and password with it */
  anonKey: string;
  /** admin app address for links in notifications */
  adminUrl: string;
  /** order emails to buyers; null when SMTP is not configured (emails are skipped) */
  mailer: Mailer | null;
};

type Env = (name: string) => string | undefined;

export function ctxFromEnv(get: Env): Ctx {
  const need = (n: string) => {
    const v = get(n);
    if (!v) throw new Error(`missing env ${n}`);
    return v;
  };
  const url = need('SUPABASE_URL');
  const monoToken = get('MONO_TOKEN');
  const tgToken = get('TELEGRAM_BOT_TOKEN');
  const tgChat = get('TELEGRAM_CHAT_ID');
  return {
    db: createClient(url, need('SUPABASE_SERVICE_ROLE_KEY'), {auth: {persistSession: false, autoRefreshToken: false}}),
    np: {apiUrl: get('NP_API_URL') || 'https://api.novaposhta.ua/v2.0/json/', apiKey: get('NP_API_KEY') ?? ''},
    mono: monoToken ? {apiUrl: get('MONO_API_URL') || 'https://api.monobank.ua', token: monoToken} : null,
    siteUrl: need('SITE_URL').replace(/\/$/, ''),
    webhookUrl: get('MONO_WEBHOOK_URL') || `${url}/functions/v1/mono-webhook`,
    tokenSecret: need('ORDER_TOKEN_SECRET'),
    paymentValidityMinutes: Math.min(Math.max(Number(get('PAYMENT_VALIDITY_MINUTES') || 1440), 15), 7 * 1440),
    allowedOrigins: (get('ALLOWED_ORIGINS') ?? '').split(',').map(s => s.trim()).filter(Boolean),
    jobsSecret: get('JOBS_SECRET') ?? null,
    telegram: tgToken ? {token: tgToken, chatId: tgChat || null, apiUrl: get('TELEGRAM_API_URL') || 'https://api.telegram.org'} : null,
    supabaseUrl: url.replace(/\/$/, ''),
    anonKey: get('SUPABASE_ANON_KEY') ?? '',
    adminUrl: (get('ADMIN_URL') || `${need('SITE_URL').replace(/\/$/, '')}/admin`).replace(/\/$/, ''),
    // set by the jobs function (smtp.ts); other functions never send mail
    mailer: null,
  };
}
