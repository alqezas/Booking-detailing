import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { CalendarPlus, CircleDot, ClipboardPlus, UserPlus } from "lucide-react";
import { can, requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney, formatTime, type Currency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Empty, PageHeader, Section, Stat, StatusBadge } from "@/components/app/ui";
import { BarsChart, RevenueChart } from "./charts";

type Stats = {
  currency: Currency; timezone: string;
  bookings_today: number; in_progress: number; completed_today: number;
  revenue_today: number | null; revenue_week: number | null; revenue_month: number | null; avg_ticket_month: number | null;
  new_customers_month: number; returning_customers_month: number; tire_sets_stored: number; overdue_payments: number | null;
  post_load_today: number; seasonal_candidates: number;
  upcoming: { id: string; starts_at: string; status: string; workstation: string; customer: string | null; plate: string | null }[];
  active_orders: { id: string; number: string; status: string; total: number | null; customer: string; plate: string | null }[];
  revenue_30d: { day: string; amount: number }[] | null;
  load_next_14d: { day: string; bookings: number }[];
  popular_services: { name: string; n: number; revenue: number | null }[];
  low_stock: { id: string; name: string; sku: string; on_hand: number; min_stock: number }[];
  storage_ending: { id: string; ends_on: string; code: string; customer: string }[];
};

export default async function DashboardPage({ params }: PageProps<"/app/[businessSlug]/dashboard">) {
  const { businessSlug } = await params;
  const ctx = await requirePermission(businessSlug, "calendar.view");
  const supabase = await createClient();
  const [{ data }, t, tc, tcal, to, locale] = await Promise.all([
    supabase.rpc("dashboard_stats", { p_business: ctx.id }),
    getTranslations("dashboard"), getTranslations("common"), getTranslations("calendar"), getTranslations("orders"), getLocale(),
  ]);
  const s = data as unknown as Stats;
  const money = (v: number | null) => formatMoney(v, s.currency, locale);
  const base = `/app/${ctx.slug}`;
  const fin = s.revenue_month !== null;

  return (
    <>
      <PageHeader
        title={t("title")}
        actions={
          <>
            {can(ctx, "calendar.manage") && <Button size="sm" render={<Link href={`${base}/calendar?new=1`} />}><CalendarPlus />{t("newBooking")}</Button>}
            {can(ctx, "customers.manage") && <Button size="sm" variant="outline" render={<Link href={`${base}/customers/new`} />}><UserPlus />{t("newCustomer")}</Button>}
            {can(ctx, "orders.manage") && <Button size="sm" variant="outline" render={<Link href={`${base}/orders/new`} />}><ClipboardPlus />{t("newOrder")}</Button>}
            {can(ctx, "tire_hotel.manage") && ctx.modules.includes("tire_hotel") && <Button size="sm" variant="outline" render={<Link href={`${base}/tire-hotel/check-in`} />}><CircleDot />{t("checkIn")}</Button>}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label={t("bookingsToday")} value={s.bookings_today} href={`${base}/calendar`} />
        <Stat label={t("inProgress")} value={s.in_progress} href={`${base}/orders?status=in_progress`} />
        <Stat label={t("completedToday")} value={s.completed_today} />
        <Stat label={t("postLoad")} value={`${s.post_load_today}%`} />
        {fin && <Stat label={t("revenueToday")} value={money(s.revenue_today)} />}
        {fin && <Stat label={t("revenueWeek")} value={money(s.revenue_week)} />}
        {fin && <Stat label={t("revenueMonth")} value={money(s.revenue_month)} />}
        {fin && <Stat label={t("avgTicket")} value={money(s.avg_ticket_month)} />}
        <Stat label={t("newCustomers")} value={s.new_customers_month} />
        <Stat label={t("returning")} value={s.returning_customers_month} />
        {ctx.modules.includes("tire_hotel") && <Stat label={t("storedSets")} value={s.tire_sets_stored} href={`${base}/tire-hotel`} />}
        {fin && <Stat label={t("overdue")} value={s.overdue_payments} tone={s.overdue_payments ? "warn" : undefined} href={`${base}/orders?payment=unpaid`} />}
      </div>

      {s.seasonal_candidates > 0 && can(ctx, "customers.view") && (
        <Link href={`${base}/customers?segment=seasonal`} className="mt-3 block rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm">
          {t("seasonal", { count: s.seasonal_candidates })} →
        </Link>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Section title={t("upcoming")} className="xl:col-span-1">
          {s.upcoming.length === 0 ? <Empty>{tc("empty")}</Empty> : (
            <ul className="divide-y">
              {s.upcoming.map((b) => (
                <li key={b.id}>
                  <Link href={`${base}/calendar?booking=${b.id}`} className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-muted/50">
                    <span className="tabular w-24 shrink-0 text-muted-foreground">
                      {formatDate(b.starts_at, s.timezone, locale).replace(/,? \d{4}/, "")} {formatTime(b.starts_at, s.timezone, locale)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{b.customer ?? "—"} <span className="text-muted-foreground">{b.plate}</span></span>
                    <span className="hidden text-xs text-muted-foreground sm:inline">{b.workstation}</span>
                    <StatusBadge status={b.status} label={tcal(`status.${b.status}` as "status.confirmed")} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title={t("activeOrders")}>
          {s.active_orders.length === 0 ? <Empty>{tc("empty")}</Empty> : (
            <ul className="divide-y">
              {s.active_orders.map((o) => (
                <li key={o.id}>
                  <Link href={`${base}/orders/${o.id}`} className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-muted/50">
                    <span className="tabular w-24 shrink-0 font-medium">{o.number}</span>
                    <span className="min-w-0 flex-1 truncate">{o.customer} <span className="text-muted-foreground">{o.plate}</span></span>
                    {o.total !== null && <span className="tabular text-muted-foreground">{money(o.total)}</span>}
                    <StatusBadge status={o.status} label={to(`status.${o.status}` as "status.draft")} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title={t("load14")}>
          <div className="p-3"><BarsChart data={s.load_next_14d.map((d) => ({ label: d.day.slice(5), value: d.bookings }))} /></div>
        </Section>
        {s.revenue_30d && (
          <Section title={t("revenue30")} className="xl:col-span-2">
            <div className="p-3"><RevenueChart data={s.revenue_30d.map((d) => ({ label: d.day.slice(5), value: d.amount / 100 }))} currency={s.currency} locale={locale} /></div>
          </Section>
        )}
        <Section title={t("popular")}>
          {s.popular_services.length === 0 ? <Empty>{tc("empty")}</Empty> : (
            <ul className="divide-y text-sm">
              {s.popular_services.map((p) => (
                <li key={p.name} className="flex items-center gap-3 px-4 py-2">
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="tabular text-muted-foreground">{p.n}×</span>
                  {p.revenue !== null && <span className="tabular w-24 text-right">{money(p.revenue)}</span>}
                </li>
              ))}
            </ul>
          )}
        </Section>
        {ctx.modules.includes("inventory") && can(ctx, "inventory.view") && (
          <Section title={t("lowStock")}>
            {s.low_stock.length === 0 ? <Empty>{tc("empty")}</Empty> : (
              <ul className="divide-y text-sm">
                {s.low_stock.map((p) => (
                  <li key={p.id}>
                    <Link href={`${base}/inventory?q=${encodeURIComponent(p.sku)}`} className="flex items-center gap-3 px-4 py-2 hover:bg-muted/50">
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className="tabular text-warning">{Number(p.on_hand)} / {Number(p.min_stock)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}
        {ctx.modules.includes("tire_hotel") && (
          <Section title={t("storageEnding")}>
            {s.storage_ending.length === 0 ? <Empty>{tc("empty")}</Empty> : (
              <ul className="divide-y text-sm">
                {s.storage_ending.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-2">
                    <span className="tabular w-24 font-medium">{c.code}</span>
                    <span className="min-w-0 flex-1 truncate">{c.customer}</span>
                    <span className="tabular text-muted-foreground">{formatDate(c.ends_on, s.timezone, locale)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}
      </div>
    </>
  );
}
