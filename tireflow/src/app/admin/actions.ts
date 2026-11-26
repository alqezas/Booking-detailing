"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isPlatformAdmin, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, zodFail, type ActionResult } from "@/lib/action";

async function requireAdmin() {
  await requireUser();
  if (!(await isPlatformAdmin())) redirect("/");
}

const schema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/),
  name: z.string().trim().min(2).max(120),
  owner_email: z.email(),
  locale: z.enum(["cs", "pl", "uk", "sk", "de", "en", "ru"]),
  currency: z.enum(["CZK", "EUR", "PLN", "UAH"]),
  branch: z.string().trim().max(120).optional(),
});

/**
 * Onboards a new tenant without any code change or deploy:
 * invites (or finds) the owner in Supabase Auth, then creates the business in one RPC.
 * The admin (secret-key) client is used only for the Auth invite.
 */
export async function createBusiness(values: unknown): Promise<ActionResult<{ slug: string }>> {
  await requireAdmin();
  const parsed = schema.safeParse(values);
  if (!parsed.success) return zodFail(parsed.error.issues);
  const v = parsed.data;
  const admin = createAdminClient();
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? (await headers()).get("origin") ?? "";

  let ownerId: string | null = null;
  const invited = await admin.auth.admin.inviteUserByEmail(v.owner_email, {
    data: { locale: v.locale },
    redirectTo: `${origin}/auth/callback?next=/auth/update-password`,
  });
  if (invited.data.user) ownerId = invited.data.user.id;
  else {
    // already registered: look the user up by email
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    ownerId = data?.users.find((u) => u.email?.toLowerCase() === v.owner_email.toLowerCase())?.id ?? null;
    if (!ownerId) return { ok: false, error: "generic" };
  }

  const supabase = await createClient(); // the RPC re-checks platform admin with the caller's session
  const { error } = await supabase.rpc("admin_create_business", {
    p_slug: v.slug, p_name: v.name, p_owner: ownerId, p_locale: v.locale, p_currency: v.currency, p_branch_name: v.branch || undefined,
  });
  if (error) return fail(error);
  revalidatePath("/admin");
  return { ok: true, data: { slug: v.slug } };
}

export async function setBusinessActive(id: string, active: boolean): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_business_active", { p_business: id, p_active: active });
  if (error) return fail(error);
  revalidatePath("/admin");
  return { ok: true };
}

export async function setLicense(id: string, kind: string, validUntil: string | null, maxBranches: number, maxUsers: number): Promise<ActionResult> {
  await requireAdmin();
  if (!["trial", "subscription", "perpetual", "partner", "internal"].includes(kind)) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_license", {
    p_business: id, p_kind: kind, p_valid_until: validUntil ?? undefined, p_max_branches: maxBranches, p_max_users: maxUsers,
  } as never);
  if (error) return fail(error);
  revalidatePath("/admin");
  return { ok: true };
}

export async function setModule(id: string, module: string, enabled: boolean): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_module", { p_business: id, p_module: module as never, p_enabled: enabled });
  if (error) return fail(error);
  revalidatePath("/admin");
  return { ok: true };
}
