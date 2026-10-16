/**
 * Owner assistant. Requires the owner's Supabase session. Every data call is
 * made WITH THE OWNER'S JWT, so the database itself checks membership (RLS +
 * private.require_member). Tools are read-only.
 */
import {createClient} from '@supabase/supabase-js';
import {z} from 'zod';
import {runAgent} from '../_shared/agent.ts';
import {corsHeaders, fail, json} from '../_shared/http.ts';
import {llmFromEnv} from '../_shared/llm.ts';
import {ownerExecutor, ownerFallback, ownerSystemPrompt, type OwnerSource} from '../_shared/owner-domain.ts';
import {localDate} from '../_shared/text.ts';

const Body = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,40}$/),
  message: z.string().trim().min(1).max(500),
  history: z
    .array(z.object({role: z.enum(['user', 'assistant']), content: z.string().max(3000)}))
    .max(12)
    .default([]),
});

const env = (k: string) => Deno.env.get(k);
const svc = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, {auth: {persistSession: false}});

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: corsHeaders(req)});
  if (req.method !== 'POST') return fail(req, 405, 'METHOD', 'Только POST');

  const auth = req.headers.get('authorization') ?? '';
  if (!/^Bearer\s+\S+/.test(auth)) return fail(req, 401, 'UNAUTHORIZED', 'Войдите в кабинет');
  const user = createClient(env('SUPABASE_URL')!, env('SUPABASE_ANON_KEY')!, {
    auth: {persistSession: false},
    global: {headers: {Authorization: auth}},
  });
  const who = await user.auth.getUser(auth.replace(/^Bearer\s+/, ''));
  if (who.error || !who.data.user) return fail(req, 401, 'UNAUTHORIZED', 'Сессия истекла, войдите снова');

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(req, 422, 'INVALID_INPUT', 'Напишите вопрос до 500 символов');
  const {slug, message, history} = parsed.data;

  // RLS returns the studio only to its members.
  const t = await user.from('tenants').select('id, name, timezone, currency').eq('slug', slug).maybeSingle();
  if (t.error || !t.data) return fail(req, 403, 'FORBIDDEN', 'Нет доступа к этой студии');
  const tenant = t.data as {id: string; name: string; timezone: string; currency: string};

  const rl = await svc.rpc('svc_rate_limit_hit', {p_key: `ai:owner:${who.data.user.id}`, p_limit: 40, p_window_seconds: 600});
  if (!rl.data) return fail(req, 429, 'RATE_LIMITED', 'Слишком много вопросов подряд. Подождите пару минут.');

  const src: OwnerSource = {
    timezone: tenant.timezone,
    currency: tenant.currency,
    studioName: tenant.name,
    stats: async (period, anchor) => {
      const r = await user.rpc('owner_stats', {p_tenant_id: tenant.id, p_period: period, p_anchor: anchor});
      if (r.error) throw new Error(r.error.hint ?? 'Не удалось посчитать');
      return r.data;
    },
    bookings: async (from, to) => {
      const r = await user.rpc('owner_bookings', {p_tenant_id: tenant.id, p_from: from, p_to: to});
      if (r.error) throw new Error(r.error.hint ?? 'Не удалось получить записи');
      return r.data;
    },
  };

  const llm = llmFromEnv(env);
  const reply = await runAgent({
    scope: 'owner',
    system: ownerSystemPrompt(src, localDate(tenant.timezone)),
    history,
    user: message,
    execute: ownerExecutor(src),
    fallback: async reason => ({...(await ownerFallback(src, message)), notice: reason === 'no-model' ? undefined : 'Помощник отвечает в упрощённом режиме'}),
    chat: llm.chat,
    model: llm.model,
    toolMode: llm.toolMode,
    reserve: async tokens =>
      (await svc.rpc('svc_llm_reserve', {p_tenant_id: tenant.id, p_tokens: tokens, p_tenant_limit: llm.tenantDailyTokens, p_global_limit: llm.globalDailyTokens})).data === true,
    settle: async (reserved, used) => {
      await svc.rpc('svc_llm_settle', {p_tenant_id: tenant.id, p_reserved: reserved, p_actual: used});
    },
  });
  return json(req, reply);
});
