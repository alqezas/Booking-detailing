import { getLocale, getTranslations } from "next-intl/server";
import { can, requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import { PageHeader } from "@/components/app/ui";
import { EmployeeDialog } from "./employee-dialog";

function daysAgo(n: number) {
  return new Date(Date.now() - n * 86400000).toISOString();
}

export default async function EmployeesPage({ params }: PageProps<"/app/[businessSlug]/employees">) {
  const { businessSlug } = await params;
  const ctx = await requirePermission(businessSlug, "employees.view", "employees");
  const supabase = await createClient();
  const since = daysAgo(90);
  const fin = can(ctx, "finance.view") || can(ctx, "analytics.view");
  const [emps, orders, schedules, absences, t, tc, locale] = await Promise.all([
    supabase.from("employees").select("*, branch:branches(name)").eq("business_id", ctx.id).is("deleted_at", null).order("first_name"),
    can(ctx, "orders.view_all")
      ? supabase.from("work_orders").select("employee_id, total, started_at, completed_at").eq("business_id", ctx.id).eq("status", "completed").gte("completed_at", since)
      : Promise.resolve({ data: [] as { employee_id: string | null; total: number; started_at: string | null; completed_at: string | null }[] }),
    supabase.from("employee_schedules").select("employee_id, weekday, starts, ends").eq("business_id", ctx.id),
    supabase.from("employee_absences").select("employee_id, kind, during").eq("business_id", ctx.id),
    getTranslations("employees"), getTranslations("common"), getLocale(),
  ]);
  const stats = (id: string) => {
    const mine = (orders.data ?? []).filter((o) => o.employee_id === id);
    const mins = mine.filter((o) => o.started_at && o.completed_at).map((o) => (new Date(o.completed_at!).getTime() - new Date(o.started_at!).getTime()) / 60000);
    const revenue = mine.reduce((s, o) => s + o.total, 0);
    return { n: mine.length, revenue, avg: mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) : null };
  };
  const hours = (id: string) => (schedules.data ?? []).filter((s) => s.employee_id === id)
    .reduce((s, x) => s + (Number(x.ends.slice(0, 2)) * 60 + Number(x.ends.slice(3, 5)) - Number(x.starts.slice(0, 2)) * 60 - Number(x.starts.slice(3, 5))) / 60, 0);
  return (
    <>
      <PageHeader title={t("title")} actions={can(ctx, "employees.manage") && <EmployeeDialog slug={ctx.slug} branches={ctx.branches} />} />
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b text-xs text-muted-foreground"><tr className="text-left">
            <th className="px-4 py-2 font-medium">{tc("name")}</th><th className="px-2 py-2 font-medium">{t("position")}</th>
            <th className="px-2 py-2 font-medium">{tc("branch")}</th><th className="px-2 py-2 font-medium">{t("skills")}</th>
            <th className="px-2 py-2 text-right font-medium">{t("schedule")}</th>
            <th className="px-2 py-2 text-right font-medium">{t("orders")}</th>
            {fin && <th className="px-2 py-2 text-right font-medium">{t("revenue")}</th>}
            {fin && <th className="px-2 py-2 text-right font-medium">{t("commission")}</th>}
            <th className="px-2 py-2 text-right font-medium">Ø min</th><th className="px-2 py-2 font-medium">{t("absences")}</th>
          </tr></thead>
          <tbody className="divide-y">
            {(emps.data ?? []).map((e) => {
              const s = stats(e.id);
              const abs = (absences.data ?? []).filter((a) => a.employee_id === e.id);
              return (
                <tr key={e.id} className={e.is_active ? "" : "text-muted-foreground"}>
                  <td className="px-4 py-2"><span className="mr-2 inline-block size-2 rounded-full" style={{ background: e.color }} /><span className="font-medium">{e.first_name} {e.last_name}</span>{e.membership_id && <span className="ml-2 rounded bg-muted px-1 text-xs">CRM</span>}</td>
                  <td className="px-2 py-2">{e.position}</td>
                  <td className="px-2 py-2">{e.branch?.name}</td>
                  <td className="px-2 py-2 text-xs text-muted-foreground">{e.skills.join(", ")}</td>
                  <td className="tabular px-2 py-2 text-right">{hours(e.id)} h</td>
                  <td className="tabular px-2 py-2 text-right">{s.n}</td>
                  {fin && <td className="tabular px-2 py-2 text-right">{formatMoney(s.revenue, ctx.settings.currency, locale)}</td>}
                  {fin && <td className="tabular px-2 py-2 text-right">{formatMoney(Math.round((s.revenue * e.commission_bp) / 10000), ctx.settings.currency, locale)}</td>}
                  <td className="tabular px-2 py-2 text-right">{s.avg ?? "—"}</td>
                  <td className="px-2 py-2 text-xs">{abs.map((a) => a.kind).join(", ") || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
