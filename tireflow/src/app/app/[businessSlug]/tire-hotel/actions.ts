"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, nullish, zodFail, type ActionResult } from "@/lib/action";
import { parseMoney } from "@/lib/format";

const num = (min: number, max: number) => z.preprocess(nullish, z.coerce.number().min(min).max(max).nullable());

const checkInSchema = z.object({
  customer_id: z.uuid(),
  vehicle_id: z.preprocess(nullish, z.uuid().nullable()),
  warehouse_id: z.uuid(),
  location_id: z.preprocess(nullish, z.uuid().nullable()),
  quantity: z.coerce.number().int().min(1).max(10),
  manufacturer: z.preprocess(nullish, z.string().max(60).nullable()),
  model: z.preprocess(nullish, z.string().max(60).nullable()),
  season: z.enum(["summer", "winter", "all_season"]),
  width: num(125, 395), profile: num(20, 90), diameter: num(10, 26),
  load_index: z.preprocess(nullish, z.string().max(6).nullable()),
  speed_index: z.preprocess(nullish, z.string().max(3).nullable()),
  with_rims: z.boolean(),
  rim_type: z.preprocess(nullish, z.enum(["steel", "alloy"]).nullable()),
  condition: z.enum(["new", "good", "fair", "worn", "unsafe"]),
  notes: z.preprocess(nullish, z.string().max(2000).nullable()),
  items: z.array(z.object({
    position: z.enum(["FL", "FR", "RL", "RR"]),
    dot: z.preprocess(nullish, z.string().regex(/^\d{4}$/).nullable()),
    tread_mm: num(0, 20),
    damage: z.preprocess(nullish, z.string().max(200).nullable()),
  })),
  ends_on: z.iso.date(),
  price: z.string(),
  pay_now: z.boolean(),
  method_id: z.preprocess(nullish, z.uuid().nullable()),
  idempotency_key: z.string().min(8),
});

export async function checkIn(slug: string, values: unknown): Promise<ActionResult<{ id: string; code: string; location: string }>> {
  const ctx = await requirePermission(slug, "tire_hotel.manage", "tire_hotel");
  const parsed = checkInSchema.safeParse(values);
  if (!parsed.success) return zodFail(parsed.error.issues);
  const { idempotency_key, price, pay_now, method_id, ...p } = parsed.data;
  const priceMinor = parseMoney(price);
  if (priceMinor === null) return { ok: false, error: "invalid_amount" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("check_in_tire_set", {
    p_business: ctx.id,
    p: { ...p, price: priceMinor, payment: pay_now && method_id && priceMinor > 0 ? { amount: priceMinor, method_id } : null } as never,
    p_idempotency_key: idempotency_key,
  });
  if (error) return fail(error);
  const r = data as { tire_set_id: string; code: string; location_code: string };
  revalidatePath(`/app/${slug}/tire-hotel`);
  return { ok: true, data: { id: r.tire_set_id, code: r.code, location: r.location_code } };
}

export async function releaseSet(slug: string, id: string, allowUnpaid: boolean): Promise<ActionResult> {
  const ctx = await requirePermission(slug, "tire_hotel.manage", "tire_hotel");
  const supabase = await createClient();
  const { error } = await supabase.rpc("release_tire_set", { p_business: ctx.id, p_set: id, p_allow_unpaid: allowUnpaid });
  if (error) return fail(error);
  revalidatePath(`/app/${slug}/tire-hotel`);
  return { ok: true };
}

export async function moveSet(slug: string, id: string, locationId: string): Promise<ActionResult> {
  const ctx = await requirePermission(slug, "tire_hotel.manage", "tire_hotel");
  const supabase = await createClient();
  const { error } = await supabase.rpc("move_tire_set", { p_business: ctx.id, p_set: id, p_location: locationId });
  if (error) return fail(error);
  revalidatePath(`/app/${slug}/tire-hotel/${id}`);
  return { ok: true };
}

export async function extendStorage(slug: string, id: string, endsOn: string, price: string): Promise<ActionResult> {
  const ctx = await requirePermission(slug, "tire_hotel.manage", "tire_hotel");
  const minor = parseMoney(price);
  if (minor === null || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("extend_storage", { p_business: ctx.id, p_set: id, p_ends_on: endsOn, p_price: minor });
  if (error) return fail(error);
  revalidatePath(`/app/${slug}/tire-hotel/${id}`);
  return { ok: true };
}

export async function payStorage(slug: string, setId: string, contractId: string, amount: string, methodId: string): Promise<ActionResult> {
  const ctx = await requirePermission(slug, "finance.manage");
  const minor = parseMoney(amount);
  if (!minor) return { ok: false, error: "invalid_amount" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_storage_payment", { p_business: ctx.id, p_contract: contractId, p_amount: minor, p_method: methodId });
  if (error) return fail(error);
  revalidatePath(`/app/${slug}/tire-hotel/${setId}`);
  return { ok: true };
}

export async function createGrid(slug: string, warehouseId: string, zone: string, racks: number, shelves: number, cells: number, capacity: number): Promise<ActionResult<{ created: number }>> {
  const ctx = await requirePermission(slug, "tire_hotel.manage", "tire_hotel");
  if (!/^[A-Z0-9]{1,4}$/i.test(zone)) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_storage_grid", {
    p_business: ctx.id, p_warehouse: warehouseId, p_zone: zone, p_racks: racks, p_shelves: shelves, p_cells: cells, p_capacity: capacity,
  });
  if (error) return fail(error);
  revalidatePath(`/app/${slug}/tire-hotel`);
  return { ok: true, data: { created: data } };
}
