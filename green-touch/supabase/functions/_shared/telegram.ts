/**
 * Telegram bot: order notifications for the owner.
 *
 * A chat is connected only after signing in in the bot with an admin's email
 * and password (the same as /admin). The message with the password is deleted
 * from the chat at once and the password is never stored. Anyone else who finds
 * the bot gets nothing.
 */
import {createClient} from '@supabase/supabase-js';
import type {Ctx} from './ctx.ts';
import {formatUah} from './contracts.ts';
import {hmacSha256, timingSafeEqual, toHex} from './crypto.ts';
import {corsHeaders, json, rateLimit} from './http.ts';

export type TgConfig = {token: string; apiUrl: string; chatId: string | null};

export async function tgCall<T = unknown>(tg: TgConfig, method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${tg.apiUrl}/bot${tg.token}/${method}`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`telegram http ${res.status}`);
  return ((await res.json()) as {result: T}).result;
}

/** Secret Telegram sends back in X-Telegram-Bot-Api-Secret-Token (no extra env needed). */
export const webhookSecret = async (ctx: Ctx) => toHex(await hmacSha256(ctx.tokenSecret, 'telegram-webhook')).slice(0, 48);

// ── messages ────────────────────────────────────────────────────────────────
export type OrderForTg = {
  id: string;
  number: number;
  first_name: string;
  last_name: string;
  phone: string;
  total_kop: number;
  payment_method: 'full_online' | 'prepay_manual';
  prepay_kop: number;
  delivery_method: 'np_branch' | 'np_postomat';
  np_settlement_name: string;
  np_warehouse_name: string;
  comment: string | null;
  lines: {name: string; volume: string | null; qty: number}[];
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** HTML text (Telegram parse_mode HTML) for an outbox event. */
export function orderMessage(topic: string, o: OrderForTg, adminUrl: string, reason?: string): string {
  const head =
    topic === 'payment.needs_review'
      ? `⚠️ <b>Замовлення №${o.number} потребує перевірки</b>${reason ? ` (${esc(reason)})` : ''}`
      : `🛍 <b>Нове оплачене замовлення №${o.number}</b>`;
  const pay =
    o.payment_method === 'full_online'
      ? 'оплачено повністю через monobank'
      : `передоплату ${formatUah(o.prepay_kop)} отримано, решта ${formatUah(o.total_kop - o.prepay_kop)} — накладеним платежем`;
  const out = [head, '', `${esc(o.first_name)} ${esc(o.last_name)}, ${esc(o.phone)}`, `Сума: <b>${formatUah(o.total_kop)}</b>`, `Оплата: ${pay}`];
  if (topic !== 'payment.needs_review') {
    out.push(`Доставка: ${o.delivery_method === 'np_postomat' ? 'поштомат' : 'відділення'} НП, ${esc(o.np_settlement_name)}, ${esc(o.np_warehouse_name)}`);
    out.push('', ...o.lines.map(l => `• ${esc(l.name)}${l.volume ? `, ${esc(l.volume)}` : ''} × ${l.qty}`));
    if (o.comment) out.push('', `Коментар: ${esc(o.comment)}`);
  }
  out.push('', `<a href="${adminUrl}/zamovlennia/${o.id}">Відкрити в адмінці</a>`);
  return out.join('\n');
}

// ── notifications ───────────────────────────────────────────────────────────
/** Chats of users who are still admins (removing an admin stops their notifications). */
export async function adminChats(ctx: Ctx): Promise<number[]> {
  const [chats, admins] = await Promise.all([ctx.db.from('telegram_chats').select('chat_id,user_id'), ctx.db.from('admins').select('user_id')]);
  if (chats.error) throw new Error(`telegram chats: ${chats.error.message}`);
  if (admins.error) throw new Error(`admins: ${admins.error.message}`);
  const ok = new Set((admins.data ?? []).map(a => a.user_id));
  return (chats.data ?? []).filter(c => ok.has(c.user_id)).map(c => Number(c.chat_id));
}

// ── webhook: the sign-in dialog ─────────────────────────────────────────────
type TgMessage = {message_id: number; chat: {id: number; type: string}; from?: {username?: string; first_name?: string; last_name?: string}; text?: string};

const HELP = 'Цей бот надсилає власниці Green Touch сповіщення про нові замовлення.\n\n/start — увійти (email і пароль від адмінки)\n/stop — вимкнути сповіщення';
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,120}\.[^\s@]{2,}$/;

async function onMessage(ctx: Ctx, tg: TgConfig, m: TgMessage): Promise<void> {
  const chat = m.chat.id;
  const say = (text: string) => tgCall(tg, 'sendMessage', {chat_id: chat, text});
  if (m.chat.type !== 'private') return void (await say('Бот працює лише в особистому чаті.'));
  const text = (m.text ?? '').trim();
  const cmd = text.split(/\s|@/)[0]!.toLowerCase();

  if (cmd === '/stop') {
    await ctx.db.from('telegram_chats').delete().eq('chat_id', chat);
    await ctx.db.from('telegram_login').delete().eq('chat_id', chat);
    return void (await say('Сповіщення вимкнено. Щоб увімкнути знову — /start.'));
  }
  if (cmd === '/help') return void (await say(HELP));
  if (cmd === '/start') {
    const {data: linked} = await ctx.db.from('telegram_chats').select('chat_id').eq('chat_id', chat).maybeSingle();
    if (linked) return void (await say('✅ Цей чат уже підключено: сюди приходять нові замовлення. Вимкнути — /stop.'));
    await ctx.db.from('telegram_login').upsert({chat_id: chat, step: 'email', email: null, updated_at: new Date().toISOString()});
    return void (await say('Вхід для власниці Green Touch.\n\nНадішліть email, з яким ви входите в адмінку.'));
  }

  const {data: st} = await ctx.db.from('telegram_login').select('step,email,updated_at').eq('chat_id', chat).maybeSingle();
  // the dialog expires after 10 minutes
  if (!st || Date.now() - new Date(st.updated_at).getTime() > 10 * 60_000) {
    if (st) await ctx.db.from('telegram_login').delete().eq('chat_id', chat);
    return void (await say(HELP));
  }
  if (st.step === 'email') {
    if (!EMAIL_RE.test(text)) return void (await say('Це не схоже на email. Надішліть email від адмінки.'));
    await ctx.db.from('telegram_login').update({step: 'password', email: text.toLowerCase(), updated_at: new Date().toISOString()}).eq('chat_id', chat);
    return void (await say('Тепер надішліть пароль. Повідомлення з паролем бот одразу видалить із чату.'));
  }

  // step = password: remove it from the chat first, whatever happens next
  await tgCall(tg, 'deleteMessage', {chat_id: chat, message_id: m.message_id}).catch(() => undefined);
  await ctx.db.from('telegram_login').delete().eq('chat_id', chat);
  try {
    await rateLimit(ctx.db, `tg-login:${chat}`, 5, 15 * 60);
  } catch {
    return void (await say('Забагато спроб. Спробуйте за 15 хвилин: /start.'));
  }
  const auth = createClient(ctx.supabaseUrl, ctx.anonKey, {auth: {persistSession: false, autoRefreshToken: false}});
  const {data, error} = await auth.auth.signInWithPassword({email: st.email ?? '', password: text});
  const userId = data.user?.id;
  if (data.session) await auth.auth.signOut().catch(() => undefined); // the bot needs no session
  const {data: isAdmin} = userId ? await ctx.db.from('admins').select('user_id').eq('user_id', userId).maybeSingle() : {data: null};
  if (error || !userId || !isAdmin) return void (await say('Невірний email або пароль. Спробувати ще раз — /start.'));
  const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ').slice(0, 128) || null;
  const {error: e2} = await ctx.db.from('telegram_chats').upsert({chat_id: chat, user_id: userId, tg_username: m.from?.username?.slice(0, 64) ?? null, tg_name: name});
  if (e2) throw new Error(`link chat: ${e2.message}`);
  await say('✅ Готово! Сюди приходитимуть нові замовлення та онлайн-оплати.\n\nВимкнути сповіщення — /stop.');
}

/** Admin button «Підключити бота»: points Telegram at this function and returns the bot link. */
async function setup(ctx: Ctx, tg: TgConfig, req: Request): Promise<Response> {
  const cors = setupCors(req);
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const {data: u} = jwt ? await ctx.db.auth.getUser(jwt) : {data: {user: null}};
  const {data: isAdmin} = u.user ? await ctx.db.from('admins').select('user_id').eq('user_id', u.user.id).maybeSingle() : {data: null};
  if (!isAdmin) return json({error: 'FORBIDDEN'}, 403, cors);
  await tgCall(tg, 'setWebhook', {url: `${ctx.supabaseUrl}/functions/v1/telegram`, secret_token: await webhookSecret(ctx), allowed_updates: ['message'], drop_pending_updates: true});
  await tgCall(tg, 'setMyCommands', {commands: [{command: 'start', description: 'Увійти й отримувати замовлення'}, {command: 'stop', description: 'Вимкнути сповіщення'}]});
  const me = await tgCall<{username: string}>(tg, 'getMe', {});
  return json({username: me.username}, 200, cors);
}

// The admin lives on its own origin; the call is authorised by the admin's JWT (no cookies), so reflecting the origin is safe.
const setupCors = (req: Request) => corsHeaders(req.headers.get('origin'), []);

export async function handleTelegram(req: Request, ctx: Ctx): Promise<Response> {
  const cors = setupCors(req);
  if (req.method === 'OPTIONS') return new Response(null, {headers: cors});
  if (!ctx.telegram) return json({error: 'TELEGRAM_NOT_CONFIGURED'}, 503, cors);
  const tg = ctx.telegram;
  const secret = req.headers.get('x-telegram-bot-api-secret-token');
  if (secret === null) return setup(ctx, tg, req).catch(e => (console.error('tg setup:', e instanceof Error ? e.message.slice(0, 200) : 'unknown'), json({error: 'TELEGRAM_ERROR'}, 502, cors)));
  if (!timingSafeEqual(secret, await webhookSecret(ctx))) return json({error: 'FORBIDDEN'}, 403);
  try {
    const update = (await req.json()) as {message?: TgMessage};
    if (update.message) await onMessage(ctx, tg, update.message);
  } catch (e) {
    console.error('tg update:', e instanceof Error ? e.message.slice(0, 200) : 'unknown');
  }
  return json({ok: true}); // always 200: Telegram would resend the same update otherwise
}
