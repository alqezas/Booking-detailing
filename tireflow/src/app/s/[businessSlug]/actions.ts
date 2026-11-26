"use server";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fail, zodFail, type ActionResult } from "@/lib/action";

// Public, unauthenticated server actions. Every check (bookable services, hours,
// horizon, rate limits) is enforced again inside the SECURITY DEFINER RPCs.

async function fingerprint() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  // hashed: the raw IP is never stored
  return createHash("sha256").update(`${ip}|${process.env.SUPABASE_PROJECT_REF ?? ""}`).digest("hex").slice(0, 24);
}

const params = z.object({
  vehicle_category_id: z.uuid().nullish(),
  rim: z.number().int().min(10).max(26).nullish(),
  tpms: z.boolean().nullish(),
  runflat: z.boolean().nullish(),
  wheel_count: z.number().int().min(1).max(10).nullish(),
});

export async function publicQuote(slug: string, services: string[], p: unknown) {
  const parsed = params.safeParse(p);
  if (!parsed.success || !z.array(z.uuid()).min(1).max(10).safeParse(services).success) return null;
  const supabase = await createClient();
  const { data } = await supabase.rpc("public_quote", { p_slug: slug, p_services: services, p_params: parsed.data });
  return data as { total: number; duration_min: number } | null;
}

export async function publicSlots(slug: string, branchId: string, day: string, services: string[], p: unknown) {
  const parsed = params.safeParse(p);
  if (!parsed.success || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !z.uuid().safeParse(branchId).success) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc("public_slots", { p_slug: slug, p_branch: branchId, p_day: day, p_services: services, p_params: parsed.data });
  return (data ?? []).map((s) => s.starts_at);
}

const bookSchema = z.object({
  branch_id: z.uuid(),
  service_ids: z.array(z.uuid()).min(1).max(10),
  vehicle_params: params,
  starts_at: z.iso.datetime({ offset: true }),
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().max(100).default(""),
  phone: z.string().trim().min(6).max(25),
  email: z.union([z.email(), z.literal("")]).default(""),
  plate: z.string().trim().max(16).default(""),
  note: z.string().max(1000).default(""),
  locale: z.string().max(2),
  consent_marketing: z.boolean().default(false),
  website: z.string().max(0).default(""), // honeypot: bots fill it
});

export async function publicBook(slug: string, values: unknown): Promise<ActionResult<{ token: string }>> {
  const parsed = bookSchema.safeParse(values);
  if (!parsed.success) return zodFail(parsed.error.issues);
  const p: Record<string, unknown> = { ...parsed.data };
  delete p.website; // honeypot field is never forwarded
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("public_create_booking", { p_slug: slug, p: { ...p, client_fingerprint: await fingerprint() } as never });
  if (error) return fail(error);
  return { ok: true, data: { token: (data as { token: string }).token } };
}

export async function publicCancel(token: string): Promise<ActionResult> {
  if (!/^[0-9a-f]{48}$/.test(token)) return { ok: false, error: "generic" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("public_cancel_booking", { p_token: token });
  if (error) return fail(error);
  return { ok: true };
}

export async function publicReschedule(token: string, startsAt: string): Promise<ActionResult> {
  if (!/^[0-9a-f]{48}$/.test(token) || !z.iso.datetime({ offset: true }).safeParse(startsAt).success) return { ok: false, error: "generic" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("public_reschedule_booking", { p_token: token, p_starts_at: startsAt });
  if (error) return fail(error);
  return { ok: true };
}
