"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, nullish, zodFail, type ActionResult } from "@/lib/action";
import { parseMoney } from "@/lib/format";

const locales = ["cs", "pl", "uk", "sk", "de", "en", "ru"] as const;
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const settingsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.preprocess(nullish, z.email().nullable()),
  phone: z.preprocess(nullish, z.string().max(30).nullable()),
  website: z.preprocess(nullish, z.url().nullable()),
  tax_id: z.preprocess(nullish, z.string().max(30).nullable()),
  currency: z.enum(["CZK", "EUR", "PLN", "UAH"]),
  crm_locale: z.enum(locales),
  public_locale: z.enum(locales),
  timezone: z.enum(["Europe/Prague", "Europe/Warsaw", "Europe/Kyiv", "Europe/Bratislava", "Europe/Vienna", "Europe/Berlin"]),
  tax_pct: z.coerce.number().min(0).max(100),
  prices_include_tax: z.boolean(),
  storage_price: z.string(),
  brand_color: hex,
  accent_color: hex,
  slot_step_minutes: z.coerce.number().refine((v) => [5, 10, 15, 20, 30, 60].includes(v)),
  booking_lead_minutes: z.coerce.number().int().min(0).max(10080),
  booking_horizon_days: z.coerce.number().int().min(1).max(365),
  booking_cancel_until_minutes: z.coerce.number().int().min(0).max(10080),
  booking_requires_confirmation: z.boolean(),
  seasonal_mode: z.boolean(),
  order_number_prefix: z.string().trim().min(1).max(8),
});

export async function saveSettings(slug: string, values: unknown): Promise<ActionResult> {
  const ctx = await requirePermission(slug, "business.manage");
  const parsed = settingsSchema.safeParse(values);
  if (!parsed.success) return zodFail(parsed.error.issues);
  const { name, tax_pct, storage_price, ...s } = parsed.data;
  const price = parseMoney(storage_price);
  if (price === null) return { ok: false, error: "invalid_amount" };
  const supabase = await createClient();
  const [a, b] = await Promise.all([
    supabase.from("businesses").update({ name }).eq("id", ctx.id),
    supabase.from("business_settings").update({ ...s, default_tax_rate_bp: Math.round(tax_pct * 100), storage_price_per_season: price }).eq("business_id", ctx.id),
  ]);
  if (a.error || b.error) return fail(a.error ?? b.error);
  revalidatePath(`/app/${slug}`, "layout");
  return { ok: true };
}

export async function setLogo(slug: string, path: string | null): Promise<ActionResult> {
  const ctx = await requirePermission(slug, "business.manage");
  if (path && !path.startsWith(`${ctx.id}/`)) return { ok: false, error: "forbidden" };
  const supabase = await createClient();
  const { error } = await supabase.from("business_settings").update({ logo_path: path }).eq("business_id", ctx.id);
  if (error) return fail(error);
  revalidatePath(`/app/${slug}/settings`);
  return { ok: true };
}

export async function toggleModule(slug: string, module: string, enabled: boolean): Promise<ActionResult> {
  const ctx = await requirePermission(slug, "business.manage");
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_module", { p_business: ctx.id, p_module: module as never, p_enabled: enabled });
  if (error) return fail(error);
  revalidatePath(`/app/${slug}`, "layout");
  return { ok: true };
}

const time = z.string().regex(/^\d{2}:\d{2}$/);
const branchSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address_line: z.preprocess(nullish, z.string().max(200).nullable()),
  city: z.preprocess(nullish, z.string().max(80).nullable()),
  postal_code: z.preprocess(nullish, z.string().max(20).nullable()),
  country: z.string().regex(/^[A-Z]{2}$/),
  phone: z.preprocess(nullish, z.string().max(30).nullable()),
  opening_hours: z.record(z.enum(["1", "2", "3", "4", "5", "6", "7"]), z.array(z.tuple([time, time])).max(3)),
});

export async function saveBranch(slug: string, id: string | null, values: unknown): Promise<ActionResult> {
  const ctx = await requirePermission(slug, "business.manage");
  const parsed = branchSchema.safeParse(values);
  if (!parsed.success) return zodFail(parsed.error.issues);
  const supabase = await createClient();
  if (!id) {
    const { data: biz } = await supabase.from("businesses").select("max_branches").eq("id", ctx.id).single();
    if (biz && ctx.branches.length >= biz.max_branches) return { ok: false, error: "user_limit_reached" };
  }
  const { error } = id
    ? await supabase.from("branches").update(parsed.data).eq("id", id).eq("business_id", ctx.id)
    : await supabase.from("branches").insert({ ...parsed.data, business_id: ctx.id });
  if (error) return fail(error);
  revalidatePath(`/app/${slug}`, "layout");
  return { ok: true };
}

const postSchema = z.object({
  branch_id: z.uuid(),
  name: z.string().trim().min(1).max(60),
  kind: z.enum(["general", "truck", "express", "alignment", "repair"]),
  equipment: z.string().default("").transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
  is_active: z.boolean(),
});

export async function savePost(slug: string, id: string | null, values: unknown): Promise<ActionResult> {
  const ctx = await requirePermission(slug, "business.manage");
  const parsed = postSchema.safeParse(values);
  if (!parsed.success) return zodFail(parsed.error.issues);
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("workstations").update(parsed.data).eq("id", id).eq("business_id", ctx.id)
    : await supabase.from("workstations").insert({ ...parsed.data, business_id: ctx.id });
  if (error) return fail(error);
  revalidatePath(`/app/${slug}/settings`);
  return { ok: true };
}

/** Invites a colleague by email and gives them a role. Auth invite uses the secret key server-side only. */
export async function inviteMember(slug: string, email: string, role: "owner" | "manager" | "mechanic" | "accountant", employeeId?: string): Promise<ActionResult> {
  const ctx = await requirePermission(slug, "members.manage");
  const e = z.email().safeParse(email);
  if (!e.success) return { ok: false, error: "validation" };
  const admin = createAdminClient();
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? (await headers()).get("origin") ?? "";
  let userId: string | null = null;
  const inv = await admin.auth.admin.inviteUserByEmail(e.data, { redirectTo: `${origin}/auth/callback?next=/auth/update-password` });
  if (inv.data.user) userId = inv.data.user.id;
  else {
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    userId = data?.users.find((u) => u.email?.toLowerCase() === e.data.toLowerCase())?.id ?? null;
  }
  if (!userId) return { ok: false, error: "generic" };
  const supabase = await createClient();
  const { data: membershipId, error } = await supabase.rpc("add_member", { p_business: ctx.id, p_user: userId, p_role: role });
  if (error) return fail(error);
  if (employeeId) await supabase.from("employees").update({ membership_id: membershipId }).eq("id", employeeId).eq("business_id", ctx.id);
  revalidatePath(`/app/${slug}/settings`);
  return { ok: true };
}
