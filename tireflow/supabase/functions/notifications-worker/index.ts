// TireFlow · notifications worker (Supabase Edge Function, Deno).
// Called every minute by pg_cron (see migration 20261126001200_cron.sql).
// One central worker for all tenants: claims a small batch with SKIP LOCKED,
// sends through the configured adapter, then reports success/failure so the
// database handles retries with exponential backoff and the dead-letter state.
import { createClient } from "npm:@supabase/supabase-js@2";

type Job = {
  id: string; business_id: string; channel: string; recipient: string; subject: string | null; body: string; event: string;
};
type Result = { ok: boolean; provider: string; detail?: string; messageId?: string; retryable?: boolean };
type Adapter = (job: Job) => Promise<Result>;

const env = (k: string) => Deno.env.get(k) ?? "";

// ── adapters ─────────────────────────────────────────────────
// Test adapter: records the message and delivers nothing. The UI shows it as "Sent (test)".
const testAdapter: Adapter = async (job) => {
  console.log(`[test-adapter] ${job.channel} → ${job.recipient.replace(/\d(?=\d{3})/g, "•")}: ${job.body.slice(0, 80)}`);
  return { ok: true, provider: "test", messageId: `test-${crypto.randomUUID()}`, detail: "test adapter: not delivered" };
};

const resend: Adapter = async (job) => {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env("EMAIL_FROM"), to: job.recipient, subject: job.subject || "TireFlow", text: job.body }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, provider: "resend", messageId: data.id, detail: res.ok ? undefined : JSON.stringify(data).slice(0, 300), retryable: res.status >= 500 || res.status === 429 };
};

const twilio: Adapter = async (job) => {
  const sid = env("TWILIO_ACCOUNT_SID");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${sid}:${env("TWILIO_AUTH_TOKEN")}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ From: env("TWILIO_FROM"), To: job.recipient.replace(/[^\d+]/g, ""), Body: job.body }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, provider: "twilio", messageId: data.sid, detail: res.ok ? undefined : data.message, retryable: res.status >= 500 || res.status === 429 };
};

// Telegram needs the customer's chat id (stored as recipient once they started the bot).
const telegram: Adapter = async (job) => {
  const res = await fetch(`https://api.telegram.org/bot${env("TELEGRAM_BOT_TOKEN")}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: job.recipient, text: job.body }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data.ok, provider: "telegram_bot", messageId: String(data.result?.message_id ?? ""), detail: data.description, retryable: res.status >= 500 || res.status === 429 };
};

// Official WhatsApp Business Cloud API only. Business-initiated messages need an approved template.
const whatsapp: Adapter = async (job) => {
  const res = await fetch(`https://graph.facebook.com/v21.0/${env("WHATSAPP_PHONE_ID")}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env("WHATSAPP_TOKEN")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: job.recipient.replace(/[^\d]/g, ""), type: "text", text: { body: job.body } }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, provider: "whatsapp_cloud", messageId: data.messages?.[0]?.id, detail: res.ok ? undefined : data.error?.message, retryable: res.status >= 500 || res.status === 429 };
};

function adapterFor(channel: string, provider: string | undefined): Adapter {
  if (!provider || provider === "test") return testAdapter;
  if (channel === "email" && provider === "resend" && env("RESEND_API_KEY")) return resend;
  if (channel === "sms" && provider === "twilio" && env("TWILIO_ACCOUNT_SID")) return twilio;
  if (channel === "telegram" && provider === "telegram_bot" && env("TELEGRAM_BOT_TOKEN")) return telegram;
  if (channel === "whatsapp" && provider === "whatsapp_cloud" && env("WHATSAPP_TOKEN")) return whatsapp;
  // configured but secret missing: fail clearly instead of pretending success
  return async () => ({ ok: false, provider, detail: `provider ${provider} is not configured (missing secret)`, retryable: false });
}

Deno.serve(async (req) => {
  // only the scheduler (service role) may run the worker
  const auth = req.headers.get("Authorization") ?? "";
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!key || auth !== `Bearer ${key}`) return new Response("unauthorized", { status: 401 });

  const db = createClient(env("SUPABASE_URL"), key, { auth: { persistSession: false } });
  const worker = `edge-${crypto.randomUUID().slice(0, 8)}`;
  const { data: jobs, error } = await db.rpc("claim_notification_jobs", { p_worker: worker, p_limit: 40 });
  if (error) return new Response(error.message, { status: 500 });

  const providers = new Map<string, string>();
  const businesses = [...new Set((jobs as Job[]).map((j) => j.business_id))];
  if (businesses.length) {
    const { data } = await db.from("notification_channels").select("business_id, channel, provider, is_enabled").in("business_id", businesses);
    for (const c of data ?? []) if (c.is_enabled) providers.set(`${c.business_id}:${c.channel}`, c.provider);
  }

  let sent = 0, failed = 0;
  const started = Date.now();
  for (const job of jobs as Job[]) {
    if (Date.now() - started > 45_000) {
      // stay well inside the Edge Function time limit; unclaimed jobs are recovered by the next run
      await db.rpc("complete_notification_job", { p_job: job.id, p_ok: false, p_provider: "worker", p_detail: "deferred", p_retryable: true });
      continue;
    }
    const provider = providers.get(`${job.business_id}:${job.channel}`);
    if (!provider) {
      await db.rpc("complete_notification_job", { p_job: job.id, p_ok: false, p_provider: "none", p_detail: `channel ${job.channel} disabled`, p_retryable: false });
      failed++;
      continue;
    }
    let r: Result;
    try {
      r = await adapterFor(job.channel, provider)(job);
    } catch (e) {
      r = { ok: false, provider, detail: String(e).slice(0, 300), retryable: true };
    }
    await db.rpc("complete_notification_job", {
      p_job: job.id, p_ok: r.ok, p_provider: r.provider, p_detail: r.detail ?? null, p_message_id: r.messageId ?? null, p_retryable: r.retryable ?? true,
    });
    if (r.ok) sent++;
    else failed++;
  }
  return Response.json({ worker, claimed: (jobs as Job[]).length, sent, failed });
});
