import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatMoney } from "@/lib/format";
import { PrintButton } from "@/components/app/print-button";

// Printable work order (browser "Save as PDF" produces the PDF). Not a fiscal document.
export default async function PrintOrderPage({ params }: PageProps<"/app/[businessSlug]/orders/[orderId]/print">) {
  const { businessSlug, orderId } = await params;
  const ctx = await requirePermission(businessSlug, "orders.view_all", "orders");
  const supabase = await createClient();
  const { data: o } = await supabase.from("work_orders")
    .select("*, customer:customers(first_name, last_name, phone, email), vehicle:vehicles(make, model, plate, vin), branch:branches(name, address_line, city, phone)")
    .eq("id", orderId).eq("business_id", ctx.id).maybeSingle();
  if (!o) notFound();
  const { data: items } = await supabase.from("work_order_items").select("name, quantity, unit_price, line_total, line_tax, approval, tax_rate_bp").eq("work_order_id", o.id).neq("approval", "declined").order("created_at");
  const [t, tc, tv, locale] = await Promise.all([getTranslations("orders"), getTranslations("common"), getTranslations("vehicles"), getLocale()]);
  const money = (v: number) => formatMoney(v, o.currency, locale);
  return (
    <article className="mx-auto max-w-3xl bg-white p-8 text-sm text-black">
      <div className="no-print mb-4 flex justify-end"><PrintButton label={tc("print")} /></div>
      <header className="flex items-start justify-between border-b pb-4">
        <div>
          <h1 className="text-xl font-semibold">{ctx.name}</h1>
          <p>{o.branch?.name} · {o.branch?.address_line} {o.branch?.city}</p>
          <p>{o.branch?.phone ?? ctx.settings.phone} {ctx.settings.email}</p>
          {ctx.settings.tax_id && <p>VAT: {ctx.settings.tax_id}</p>}
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold">{t("title")} {o.number}</div>
          <div>{formatDateTime(o.created_at, ctx.settings.timezone, locale)}</div>
          <div>{t(`status.${o.status}`)}</div>
        </div>
      </header>
      <section className="grid grid-cols-2 gap-4 border-b py-4">
        <div>
          <div className="text-xs uppercase text-neutral-500">{tc("name")}</div>
          <div>{o.customer ? `${o.customer.first_name} ${o.customer.last_name}` : "—"}</div>
          <div>{o.customer?.phone} {o.customer?.email}</div>
        </div>
        <div>
          <div className="text-xs uppercase text-neutral-500">{tv("title")}</div>
          <div>{o.vehicle ? `${o.vehicle.make} ${o.vehicle.model}` : "—"} <span className="font-mono">{o.vehicle?.plate}</span></div>
          {o.vehicle?.vin && <div className="font-mono text-xs">VIN {o.vehicle.vin}</div>}
          {o.mileage_km && <div>{t("mileage")}: {o.mileage_km} km</div>}
        </div>
      </section>
      <table className="my-4 w-full">
        <thead><tr className="border-b text-left text-xs uppercase text-neutral-500">
          <th className="py-1">{tc("name")}</th><th className="py-1 text-right">{tc("quantity")}</th><th className="py-1 text-right">{tc("price")}</th><th className="py-1 text-right">VAT</th><th className="py-1 text-right">{tc("total")}</th>
        </tr></thead>
        <tbody>
          {(items ?? []).map((i, n) => (
            <tr key={n} className="border-b">
              <td className="py-1">{i.name}{i.approval === "pending" ? " *" : ""}</td>
              <td className="py-1 text-right">{Number(i.quantity)}</td>
              <td className="py-1 text-right">{money(i.unit_price)}</td>
              <td className="py-1 text-right">{i.tax_rate_bp / 100} %</td>
              <td className="py-1 text-right">{money(i.line_total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={4} className="pt-2 text-right">{t("tax")}</td><td className="pt-2 text-right">{money(o.tax_total)}</td></tr>
          <tr className="font-semibold"><td colSpan={4} className="text-right">{tc("total")}</td><td className="text-right">{money(o.total)}</td></tr>
          <tr><td colSpan={4} className="text-right">{t("paid")}</td><td className="text-right">{money(o.paid_total)}</td></tr>
        </tfoot>
      </table>
      {o.damage_notes && <p className="border-t pt-3"><b>{t("damage")}:</b> {o.damage_notes}</p>}
      <footer className="mt-12 grid grid-cols-2 gap-8 text-xs text-neutral-500">
        <div className="border-t pt-1">{ctx.name}</div>
        <div className="border-t pt-1">{tc("name")}</div>
      </footer>
      <p className="mt-6 text-[10px] text-neutral-400">{t("notFiscal")}</p>
    </article>
  );
}
