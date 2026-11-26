import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Download } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { can, requireBusiness } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDays, formatDate, formatDateTime, formatMoney, zonedDay, zonedInstant } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Empty, PageHeader, Section, Stat } from "@/components/app/ui";
import { ExpenseDialog } from "./expense-dialog";

export default async function FinancePage({ params, searchParams }: PageProps<"/app/[businessSlug]/finance">) {
  const { businessSlug } = await params;
  const sp = await searchParams;
  const ctx = await requireBusiness(businessSlug);
  if (!ctx.modules.includes("finance")) notFound();
  if (!can(ctx, "finance.view") && !can(ctx, "finance.manage")) redirect(`/app/${businessSlug}/dashboard`);
  const tz = ctx.settings.timezone;
  const today = zonedDay(new Date(), tz);
  const from = typeof sp.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : `${today.slice(0, 7)}-01`;
  const to = typeof sp.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : today;
  const fromI = zonedInstant(from, 0, tz).toISOString(), toI = zonedInstant(addDays(to, 1), 0, tz).toISOString();
  const supabase = await createClient();
  const [payments, expenses, debts, t, tc, locale] = await Promise.all([
    supabase.from("payments").select("id, kind, amount, received_at, note, work_order_id, storage_contract_id, method:payment_methods(name), order:work_orders(number)")
      .eq("business_id", ctx.id).gte("received_at", fromI).lt("received_at", toI).order("received_at", { ascending: false }).limit(500),
    supabase.from("expenses").select("id, category, amount, spent_on, note, branch:branches(name)").eq("business_id", ctx.id).gte("spent_on", from).lte("spent_on", to).order("spent_on", { ascending: false }),
    supabase.from("work_orders").select("id, number, total, paid_total, completed_at, customer:customers(first_name, last_name)").eq("business_id", ctx.id).eq("status", "completed").in("payment_status", ["unpaid", "partial"]).order("completed_at").limit(50),
    getTranslations("finance"), getTranslations("common"), getLocale(),
  ]);
  const money = (v: number) => formatMoney(v, ctx.settings.currency, locale);
  const income = (payments.data ?? []).filter((p) => p.kind === "payment").reduce((s, p) => s + p.amount, 0);
  const refunds = (payments.data ?? []).filter((p) => p.kind === "refund").reduce((s, p) => s + p.amount, 0);
  const spent = (expenses.data ?? []).reduce((s, e) => s + e.amount, 0);
  const outstanding = (debts.data ?? []).reduce((s, o) => s + o.total - o.paid_total, 0);
  const byMethod = new Map<string, number>();
  for (const p of payments.data ?? []) byMethod.set(p.method?.name ?? "?", (byMethod.get(p.method?.name ?? "?") ?? 0) + (p.kind === "payment" ? p.amount : -p.amount));
  const base = `/app/${ctx.slug}/finance`;
  const range = (f: string, tt: string) => `${base}?from=${f}&to=${tt}`;
  const prevMonthStart = `${addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7)}-01`;

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("disclaimer")}
        actions={
          <>
            {can(ctx, "finance.export") && <Button size="sm" variant="outline" render={<a href={`/api/export/payments?business=${ctx.slug}&from=${from}&to=${to}`} />}><Download />{tc("export")}</Button>}
            {can(ctx, "finance.manage") && <ExpenseDialog slug={ctx.slug} branches={ctx.branches} currency={ctx.settings.currency} today={today} />}
          </>
        }
      />
      <form className="mb-4 flex flex-wrap items-end gap-2 text-sm">
        <input type="date" name="from" defaultValue={from} className="h-8 rounded-md border bg-transparent px-2" />
        <span>–</span>
        <input type="date" name="to" defaultValue={to} className="h-8 rounded-md border bg-transparent px-2" />
        <Button size="sm" variant="outline" type="submit">{tc("filter")}</Button>
        <Link className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted" href={range(`${today.slice(0, 7)}-01`, today)}>{monthName(locale)}</Link>
        <Link className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted" href={range(prevMonthStart, addDays(`${today.slice(0, 7)}-01`, -1))}>−1</Link>
        <Link className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted" href={range(`${today.slice(0, 4)}-01-01`, today)}>{today.slice(0, 4)}</Link>
      </form>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label={t("income")} value={money(income)} />
        <Stat label={t("refunds")} value={money(refunds)} />
        <Stat label={t("net")} value={money(income - refunds)} />
        <Stat label={t("expenses")} value={money(spent)} />
        <Stat label={t("debts")} value={money(outstanding)} tone={outstanding ? "warn" : undefined} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Section title={t("payments")} className="xl:col-span-2">
          {(payments.data ?? []).length === 0 ? <Empty>{tc("empty")}</Empty> : (
            <ul className="divide-y text-sm">
              {payments.data!.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-1.5">
                  <span className="tabular w-36 text-muted-foreground">{formatDateTime(p.received_at, tz, locale)}</span>
                  <span className="w-24">{p.method?.name}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {p.work_order_id ? <Link className="hover:underline" href={`/app/${ctx.slug}/orders/${p.work_order_id}`}>{p.order?.number}</Link> : "Tire hotel"}
                    {p.note && <span className="text-muted-foreground"> · {p.note}</span>}
                  </span>
                  <span className={`tabular ${p.kind === "refund" ? "text-destructive" : ""}`}>{p.kind === "refund" ? "−" : ""}{money(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <div className="space-y-4">
          <Section title={tc("method")}>
            <ul className="divide-y text-sm">{[...byMethod].map(([m, v]) => <li key={m} className="flex justify-between px-4 py-1.5"><span>{m}</span><span className="tabular">{money(v)}</span></li>)}</ul>
          </Section>
          <Section title={t("debts")}>
            {(debts.data ?? []).length === 0 ? <Empty>{tc("empty")}</Empty> : (
              <ul className="divide-y text-sm">
                {debts.data!.map((o) => (
                  <li key={o.id}><Link href={`/app/${ctx.slug}/orders/${o.id}`} className="flex justify-between gap-2 px-4 py-1.5 hover:bg-muted/50">
                    <span className="truncate">{o.number} · {o.customer ? `${o.customer.first_name} ${o.customer.last_name}` : "—"}</span>
                    <span className="tabular text-warning">{money(o.total - o.paid_total)}</span>
                  </Link></li>
                ))}
              </ul>
            )}
          </Section>
          <Section title={t("expenses")}>
            {(expenses.data ?? []).length === 0 ? <Empty>{tc("empty")}</Empty> : (
              <ul className="divide-y text-sm">
                {expenses.data!.map((e) => (
                  <li key={e.id} className="flex justify-between gap-2 px-4 py-1.5">
                    <span className="truncate">{formatDate(e.spent_on, tz, locale)} · {t(`expenseCategories.${e.category as "rent"}`)} {e.branch?.name && <span className="text-muted-foreground">· {e.branch.name}</span>}</span>
                    <span className="tabular">{money(e.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}

function monthName(locale: string) {
  return new Intl.DateTimeFormat(locale, { month: "long" }).format(new Date());
}
