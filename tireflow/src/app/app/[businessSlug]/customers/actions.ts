"use server";
import { revalidatePath } from "next/cache";
import { customerSchema, vehicleSchema } from "@/lib/schemas";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, zodFail, type ActionResult } from "@/lib/action";

export async function saveCustomer(slug: string, id: string | null, values: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await requirePermission(slug, "customers.manage");
  const parsed = customerSchema.safeParse(values);
  if (!parsed.success) return zodFail(parsed.error.issues);
  const { discount_pct, consent_marketing, ...rest } = parsed.data;
  const row = { ...rest, discount_bp: Math.round((discount_pct ?? 0) * 100) };
  const supabase = await createClient();

  if (id) {
    const { error } = await supabase.from("customers").update(row).eq("id", id).eq("business_id", ctx.id);
    if (error) return fail(error);
  } else {
    const { data, error } = await supabase.from("customers").insert({ ...row, business_id: ctx.id, source: "manual" }).select("id").single();
    if (error) return fail(error);
    id = data.id;
    await supabase.from("customer_consents").insert({ business_id: ctx.id, customer_id: id, kind: "data_processing", granted: true, source: "staff" });
  }
  // marketing consent is a journal: only record changes
  const { data: current } = await supabase.from("customer_consent_state").select("granted").eq("customer_id", id!).eq("kind", "marketing_sms").maybeSingle();
  if ((current?.granted ?? false) !== consent_marketing) {
    await supabase.from("customer_consents").insert([
      { business_id: ctx.id, customer_id: id!, kind: "marketing_sms", granted: consent_marketing, source: "staff" },
      { business_id: ctx.id, customer_id: id!, kind: "marketing_email", granted: consent_marketing, source: "staff" },
    ]);
  }
  revalidatePath(`/app/${slug}/customers`);
  return { ok: true, data: { id: id! } };
}

export async function saveVehicle(slug: string, customerId: string | null, vehicleId: string | null, values: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await requirePermission(slug, "customers.manage");
  const parsed = vehicleSchema.safeParse(values);
  if (!parsed.success) return zodFail(parsed.error.issues);
  const supabase = await createClient();
  if (vehicleId) {
    const { error } = await supabase.from("vehicles").update(parsed.data).eq("id", vehicleId).eq("business_id", ctx.id);
    if (error) return fail(error);
    revalidatePath(`/app/${slug}/vehicles`);
    return { ok: true, data: { id: vehicleId } };
  }
  const { data, error } = await supabase.from("vehicles")
    .insert({ ...parsed.data, business_id: ctx.id, customer_id: customerId }).select("id").single();
  if (error) return fail(error);
  revalidatePath(`/app/${slug}/customers`);
  return { ok: true, data: { id: data.id } };
}

export async function exportCustomer(slug: string, id: string): Promise<ActionResult<{ json: string }>> {
  const ctx = await requirePermission(slug, "customers.export");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("export_customer", { p_business: ctx.id, p_customer: id });
  if (error) return fail(error);
  return { ok: true, data: { json: JSON.stringify(data, null, 2) } };
}

export async function anonymizeCustomer(slug: string, id: string): Promise<ActionResult> {
  const ctx = await requirePermission(slug, "customers.manage");
  const supabase = await createClient();
  const { error } = await supabase.rpc("anonymize_customer", { p_business: ctx.id, p_customer: id });
  if (error) return fail(error);
  revalidatePath(`/app/${slug}/customers/${id}`);
  return { ok: true };
}

export async function mergeCustomers(slug: string, keep: string, merge: string): Promise<ActionResult> {
  const ctx = await requirePermission(slug, "customers.manage");
  const supabase = await createClient();
  const { error } = await supabase.rpc("merge_customers", { p_business: ctx.id, p_keep: keep, p_merge: merge });
  if (error) return fail(error);
  revalidatePath(`/app/${slug}/customers`);
  return { ok: true };
}

/** CSV import: first_name,last_name,phone,email,plate. Rows are validated one by one. */
export async function importCustomers(slug: string, csv: string): Promise<ActionResult<{ imported: number; skipped: number }>> {
  const ctx = await requirePermission(slug, "customers.manage");
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 5001) return { ok: false, error: "too_many_rows" };
  const header = lines.shift()?.toLowerCase().split(/[,;]/).map((h) => h.trim()) ?? [];
  const idx = (k: string) => header.indexOf(k);
  const supabase = await createClient();
  let imported = 0, skipped = 0;
  for (const line of lines) {
    const cells = line.split(/[,;]/).map((c) => c.trim().replace(/^"|"$/g, ""));
    const get = (k: string) => (idx(k) >= 0 ? cells[idx(k)] ?? "" : "");
    const parsed = customerSchema.safeParse({ first_name: get("first_name"), last_name: get("last_name"), phone: get("phone"), email: get("email") });
    if (!parsed.success) { skipped++; continue; }
    const row: Record<string, unknown> = { ...parsed.data };
    delete row.discount_pct;
    delete row.consent_marketing;
    const { data, error } = await supabase.from("customers").insert({ ...(row as { first_name: string }), business_id: ctx.id, source: "import" }).select("id").single();
    if (error) { skipped++; continue; }
    imported++;
    const plate = get("plate");
    if (plate) await supabase.from("vehicles").insert({ business_id: ctx.id, customer_id: data.id, make: get("make") || "—", plate });
  }
  revalidatePath(`/app/${slug}/customers`);
  return { ok: true, data: { imported, skipped } };
}
