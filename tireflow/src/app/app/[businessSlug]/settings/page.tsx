import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { can, requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { minorToInput } from "@/lib/format";
import { PageHeader } from "@/components/app/ui";
import { SettingsTabs } from "./tabs";

export default async function SettingsPage({ params }: PageProps<"/app/[businessSlug]/settings">) {
  const { businessSlug } = await params;
  const ctx = await requirePermission(businessSlug, "business.manage");
  const supabase = await createClient();
  const [modules, branches, posts, members, employees, t] = await Promise.all([
    supabase.from("business_modules").select("module, enabled").eq("business_id", ctx.id),
    supabase.from("branches").select("*").eq("business_id", ctx.id).is("deleted_at", null).order("sort_order"),
    supabase.from("workstations").select("id, name, kind, equipment, is_active, branch_id").eq("business_id", ctx.id).is("deleted_at", null).order("sort_order"),
    supabase.from("memberships").select("id, role, is_active, user_id").eq("business_id", ctx.id),
    supabase.from("employees").select("id, first_name, last_name, membership_id").eq("business_id", ctx.id).is("deleted_at", null),
    getTranslations("settings"),
  ]);
  const s = ctx.settings;
  const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", (members.data ?? []).map((m) => m.user_id));
  const nameOf = (uid: string) => profiles?.find((p) => p.id === uid)?.full_name || uid.slice(0, 8);
  const h = await headers();
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  return (
    <>
      <PageHeader title={t("title")} description={<a className="font-mono text-xs hover:underline" href={`/s/${ctx.slug}`} target="_blank" rel="noreferrer">{origin}/s/{ctx.slug}</a>} />
      <SettingsTabs
        slug={ctx.slug}
        businessId={ctx.id}
        supabaseUrl={process.env.NEXT_PUBLIC_SUPABASE_URL!}
        canMembers={can(ctx, "members.manage")}
        general={{
          name: ctx.name, email: s.email ?? "", phone: s.phone ?? "", website: s.website ?? "", tax_id: s.tax_id ?? "",
          currency: s.currency, crm_locale: s.crm_locale, public_locale: s.public_locale, timezone: s.timezone,
          tax_pct: String(s.default_tax_rate_bp / 100), prices_include_tax: s.prices_include_tax, storage_price: minorToInput(s.storage_price_per_season),
          brand_color: s.brand_color, accent_color: s.accent_color, slot_step_minutes: String(s.slot_step_minutes),
          booking_lead_minutes: String(s.booking_lead_minutes), booking_horizon_days: String(s.booking_horizon_days),
          booking_cancel_until_minutes: String(s.booking_cancel_until_minutes), booking_requires_confirmation: s.booking_requires_confirmation,
          seasonal_mode: s.seasonal_mode, order_number_prefix: s.order_number_prefix,
        }}
        logoPath={s.logo_path}
        modules={(modules.data ?? []).map((m) => ({ module: m.module, enabled: m.enabled }))}
        branches={(branches.data ?? []).map((b) => ({ id: b.id, name: b.name, address_line: b.address_line ?? "", city: b.city ?? "", postal_code: b.postal_code ?? "", country: b.country, phone: b.phone ?? "", opening_hours: b.opening_hours as Record<string, [string, string][]> }))}
        posts={(posts.data ?? []).map((p) => ({ ...p, equipment: p.equipment.join(", ") }))}
        members={(members.data ?? []).map((m) => ({ id: m.id, role: m.role, active: m.is_active, name: nameOf(m.user_id) }))}
        employees={(employees.data ?? []).filter((e) => !e.membership_id).map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}` }))}
      />
    </>
  );
}
