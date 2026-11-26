"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, nullish, zodFail, type ActionResult } from "@/lib/action";

const schema = z.object({
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().max(100).default(""),
  phone: z.preprocess(nullish, z.string().max(30).nullable()),
  email: z.preprocess(nullish, z.email().nullable()),
  position: z.preprocess(nullish, z.string().max(80).nullable()),
  branch_id: z.uuid(),
  skills: z.string().default("").transform((s) => s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)),
  commission_pct: z.coerce.number().min(0).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  workdays: z.string().regex(/^[1-7]*$/),
  starts: z.string().regex(/^\d{2}:\d{2}$/),
  ends: z.string().regex(/^\d{2}:\d{2}$/),
}).refine((v) => v.ends > v.starts, { path: ["ends"], message: "range" });

export async function saveEmployee(slug: string, values: unknown): Promise<ActionResult> {
  const ctx = await requirePermission(slug, "employees.manage", "employees");
  const parsed = schema.safeParse(values);
  if (!parsed.success) return zodFail(parsed.error.issues);
  const { commission_pct, workdays, starts, ends, ...e } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.from("employees").insert({ ...e, business_id: ctx.id, commission_bp: Math.round(commission_pct * 100) }).select("id").single();
  if (error) return fail(error);
  const days = [...new Set(workdays.split("").map(Number))];
  if (days.length) {
    const { error: e2 } = await supabase.from("employee_schedules").insert(days.map((d) => ({ business_id: ctx.id, employee_id: data.id, weekday: d, starts, ends })));
    if (e2) return fail(e2);
  }
  revalidatePath(`/app/${slug}/employees`);
  return { ok: true };
}
