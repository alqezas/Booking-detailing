"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, nullish, zodFail, type ActionResult } from "@/lib/action";
import { parseMoney } from "@/lib/format";

const CATS = ["new_tires", "used_tires", "rims", "valves", "tpms_sensors", "balance_weights", "repair_materials", "bolts", "nuts", "consumables", "other"] as const;

const productSchema = z.object({
  sku: z.string().trim().min(1).max(60),
  barcode: z.preprocess(nullish, z.string().max(60).nullable()),
  name: z.string().trim().min(1).max(200),
  category: z.enum(CATS),
  manufacturer: z.preprocess(nullish, z.string().max(80).nullable()),
  purchase_price: z.string(),
  retail_price: z.string(),
  min_stock: z.coerce.number().min(0),
  location_note: z.preprocess(nullish, z.string().max(80).nullable()),
});

export async function saveProduct(slug: string, id: string | null, values: unknown): Promise<ActionResult> {
  const ctx = await requirePermission(slug, "inventory.manage", "inventory");
  const parsed = productSchema.safeParse(values);
  if (!parsed.success) return zodFail(parsed.error.issues);
  const purchase = parseMoney(parsed.data.purchase_price), retail = parseMoney(parsed.data.retail_price);
  if (purchase === null || retail === null) return { ok: false, error: "invalid_amount" };
  const row = { ...parsed.data, purchase_price: purchase, retail_price: retail };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("products").update(row).eq("id", id).eq("business_id", ctx.id)
    : await supabase.from("products").insert({ ...row, business_id: ctx.id });
  if (error) return fail(error);
  revalidatePath(`/app/${slug}/inventory`);
  return { ok: true };
}

export async function moveStock(slug: string, values: { product_id: string; warehouse_id: string; kind: string; quantity: string; unit_cost?: string; note?: string; to_warehouse_id?: string }): Promise<ActionResult> {
  const ctx = await requirePermission(slug, "inventory.manage", "inventory");
  const qty = Number(values.quantity.replace(",", "."));
  if (!Number.isFinite(qty) || qty === 0) return { ok: false, error: "validation" };
  const supabase = await createClient();
  if (values.kind === "transfer") {
    if (!values.to_warehouse_id) return { ok: false, error: "validation" };
    const { error } = await supabase.rpc("transfer_stock", { p_business: ctx.id, p_product: values.product_id, p_from: values.warehouse_id, p_to: values.to_warehouse_id, p_quantity: qty, p_note: values.note });
    if (error) return fail(error);
  } else {
    const cost = values.unit_cost ? parseMoney(values.unit_cost) : null;
    const { error } = await supabase.rpc("record_inventory_movement", {
      p_business: ctx.id, p_product: values.product_id, p_warehouse: values.warehouse_id, p_kind: values.kind, p_quantity: qty,
      p_unit_cost: cost ?? undefined, p_note: values.note,
    });
    if (error) return fail(error);
  }
  revalidatePath(`/app/${slug}/inventory`);
  return { ok: true };
}
