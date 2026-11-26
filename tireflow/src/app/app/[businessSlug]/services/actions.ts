"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, nullish, zodFail, type ActionResult } from "@/lib/action";
import { parseMoney } from "@/lib/format";

const money = z.string().transform((v, ctx) => {
  const m = parseMoney(v);
  if (m === null) ctx.addIssue({ code: "custom", message: "money" });
  return m ?? 0;
});

const serviceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.preprocess(nullish, z.string().max(1000).nullable()),
  category_id: z.preprocess(nullish, z.uuid().nullable()),
  unit: z.enum(["job", "wheel", "piece", "hour"]),
  base_price: money,
  base_duration_min: z.coerce.number().int().min(0).max(600),
  online_bookable: z.boolean(),
  is_active: z.boolean(),
  required_equipment: z.string().default("").transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
});

export async function saveService(slug: string, id: string | null, values: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await requirePermission(slug, "services.manage", "services");
  const parsed = serviceSchema.safeParse(values);
  if (!parsed.success) return zodFail(parsed.error.issues);
  const supabase = await createClient();
  const q = id
    ? supabase.from("services").update(parsed.data).eq("id", id).eq("business_id", ctx.id).select("id").single()
    : supabase.from("services").insert({ ...parsed.data, business_id: ctx.id }).select("id").single();
  const { data, error } = await q;
  if (error) return fail(error);
  revalidatePath(`/app/${slug}/services`);
  return { ok: true, data: { id: data.id } };
}

const ruleSchema = z.object({
  kind: z.enum(["price", "duration"]),
  name: z.string().trim().min(1).max(80),
  service_id: z.preprocess(nullish, z.uuid().nullable()),
  priority: z.coerce.number().int().min(0).max(1000),
  vehicle_category_id: z.preprocess(nullish, z.uuid().nullable()),
  rim_min: z.preprocess(nullish, z.coerce.number().int().min(10).max(26).nullable()),
  rim_max: z.preprocess(nullish, z.coerce.number().int().min(10).max(26).nullable()),
  runflat: z.enum(["any", "yes", "no"]).transform((v) => (v === "any" ? null : v === "yes")),
  tpms: z.enum(["any", "yes", "no"]).transform((v) => (v === "any" ? null : v === "yes")),
  rim_type: z.preprocess(nullish, z.enum(["steel", "alloy"]).nullable()),
  adjustment: z.enum(["set", "add", "percent"]),
  amount: z.string().trim().min(1),
}).refine((r) => r.rim_min == null || r.rim_max == null || r.rim_min <= r.rim_max, { path: ["rim_max"], message: "range" });

export async function saveRule(slug: string, values: unknown): Promise<ActionResult> {
  const ctx = await requirePermission(slug, "services.manage", "services");
  const parsed = ruleSchema.safeParse(values);
  if (!parsed.success) return zodFail(parsed.error.issues);
  const { kind, amount, ...rule } = parsed.data;
  // price amounts are money (minor units) except percent (basis points); durations are minutes
  let value: number | null;
  if (rule.adjustment === "percent") value = Math.round(Number(amount.replace(",", ".")) * 100);
  else if (kind === "price") value = parseMoney(amount.replace(/^-/, "")) !== null ? (amount.trim().startsWith("-") ? -1 : 1) * parseMoney(amount.replace(/^-/, ""))! : null;
  else value = Math.round(Number(amount));
  if (value === null || !Number.isFinite(value)) return { ok: false, error: "validation", fields: { amount: "invalid" } };
  const supabase = await createClient();
  const table = kind === "price" ? "pricing_rules" : "duration_rules";
  const { error } = await supabase.from(table).insert({ ...rule, amount: value, business_id: ctx.id });
  if (error) return fail(error);
  revalidatePath(`/app/${slug}/services`);
  return { ok: true };
}

export async function deleteRule(slug: string, kind: "price" | "duration", id: string): Promise<ActionResult> {
  const ctx = await requirePermission(slug, "services.manage", "services");
  const supabase = await createClient();
  const { error } = await supabase.from(kind === "price" ? "pricing_rules" : "duration_rules").delete().eq("id", id).eq("business_id", ctx.id);
  if (error) return fail(error);
  revalidatePath(`/app/${slug}/services`);
  return { ok: true };
}
