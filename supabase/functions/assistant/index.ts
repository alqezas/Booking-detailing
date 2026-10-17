/**
 * Client assistant. Public: no account. It can only read the studio's public
 * card and free time through the same SQL functions the booking page uses —
 * it has no path to bookings, customers or payments.
 */
import {createClient} from '@supabase/supabase-js';
import {z} from 'zod';
import {runAgent} from '../_shared/agent.ts';
import {clientExecutor, clientFallback, clientSystemPrompt, type ClientSource, type PublicTenant} from '../_shared/client-domain.ts';
import {clientIp, corsHeaders, fail, json} from '../_shared/http.ts';
import {llmFromEnv} from '../_shared/llm.ts';
import {langOf, texts} from '../_shared/lang.ts';
import {localDate} from '../_shared/text.ts';

const Body = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,40}$/),
  message: z.string().trim().min(1).max(500),
  history: z
    .array(z.object({role: z.enum(['user', 'assistant']), content: z.string().max(1500)}))
    .max(12)
    .default([]),
  /** Interface language, for errors raised before the studio is known. */
  locale: z.string().max(10).optional(),
});

const env = (k: string) => Deno.env.get(k);
const svc = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, {auth: {persistSession: false}});

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: corsHeaders(req)});
  if (req.method !== 'POST') return fail(req, 405, 'METHOD', 'Only POST');

  const raw = await req.json().catch(() => null);
  let say = texts(langOf(typeof raw?.locale === 'string' ? raw.locale : null));
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return fail(req, 422, 'INVALID_INPUT', say.badQuestion);
  const {slug, message, history} = parsed.data;

  const ip = clientIp(req);
  const ipOk = await svc.rpc('svc_rate_limit_hit', {p_key: `ai:ip:${ip}`, p_limit: 20, p_window_seconds: 600});
  if (ipOk.error) return fail(req, 500, 'RATE_CHECK', say.unavailable);
  if (!ipOk.data) return fail(req, 429, 'RATE_LIMITED', say.tooMany);

  const t = await svc.rpc('public_get_tenant', {p_slug: slug});
  if (t.error) return fail(req, 404, 'TENANT_NOT_FOUND', say.studioNotFound);
  const tenant = t.data as PublicTenant & {id: string; assistant_enabled: boolean};
  say = texts(langOf(tenant.locale));
  if (!tenant.assistant_enabled) return fail(req, 403, 'DISABLED', say.disabled);

  const tenantOk = await svc.rpc('svc_rate_limit_hit', {p_key: `ai:tenant:${tenant.id}`, p_limit: 600, p_window_seconds: 3600});
  if (!tenantOk.data) return fail(req, 429, 'RATE_LIMITED', say.overloaded);

  const src: ClientSource = {
    tenant,
    availability: async (serviceId, from, days) => {
      const r = await svc.rpc('svc_public_availability', {p_slug: slug, p_service_id: serviceId, p_from: from, p_days: days});
      if (r.error) throw new Error(say.noSlotsData);
      return r.data;
    },
  };

  const llm = llmFromEnv(env);
  let budgetHit = false;
  const reply = await runAgent({
    scope: 'client',
    system: clientSystemPrompt(tenant, localDate(tenant.timezone)),
    history,
    user: message,
    execute: clientExecutor(src),
    fallback: async reason => {
      const r = await clientFallback(src, message);
      if (reason === 'budget') budgetHit = true;
      return {...r, notice: reason === 'no-model' ? undefined : say.simplified};
    },
    chat: llm.chat,
    model: llm.model,
    toolMode: llm.toolMode,
    reserve: async tokens => {
      const r = await svc.rpc('svc_llm_reserve', {
        p_tenant_id: tenant.id,
        p_tokens: tokens,
        p_tenant_limit: llm.tenantDailyTokens,
        p_global_limit: llm.globalDailyTokens,
      });
      return r.data === true;
    },
    settle: async (reserved, used) => {
      await svc.rpc('svc_llm_settle', {p_tenant_id: tenant.id, p_reserved: reserved, p_actual: used});
    },
  });

  return json(req, {...reply, budget_exhausted: budgetHit});
});
