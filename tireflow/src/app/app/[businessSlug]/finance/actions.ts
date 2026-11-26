"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, nullish, zodFail, type ActionResult } from "@/lib/action";
import { parseMoney } from "@/lib/format";

const schema = z.object({
  category: z.enum(["rent", "salaries", "utilities", "purchases", "equipment", "marketing", "taxes", "other"]),
  amount: z.string(),
  spent_on: z.iso.date(),
  branch_id: z.preprocess(nullish, z.uuid().nullable()),
  note: z.preprocess(nullish, z.string().max(500).nullable()),
});

export async function addExpense(slug: string, values: unknown): Promise<ActionResult> {
  const ctx = await requirePermission(slug, "finance.manage", "finance");
  const parsed = schema.safeParse(values);
  if (!parsed.success) return zodFail(parsed.error.issues);
  const amount = parseMoney(parsed.data.amount);
  if (!amount) return { ok: false, error: "invalid_amount" };
  const supabase = await createClient();
  const { error } = await supabase.from("expenses").insert({ ...parsed.data, amount, currency: ctx.settings.currency, business_id: ctx.id });
  if (error) return fail(error);
  revalidatePath(`/app/${slug}/finance`);
  return { ok: true };
}
