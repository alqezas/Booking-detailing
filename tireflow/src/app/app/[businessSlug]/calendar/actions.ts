"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission, requireBusiness, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, zodFail, type ActionResult } from "@/lib/action";

const bookingSchema = z.object({
  branch_id: z.uuid(),
  customer_id: z.uuid().nullable().optional(),
  vehicle_id: z.uuid().nullable().optional(),
  workstation_id: z.uuid().nullable().optional(),
  employee_id: z.uuid().nullable().optional(),
  starts_at: z.iso.datetime({ offset: true }),
  duration_min: z.number().int().min(5).max(720).nullable().optional(),
  service_ids: z.array(z.uuid()).min(1),
  vehicle_params: z.record(z.string(), z.unknown()).default({}),
  source: z.enum(["staff", "walk_in", "phone"]).default("staff"),
  internal_note: z.string().max(2000).optional(),
  plate: z.string().max(16).optional(),
  contact_name: z.string().max(200).optional(),
  contact_phone: z.string().max(30).optional(),
  idempotency_key: z.string().min(8).max(128),
});

export async function createBooking(slug: string, values: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await requirePermission(slug, "calendar.manage", "calendar");
  const parsed = bookingSchema.safeParse(values);
  if (!parsed.success) return zodFail(parsed.error.issues);
  const { idempotency_key, ...p } = parsed.data;
  const supabase = await createClient();
  // business_id comes from the server-side context, prices from the database quote
  const { data, error } = await supabase.rpc("create_booking", { p_business: ctx.id, p: p as never, p_idempotency_key: idempotency_key });
  if (error) return fail(error);
  revalidatePath(`/app/${slug}/calendar`);
  return { ok: true, data: { id: data } };
}

export async function rescheduleBooking(slug: string, id: string, startsAt: string, workstationId?: string | null, durationMin?: number | null, employeeId?: string | null): Promise<ActionResult> {
  const ctx = await requirePermission(slug, "calendar.manage", "calendar");
  const supabase = await createClient();
  const { error } = await supabase.rpc("reschedule_booking", {
    p_business: ctx.id, p_booking: id, p_starts_at: startsAt,
    p_workstation: workstationId ?? undefined, p_duration_min: durationMin ?? undefined, p_employee: employeeId ?? undefined,
  });
  if (error) return fail(error);
  revalidatePath(`/app/${slug}/calendar`);
  return { ok: true };
}

export async function setBookingStatus(slug: string, id: string, status: "pending" | "confirmed" | "arrived" | "in_progress" | "completed" | "cancelled" | "no_show", reason?: string): Promise<ActionResult> {
  const ctx = await requireBusiness(slug);
  if (!can(ctx, "calendar.manage") && !can(ctx, "orders.work")) return { ok: false, error: "forbidden" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_booking_status", { p_business: ctx.id, p_booking: id, p_status: status, p_reason: reason });
  if (error) return fail(error);
  revalidatePath(`/app/${slug}/calendar`);
  return { ok: true };
}

export async function updateBookingNote(slug: string, id: string, note: string): Promise<ActionResult> {
  const ctx = await requirePermission(slug, "calendar.manage", "calendar");
  const supabase = await createClient();
  const { error } = await supabase.from("bookings").update({ internal_note: note.slice(0, 2000) }).eq("id", id).eq("business_id", ctx.id);
  if (error) return fail(error);
  return { ok: true };
}

export async function blockTime(slug: string, branchId: string, workstationId: string, from: string, to: string, reason: string): Promise<ActionResult> {
  const ctx = await requirePermission(slug, "calendar.manage", "calendar");
  const supabase = await createClient();
  const { error } = await supabase.rpc("block_time", {
    p_business: ctx.id, p_branch: branchId, p_kind: "workstation", p_resource: workstationId, p_from: from, p_to: to, p_reason: reason,
  });
  if (error) return fail(error);
  revalidatePath(`/app/${slug}/calendar`);
  return { ok: true };
}

export async function createOrderFromBooking(slug: string, bookingId: string): Promise<ActionResult<{ id: string }>> {
  const ctx = await requirePermission(slug, "orders.manage", "orders");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_work_order", { p_business: ctx.id, p: { booking_id: bookingId } as never, p_idempotency_key: `wo-from-${bookingId}` });
  if (error) return fail(error);
  return { ok: true, data: { id: data } };
}

/** Customer's vehicles for the booking dialog (RLS-scoped). */
export async function customerVehicles(slug: string, customerId: string) {
  const ctx = await requirePermission(slug, "customers.view");
  const supabase = await createClient();
  const { data } = await supabase.from("vehicles")
    .select("id, make, model, plate, category_id, rim_diameter, has_tpms, has_runflat")
    .eq("business_id", ctx.id).eq("customer_id", customerId).is("deleted_at", null);
  return data ?? [];
}
