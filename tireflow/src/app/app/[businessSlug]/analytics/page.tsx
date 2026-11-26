import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDays, formatMoney, zonedDay } from "@/lib/format";
import { NativeSelect, PageHeader, Section, Stat } from "@/components/app/ui";
import { BarsChart } from "../dashboard/charts";

type Summary = {
  revenue: number; tax: number; cogs: number; gross_profit: number; orders: number; avg_ticket: number;
  customers_total: number; customers_new: number; customers_returning: number; bookings: number;
  cancel_rate: number; no_show_rate: number; by_source: Record<string, number>; storage_revenue: number; hotel_fill_pct: number;
  by_employee: { name: string; orders: number; revenue: number; avg_minutes: number | null }[];
  by_service: { name: string; n: number; revenue: number }[];
  by_month: { month: string; revenue: number; orders: number }[];
  by_weekday: { dow: number; bookings: number }[];
};

const RANGES = ["month", "prevMonth", "season", "year"] as const;

function rangeOf(r: (typeof RANGES)[number], today: string) {
  const monthStart = `${today.slice(0, 7)}-01`;
  if (r === "month") return { from: monthStart, to: today };
  if (r === "prevMonth") { const end = addDays(monthStart, -1); return { from: `${end.slice(0, 7)}-01`, to: end }; }
  if (r === "season") return { from: addDays(today, -89), to: today };
  return { from: addDays(today, -364), to: today };
}
function previous(from: string, to: string) {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  return { from: addDays(from, -days), to: addDays(from, -1) };
}

export default async function AnalyticsPage({ params, searchParams }: PageProps<"/app/[businessSlug]/analytics">) {
  const { businessSlug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(businessSlug, "analytics.view", "analytics");
  const range = (RANGES as readonly string[]).includes(String(sp.range)) ? (sp.range as (typeof RANGES)[number]) : "month";
  const branch = typeof sp.branch === "string" && ctx.branches.some((b) => b.id === sp.branch) ? sp.branch : undefined;
  const today = zonedDay(new Date(), ctx.settings.timezone);
  const cur = rangeOf(range, today);
  const prev = previous(cur.from, cur.to);
  const supabase = await createClient();
  const [a, b, t, locale] = await Promise.all([
    supabase.rpc("analytics_summary", { p_business: ctx.id, p_from: cur.from, p_to: cur.to, p_branch: branch }),
    supabase.rpc("analytics_summary", { p_business: ctx.id, p_from: prev.from, p_to: prev.to, p_branch: branch }),
    getTranslations("analytics"), getLocale(),
  ]);
  const s = a.data as unknown as Summary;
  const p = b.data as unknown as Summary;
  const money = (v: number) => formatMoney(v, ctx.settings.currency, locale);
  const delta = (x: number, y: number) => (y === 0 ? (x === 0 ? "±0 %" : "new") : `${x >= y ? "+" : ""}${Math.round(((x - y) / y) * 100)} %`);
  const retention = s.customers_total ? Math.round((s.customers_returning / s.customers_total) * 100) : 0;
  const clv = s.customers_total ? Math.round(s.revenue / s.customers_total) : 0;
  const base = `/app/${ctx.slug}/analytics`;
  const wd = ["", "Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

  return (
    <>
      <PageHeader title={t("title")} description={`${cur.from} – ${cur.to} · ${t("vsPrevious")} ${prev.from} – ${prev.to}`} />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {RANGES.map((r) => (
          <Link key={r} href={`${base}?range=${r}${branch ? `&branch=${branch}` : ""}`} className={`rounded-md px-2.5 py-1 ${range === r ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60"}`}>{t(`ranges.${r}`)}</Link>
        ))}
        {ctx.branches.length > 1 && (
          <form>
            <input type="hidden" name="range" value={range} />
            <NativeSelect name="branch" defaultValue={branch ?? ""} className="w-auto" aria-label="branch">
              <option value="">∗</option>
              {ctx.branches.map((br) => <option key={br.id} value={br.id}>{br.name}</option>)}
            </NativeSelect>
            <button className="ml-1 rounded-md border px-2 py-1 text-xs" type="submit">OK</button>
          </form>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label={t("revenue")} value={money(s.revenue)} hint={delta(s.revenue, p.revenue)} />
        <Stat label={t("grossProfit")} value={money(s.gross_profit)} hint={delta(s.gross_profit, p.gross_profit)} />
        <Stat label={t("orders")} value={s.orders} hint={delta(s.orders, p.orders)} />
        <Stat label={t("avgTicket")} value={money(s.avg_ticket)} hint={delta(s.avg_ticket, p.avg_ticket)} />
        <Stat label={t("newCustomers")} value={s.customers_new} hint={delta(s.customers_new, p.customers_new)} />
        <Stat label={t("returning")} value={s.customers_returning} hint={`Retention ${retention} %`} />
        <Stat label="CLV" value={money(clv)} />
        <Stat label={t("cancelRate")} value={`${s.cancel_rate} %`} />
        <Stat label={t("noShowRate")} value={`${s.no_show_rate} %`} />
        <Stat label={t("storageRevenue")} value={money(s.storage_revenue)} hint={delta(s.storage_revenue, p.storage_revenue)} />
        <Stat label={t("hotelFill")} value={`${s.hotel_fill_pct} %`} />
        <Stat label="Online" value={`${s.bookings ? Math.round(((s.by_source.online ?? 0) / s.bookings) * 100) : 0} %`} hint={`${s.bookings} bookings`} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Section title={t("byMonth")}><div className="p-3"><BarsChart data={s.by_month.map((m) => ({ label: m.month, value: Math.round(m.revenue / 100) }))} color="var(--chart-1)" /></div></Section>
        <Section title={t("byWeekday")}><div className="p-3"><BarsChart data={[1, 2, 3, 4, 5, 6, 7].map((d) => ({ label: wd[d], value: s.by_weekday.find((x) => x.dow === d)?.bookings ?? 0 }))} /></div></Section>
        <Section title={t("byService")}>
          <ul className="divide-y text-sm">{s.by_service.map((x) => (
            <li key={x.name} className="flex gap-3 px-4 py-1.5"><span className="flex-1 truncate">{x.name}</span><span className="tabular text-muted-foreground">{x.n}×</span><span className="tabular w-28 text-right">{money(x.revenue)}</span></li>
          ))}</ul>
        </Section>
        <Section title={t("byEmployee")}>
          <ul className="divide-y text-sm">{s.by_employee.map((x) => (
            <li key={x.name} className="flex gap-3 px-4 py-1.5"><span className="flex-1 truncate">{x.name}</span><span className="tabular text-muted-foreground">{x.orders}× · Ø {x.avg_minutes ?? "—"} min</span><span className="tabular w-28 text-right">{money(x.revenue)}</span></li>
          ))}</ul>
        </Section>
      </div>
    </>
  );
}
