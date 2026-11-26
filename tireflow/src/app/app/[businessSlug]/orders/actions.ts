"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can, requireBusiness, requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, zodFail, type ActionResult } from "@/lib/action";
import { parseMoney } from "@/lib/format";

const createSchema = z.object({
  branch_id: z.uuid(),
  customer_id: z.uuid().nullable(),
  vehicle_id: z.uuid().nullable(),
  employee_id: z.uuid().nullable(),
  workstation_id: z.uuid().nullable(),
  service_ids: z.array(z.uuid()),
  vehicle_params: z.record(z.string(), z.unknown()),
  status: z.enum(["draft", "scheduled", "in_progress"]),
  idempotency_key: z.string().min(8),
});

export async function createWorkOrder(slug: string, values: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await requirePermission(slug, "orders.manage", "orders");
  const parsed = createSchema.safeParse(values);
  if (!parsed.success) return zodFail(parsed.error.issues);
  const { idempotency_key, ...p } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_work_order", { p_business: ctx.id, p: p as never, p_idempotency_key: idempotency_key });
  if (error) return fail(error);
  revalidatePath(`/app/${slug}/orders`);
  return { ok: true, data: { id: data } };
}

export async function addItem(slug: string, orderId: string, item: { kind: "service" | "product" | "custom"; service_id?: string; product_id?: string; warehouse_id?: string; quantity?: number; name?: string; unit_price?: string; is_additional?: boolean }): Promise<ActionResult> {
  const ctx = await requirePermission(slug, "orders.manage", "orders");
  const p: Record<string, unknown> = { ...item };
  if (item.kind === "custom") {
    const price = parseMoney(item.unit_price ?? "");
    if (price === null) return { ok: false, error: "invalid_amount" };
    p.unit_price = price;
  } else delete p.unit_price; // prices of catalog items always come from the database
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_work_order_item", { p_business: ctx.id, p_order: orderId, p: p as never });
  if (error) return fail(error);
  revalidatePath(`/app/${slug}/orders/${orderId}`);
  return { ok: true };
}

export async function removeItem(slug: string, orderId: string, itemId: string): Promise<ActionResult> {
  const ctx = await requirePermission(slug, "orders.manage", "orders");
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_work_order_item", { p_business: ctx.id, p_item: itemId });
  if (error) return fail(error);
  revalidatePath(`/app/${slug}/orders/${orderId}`);
  return { ok: true };
}

export async function decideItem(slug: string, orderId: string, itemId: string, approved: boolean): Promise<ActionResult> {
  const ctx = await requirePermission(slug, "orders.manage", "orders");
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_additional_work", { p_business: ctx.id, p_item: itemId, p_approved: approved });
  if (error) return fail(error);
  revalidatePath(`/app/${slug}/orders/${orderId}`);
  return { ok: true };
}

export async function setOrderStatus(slug: string, orderId: string, status: "scheduled" | "in_progress" | "ready" | "completed" | "cancelled"): Promise<ActionResult> {
  const ctx = await requireBusiness(slug);
  if (!can(ctx, "orders.manage") && !can(ctx, "orders.work")) return { ok: false, error: "forbidden" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_work_order_status", { p_business: ctx.id, p_order: orderId, p_status: status });
  if (error) return fail(error);
  revalidatePath(`/app/${slug}/orders/${orderId}`);
  revalidatePath(`/app/${slug}/my-work`);
  return { ok: true };
}

export async function updateOrderNotes(slug: string, orderId: string, values: { damage_notes?: string; internal_note?: string; mileage_km?: string; employee_id?: string }): Promise<ActionResult> {
  const ctx = await requireBusiness(slug);
  if (!can(ctx, "orders.manage") && !can(ctx, "orders.work")) return { ok: false, error: "forbidden" };
  const supabase = await createClient();
  const mileage = values.mileage_km ? Number(values.mileage_km) : undefined;
  if (mileage !== undefined && (!Number.isInteger(mileage) || mileage < 0)) return { ok: false, error: "validation" };
  // assignee check happens inside the RPC
  const { error } = await supabase.rpc("update_work_notes", {
    p_business: ctx.id, p_order: orderId, p_damage: values.damage_notes ?? undefined, p_note: values.internal_note ?? undefined, p_mileage: mileage,
  } as never);
  if (error) return fail(error);
  if (values.employee_id !== undefined && can(ctx, "orders.manage")) {
    const { error: e2 } = await supabase.from("work_orders").update({ employee_id: values.employee_id || null }).eq("id", orderId).eq("business_id", ctx.id);
    if (e2) return fail(e2);
  }
  revalidatePath(`/app/${slug}/orders/${orderId}`);
  revalidatePath(`/app/${slug}/my-work`);
  return { ok: true };
}

export async function recordPayment(slug: string, orderId: string, amount: string, methodId: string, key: string): Promise<ActionResult> {
  const ctx = await requirePermission(slug, "finance.manage");
  const minor = parseMoney(amount);
  if (!minor) return { ok: false, error: "invalid_amount" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_payment", { p_business: ctx.id, p_order: orderId, p_amount: minor, p_method: methodId, p_idempotency_key: key });
  if (error) return fail(error);
  revalidatePath(`/app/${slug}/orders/${orderId}`);
  return { ok: true };
}

export async function refundPayment(slug: string, orderId: string, paymentId: string, amount: string, reason: string, key: string): Promise<ActionResult> {
  const ctx = await requirePermission(slug, "finance.manage");
  const minor = parseMoney(amount);
  if (!minor) return { ok: false, error: "invalid_amount" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("refund_payment", { p_business: ctx.id, p_payment: paymentId, p_amount: minor, p_reason: reason, p_idempotency_key: key });
  if (error) return fail(error);
  revalidatePath(`/app/${slug}/orders/${orderId}`);
  return { ok: true };
}
