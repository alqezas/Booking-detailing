import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

export type Role = Database["public"]["Enums"]["app_role"];
export type ModuleKey = Database["public"]["Enums"]["module_key"];
export type Settings = Database["public"]["Tables"]["business_settings"]["Row"];

export type BusinessContext = {
  id: string;
  slug: string;
  name: string;
  role: Role;
  permissions: string[];
  modules: ModuleKey[];
  settings: Settings;
  branches: { id: string; name: string }[];
};

/** Verified user (JWT checked by Supabase), or null. */
export const getUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (!sub) return null;
  return { id: sub, email: (data.claims.email as string | undefined) ?? "" };
});

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export const getMemberships = cache(async () => {
  const user = await getUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("memberships")
    .select("role, business:businesses!inner(id, slug, name, is_active)")
    .eq("user_id", user.id)
    .eq("is_active", true);
  return (data ?? [])
    .filter((m) => m.business.is_active)
    .map((m) => ({ role: m.role, ...m.business }));
});

export const isPlatformAdmin = cache(async () => {
  const user = await getUser();
  if (!user) return false;
  const supabase = await createClient();
  const { data } = await supabase.rpc("is_platform_admin");
  return data === true;
});

/**
 * Resolves the tenant from the URL slug and checks membership on the server.
 * The business_id used by every later query comes from here — never from the client.
 */
export const requireBusiness = cache(async (slug: string): Promise<BusinessContext> => {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: business } = await supabase
    .from("businesses")
    .select("id, slug, name")
    .eq("slug", slug)
    .maybeSingle();
  if (!business) notFound();

  const [membership, perms, modules, settings, branches] = await Promise.all([
    supabase.from("memberships").select("role").eq("business_id", business.id).eq("user_id", user.id).eq("is_active", true).maybeSingle(),
    supabase.rpc("my_permissions", { p_business: business.id }),
    supabase.from("business_modules").select("module, enabled").eq("business_id", business.id),
    supabase.from("business_settings").select("*").eq("business_id", business.id).single(),
    supabase.from("branches").select("id, name").eq("business_id", business.id).is("deleted_at", null).eq("is_active", true).order("sort_order"),
  ]);
  if (!membership.data) notFound();

  return {
    ...business,
    role: membership.data.role,
    permissions: perms.data ?? [],
    modules: (modules.data ?? []).filter((m) => m.enabled).map((m) => m.module),
    settings: settings.data!,
    branches: branches.data ?? [],
  };
});

export function can(ctx: Pick<BusinessContext, "permissions">, perm: string) {
  return ctx.permissions.includes(perm);
}

/** Use at the top of pages and server actions. */
export async function requirePermission(slug: string, perm: string, module?: ModuleKey) {
  const ctx = await requireBusiness(slug);
  if (module && !ctx.modules.includes(module)) notFound();
  if (!can(ctx, perm)) redirect(`/app/${slug}/dashboard?denied=${encodeURIComponent(perm)}`);
  return ctx;
}
