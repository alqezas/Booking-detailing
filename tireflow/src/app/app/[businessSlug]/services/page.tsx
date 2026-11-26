import { getLocale, getTranslations } from "next-intl/server";
import { can, requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import { Empty, PageHeader, Section } from "@/components/app/ui";
import { ServiceDialog } from "./service-dialog";
import { RuleDialog, DeleteRuleButton } from "./rule-dialog";
import { PriceCheck } from "./price-check";

export default async function ServicesPage({ params }: PageProps<"/app/[businessSlug]/services">) {
  const { businessSlug } = await params;
  const ctx = await requirePermission(businessSlug, "calendar.view", "services");
  const supabase = await createClient();
  const [services, categories, vcats, prules, drules, t, tc, locale] = await Promise.all([
    supabase.from("services").select("*").eq("business_id", ctx.id).is("deleted_at", null).order("sort_order"),
    supabase.from("service_categories").select("id, name").eq("business_id", ctx.id).order("sort_order"),
    supabase.from("vehicle_categories").select("id, name, code").eq("business_id", ctx.id).eq("is_active", true).order("sort_order"),
    supabase.from("pricing_rules").select("*").eq("business_id", ctx.id).order("priority"),
    supabase.from("duration_rules").select("*").eq("business_id", ctx.id).order("priority"),
    getTranslations("services"), getTranslations("common"), getLocale(),
  ]);
  const edit = can(ctx, "services.manage");
  const money = (v: number) => formatMoney(v, ctx.settings.currency, locale);
  const svcName = (id: string | null) => (id ? services.data?.find((s) => s.id === id)?.name ?? "?" : t("anyService"));
  const catName = (id: string | null) => (id ? vcats.data?.find((c) => c.id === id)?.name ?? "?" : null);
  const grouped = (categories.data ?? []).map((c) => ({ ...c, items: (services.data ?? []).filter((s) => s.category_id === c.id) }))
    .concat([{ id: "none", name: "—", items: (services.data ?? []).filter((s) => !s.category_id) }])
    .filter((g) => g.items.length);

  type Rule = { id: string; name: string; service_id: string | null; vehicle_category_id: string | null; rim_min: number | null; rim_max: number | null; runflat: boolean | null; tpms: boolean | null; rim_type: string | null; adjustment: string; amount: number; priority: number };
  const describe = (r: Rule, kind: "price" | "duration") => {
    const when = [
      svcName(r.service_id), catName(r.vehicle_category_id),
      r.rim_min || r.rim_max ? `R${r.rim_min ?? "…"}–R${r.rim_max ?? "…"}` : null,
      r.runflat === true ? "RunFlat" : r.runflat === false ? "no RunFlat" : null,
      r.tpms === true ? "TPMS" : r.tpms === false ? "no TPMS" : null,
      r.rim_type,
    ].filter(Boolean).join(" · ");
    const then = r.adjustment === "percent" ? `${r.amount > 0 ? "+" : ""}${r.amount / 100} %`
      : kind === "price" ? `${r.adjustment === "add" && r.amount > 0 ? "+" : ""}${r.adjustment === "set" ? "= " : ""}${money(r.amount)}`
      : `${r.adjustment === "set" ? "= " : "+"}${r.amount} min`;
    return { when, then };
  };

  const shared = { slug: ctx.slug, services: (services.data ?? []).map((s) => ({ id: s.id, name: s.name })), categories: vcats.data ?? [], currency: ctx.settings.currency };

  return (
    <>
      <PageHeader title={t("title")} actions={edit && <ServiceDialog slug={ctx.slug} categories={categories.data ?? []} currency={ctx.settings.currency} />} />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {grouped.map((g) => (
            <Section key={g.id} title={g.name}>
              <ul className="divide-y text-sm">
                {g.items.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
                    <span className={`min-w-0 flex-1 font-medium ${s.is_active ? "" : "text-muted-foreground line-through"}`}>{s.name}</span>
                    <span className="tabular w-28 text-right">{money(s.base_price)} <span className="text-xs text-muted-foreground">{t(`units.${s.unit}` as "units.job")}</span></span>
                    <span className="tabular w-16 text-right text-muted-foreground">{tc("minutes", { n: s.base_duration_min })}</span>
                    <span className="w-16 text-xs text-muted-foreground">{s.online_bookable ? t("online") : ""}</span>
                    {edit && <ServiceDialog slug={ctx.slug} categories={categories.data ?? []} currency={ctx.settings.currency} service={s} />}
                  </li>
                ))}
              </ul>
            </Section>
          ))}
        </div>
        <div className="space-y-4">
          <PriceCheck businessId={ctx.id} services={shared.services} categories={shared.categories} currency={ctx.settings.currency} locale={locale} />
          {(["price", "duration"] as const).map((kind) => {
            const rules = (kind === "price" ? prules.data : drules.data) ?? [];
            return (
              <Section key={kind} title={kind === "price" ? t("rules") : t("durationRules")} actions={edit && <RuleDialog {...shared} kind={kind} />}>
                {rules.length === 0 ? <Empty>{tc("empty")}</Empty> : (
                  <ul className="divide-y text-sm">
                    {rules.map((r) => {
                      const d = describe(r as Rule, kind);
                      return (
                        <li key={r.id} className="flex items-start gap-2 px-4 py-2">
                          <div className="min-w-0 flex-1">
                            <div className="font-medium">{r.name}</div>
                            <div className="text-xs text-muted-foreground">{d.when}</div>
                          </div>
                          <span className="tabular whitespace-nowrap">{d.then}</span>
                          {edit && <DeleteRuleButton slug={ctx.slug} kind={kind} id={r.id} />}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Section>
            );
          })}
        </div>
      </div>
    </>
  );
}
