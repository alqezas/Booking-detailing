/** Runtime configuration of the Edge Functions (read from Supabase secrets). */
import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import type {LiqPayConfig} from './liqpay.ts';
import type {NpConfig} from './np.ts';

export type Ctx = {
  /** service-role client: bypasses RLS, used only inside functions */
  db: SupabaseClient;
  np: NpConfig;
  /** null when LiqPay keys are not set: orders are kept, payment is reported unavailable */
  liqpay: LiqPayConfig | null;
  siteUrl: string;
  callbackUrl: string;
  tokenSecret: string;
  /** how long one LiqPay payment page stays valid (expired_date) */
  paymentValidityMinutes: number;
  allowedOrigins: string[];
  jobsSecret: string | null;
  telegram: {token: string; chatId: string; apiUrl: string} | null;
};

type Env = (name: string) => string | undefined;

export function ctxFromEnv(get: Env): Ctx {
  const need = (n: string) => {
    const v = get(n);
    if (!v) throw new Error(`missing env ${n}`);
    return v;
  };
  const url = need('SUPABASE_URL');
  const pub = get('LIQPAY_PUBLIC_KEY');
  const priv = get('LIQPAY_PRIVATE_KEY');
  const tgToken = get('TELEGRAM_BOT_TOKEN');
  const tgChat = get('TELEGRAM_CHAT_ID');
  return {
    db: createClient(url, need('SUPABASE_SERVICE_ROLE_KEY'), {auth: {persistSession: false, autoRefreshToken: false}}),
    np: {apiUrl: get('NP_API_URL') || 'https://api.novaposhta.ua/v2.0/json/', apiKey: get('NP_API_KEY') ?? ''},
    liqpay:
      pub && priv
        ? {
            publicKey: pub,
            privateKey: priv,
            apiUrl: get('LIQPAY_API_URL') || 'https://www.liqpay.ua',
            checkoutUrl: get('LIQPAY_CHECKOUT_URL') || undefined,
            algo: get('LIQPAY_SIGNATURE_ALGO') === 'sha1' ? 'sha1' : 'sha3-256',
            sandbox: get('LIQPAY_SANDBOX') === '1',
          }
        : null,
    siteUrl: need('SITE_URL').replace(/\/$/, ''),
    callbackUrl: get('LIQPAY_CALLBACK_URL') || `${url}/functions/v1/liqpay-callback`,
    tokenSecret: need('ORDER_TOKEN_SECRET'),
    paymentValidityMinutes: Math.min(Math.max(Number(get('PAYMENT_VALIDITY_MINUTES') || 1440), 15), 7 * 1440),
    allowedOrigins: (get('ALLOWED_ORIGINS') ?? '').split(',').map(s => s.trim()).filter(Boolean),
    jobsSecret: get('JOBS_SECRET') ?? null,
    telegram: tgToken && tgChat ? {token: tgToken, chatId: tgChat, apiUrl: get('TELEGRAM_API_URL') || 'https://api.telegram.org'} : null,
  };
}
