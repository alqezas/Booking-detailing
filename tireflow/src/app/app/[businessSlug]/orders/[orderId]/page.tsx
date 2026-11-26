import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Printer } from "lucide-react";
import { can, requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { DL, PageHeader, Section, StatusBadge } from "@/components/app/ui";
import { OrderWorkspace } from "./workspace";

export default async function OrderPage({ params }: PageProps<"/app/[businessSlug]/orders/[orderId]">) {
  const { businessSlug, orderId } = await params;
  const ctx = await requirePermission(businessSlug, "orders.view_all", "orders");
  const supabase = await createClient();
  const { data: o } = await supabase.from("work_orders")
    .select("*, customer:customers(id, first_name, last_name, phone), vehicle:vehicles(id, make, model, plate, rim_diameter), employee:employees(id, first_name, last_name), workstation:workstations(name), branch:branches(name)")
    .eq("id", orderId).eq("business_id", ctx.id).maybeSingle();
  if (!o) notFound();
  const fin = can(ctx, "finance.view") || can(ctx, "finance.manage");
  const [items, history, payments, services, products, warehouses, methods, employees] = await Promise.all([
    supabase.from("work_order_items").select("*").eq("work_order_id", o.id).order("created_at"),
    supabase.from("work_order_status_history").select("to_status, changed_at, note").eq("work_order_id", o.id).order("changed_at"),
    fin ? supabase.from("payments").select("id, kind, amount, received_at, refund_of, note, method:payment_methods(name)").eq("work_order_id", o.id).order("received_at") : Promise.resolve({ data: [] as never[] }),
    supabase.from("services").select("id, name").eq("business_id", ctx.id).eq("is_active", true).is("deleted_at", null).order("sort_order"),
    ctx.modules.includes("inventory") ? supabase.from("products").select("id, name, sku").eq("business_id", ctx.id).eq("is_active", true).is("deleted_at", null).order("name").limit(500) : Promise.resolve({ data: [] as never[] }),
    supabase.from("warehouses").select("id, name").eq("business_id", ctx.id).eq("purpose", "stock"),
    supabase.from("payment_methods").select("id, name").eq("business_id", ctx.id).eq("is_active", true),
    supabase.from("employees").select("id, first_name, last_name").eq("business_id", ctx.id).eq("is_active", true).is("deleted_at", null),
  ]);
  const [t, tc, tv, locale] = await Promise.all([getTranslations("orders"), getTranslations("common"), getTranslations("vehicles"), getLocale()]);
  const tz = ctx.settings.timezone;
  const money = (v: number) => formatMoney(v, o.currency, locale);
  const customer = o.customer ? `${o.customer.first_name} ${o.customer.last_name}`.trim() : "—";

  return (
    <>
      <PageHeader
        title={`${o.number}`}
        description={<span className="inline-flex flex-wrap items-center gap-2">
          <StatusBadge status={o.status} label={t(`status.${o.status}`)} />
          {fin && <StatusBadge status={o.payment_status} label={t(`payment.${o.payment_status}`)} />}
          <span>{formatDateTime(o.created_at, tz, locale)} · {o.branch?.name}</span>
        </span>}
        actions={<Button size="sm" variant="outline" render={<Link href={`/app/${ctx.slug}/orders/${o.id}/print`} target="_blank" />}><Printer />{t("printOrder")}</Button>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Section title={tc("details")}>
            <DL items={[
              [tc("name"), o.customer ? <Link className="font-medium hover:underline" href={`/app/${ctx.slug}/customers/${o.customer.id}`}>{customer}</Link> : "—"],
              [tc("phone"), o.customer?.phone],
              [tv("plate"), o.vehicle?.plate && <span className="font-mono">{o.vehicle.plate}</span>],
              [tv("make"), o.vehicle ? `${o.vehicle.make} ${o.vehicle.model}` : null],
              [tv("rim"), o.vehicle?.rim_diameter ? `R${o.vehicle.rim_diameter}` : null],
              [t("assigned"), o.employee ? `${o.employee.first_name} ${o.employee.last_name}` : "—"],
              ["Post", o.workstation?.name],
              [t("mileage"), o.mileage_km ? `${o.mileage_km.toLocaleString()} km` : null],
            ]} />
          </Section>
          <Section title={tc("status")}>
            <ol className="space-y-1 px-4 py-3 text-sm">
              {(history.data ?? []).map((h, i) => (
                <li key={i} className="flex items-center justify-between gap-2">
                  <span>{t(`status.${h.to_status}`)}</span>
                  <span className="tabular text-xs text-muted-foreground">{formatDateTime(h.changed_at, tz, locale)}</span>
                </li>
              ))}
            </ol>
          </Section>
        </div>
        <div className="lg:col-span-2">
          <OrderWorkspace
            slug={ctx.slug}
            order={{
              id: o.id, status: o.status, subtotal: o.subtotal, discount: o.discount_total, tax: o.tax_total, total: o.total,
              paid: o.paid_total, damage: o.damage_notes ?? "", note: o.internal_note ?? "", mileage: o.mileage_km ? String(o.mileage_km) : "",
              employeeId: o.employee?.id ?? "", includesTax: o.prices_include_tax,
            }}
            items={(items.data ?? []).map((i) => ({ id: i.id, kind: i.kind, name: i.name, quantity: Number(i.quantity), unitPrice: i.unit_price, discountBp: i.discount_bp, taxBp: i.tax_rate_bp, total: i.line_total, approval: i.approval, additional: i.is_additional }))}
            payments={(payments.data ?? []).map((p) => ({ id: p.id, kind: p.kind, amount: p.amount, at: p.received_at, method: p.method?.name ?? "", refundOf: p.refund_of, note: p.note }))}
            services={services.data ?? []}
            products={products.data ?? []}
            warehouses={warehouses.data ?? []}
            methods={methods.data ?? []}
            employees={(employees.data ?? []).map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}` }))}
            currency={o.currency}
            timezone={tz}
            locale={locale}
            can={{ manage: can(ctx, "orders.manage"), work: can(ctx, "orders.work"), pay: can(ctx, "finance.manage"), fin, custom: can(ctx, "services.manage") }}
            totalLabel={money(o.total)}
          />
        </div>
      </div>
    </>
  );
}
