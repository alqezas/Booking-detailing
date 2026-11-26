import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { can, requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/ui";
import { Pager, SearchBar } from "@/components/app/list-controls";
import { OrdersTable, type OrderRow } from "./orders-table";

const PAGE = 50;
const STATUSES = ["draft", "scheduled", "in_progress", "awaiting_approval", "ready", "completed", "cancelled"] as const;

export default async function OrdersPage({ params, searchParams }: PageProps<"/app/[businessSlug]/orders">) {
  const { businessSlug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(businessSlug, "orders.view_all", "orders");
  const [t, locale] = await Promise.all([getTranslations("orders"), getLocale()]);
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const status = typeof sp.status === "string" && (STATUSES as readonly string[]).includes(sp.status) ? sp.status : null;
  const payment = typeof sp.payment === "string" ? sp.payment : null;
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();

  let query = supabase.from("work_orders")
    .select("id, number, status, payment_status, total, paid_total, created_at, customer:customers(first_name, last_name), vehicle:vehicles(plate), employee:employees(first_name, last_name)", { count: "exact" })
    .eq("business_id", ctx.id);
  if (status) query = query.eq("status", status as (typeof STATUSES)[number]);
  if (payment === "unpaid") query = query.eq("status", "completed").in("payment_status", ["unpaid", "partial"]);
  if (q) {
    if (/\d/.test(q) && q.includes("-")) {
      query = query.ilike("number", `%${q.replace(/[%,]/g, "")}%`);
    } else {
      const plate = q.toUpperCase().replace(/[^A-Z0-9]/g, "");
      const { data: vs } = await supabase.from("vehicles").select("id").eq("business_id", ctx.id).ilike("plate_normalized", `%${plate}%`).limit(200);
      query = query.in("vehicle_id", (vs ?? []).map((v) => v.id));
    }
  }
  const { data, count } = await query.order("created_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  const rows: OrderRow[] = (data ?? []).map((o) => ({
    id: o.id, number: o.number, status: o.status, payment: o.payment_status, total: o.total, paid: o.paid_total, created: o.created_at,
    customer: o.customer ? `${o.customer.first_name} ${o.customer.last_name}`.trim() : "—", plate: o.vehicle?.plate ?? null,
    employee: o.employee ? `${o.employee.first_name} ${o.employee.last_name}`.trim() : null,
  }));
  const base = `/app/${ctx.slug}/orders`;
  return (
    <>
      <PageHeader title={t("title")} actions={can(ctx, "orders.manage") && <Button size="sm" render={<Link href={`${base}/new`} />}><Plus />{t("new")}</Button>} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchBar defaultValue={q} placeholder={`${t("number")} / SPZ`} />
        <nav className="flex flex-wrap gap-1 text-sm">
          <Link href={base} className={`rounded-md px-2.5 py-1 ${!status && !payment ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60"}`}>∗</Link>
          {STATUSES.map((s) => (
            <Link key={s} href={`${base}?status=${s}`} className={`rounded-md px-2.5 py-1 ${status === s ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60"}`}>{t(`status.${s}`)}</Link>
          ))}
          <Link href={`${base}?payment=unpaid`} className={`rounded-md px-2.5 py-1 ${payment ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60"}`}>{t("payment.unpaid")}</Link>
        </nav>
      </div>
      <OrdersTable rows={rows} base={base} currency={ctx.settings.currency} timezone={ctx.settings.timezone} locale={locale} showMoney={can(ctx, "finance.view") || can(ctx, "finance.manage") || can(ctx, "orders.manage")} />
      <Pager page={page} total={count ?? 0} pageSize={PAGE} />
    </>
  );
}
