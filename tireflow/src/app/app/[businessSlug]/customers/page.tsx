import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { can, requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/ui";
import { SearchBar, Pager } from "@/components/app/list-controls";
import { CustomersTable, type CustomerRow } from "./customers-table";
import { ImportDialog } from "./import-dialog";

const PAGE = 50;
const days = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
const SEGMENTS = ["all", "vip", "new", "regular", "inactive", "corporate", "hotel"] as const;

export default async function CustomersPage({ params, searchParams }: PageProps<"/app/[businessSlug]/customers">) {
  const { businessSlug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(businessSlug, "customers.view", "customers");
  const t = await getTranslations("customers");
  const locale = await getLocale();
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const segment = typeof sp.segment === "string" ? sp.segment : "all";
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();

  let rows: CustomerRow[] = [];
  let total = 0;
  if (q.length >= 2) {
    const { data } = await supabase.rpc("search_customers", { p_business: ctx.id, p_query: q, p_limit: 100 });
    const ids = (data ?? []).map((r) => r.id);
    const { data: full } = ids.length
      ? await supabase.from("customers").select("id, first_name, last_name, phone, email, visits_count, total_spent, last_visit_at, is_vip, vehicles(plate)").in("id", ids)
      : { data: [] };
    rows = (full ?? []).map(toRow);
    total = rows.length;
  } else {
    let query = supabase.from("customers")
      .select("id, first_name, last_name, phone, email, visits_count, total_spent, last_visit_at, is_vip, vehicles(plate)", { count: "exact" })
      .eq("business_id", ctx.id).is("deleted_at", null).is("merged_into", null);
    if (segment === "vip") query = query.eq("is_vip", true);
    if (segment === "new") query = query.gte("created_at", days(30));
    if (segment === "regular") query = query.gte("visits_count", 3);
    if (segment === "inactive") query = query.lt("last_visit_at", days(182));
    if (segment === "seasonal") query = query.lt("last_visit_at", days(150)).gte("last_visit_at", days(244));
    if (segment === "corporate") query = query.not("corporate_customer_id", "is", null);
    if (segment === "hotel") {
      const { data: sets } = await supabase.from("tire_sets").select("customer_id").eq("business_id", ctx.id).eq("status", "stored");
      query = query.in("id", [...new Set((sets ?? []).map((s) => s.customer_id))]);
    }
    const { data, count } = await query.order("last_visit_at", { ascending: false, nullsFirst: false })
      .range((page - 1) * PAGE, page * PAGE - 1);
    rows = (data ?? []).map(toRow);
    total = count ?? 0;
  }

  const base = `/app/${ctx.slug}/customers`;
  return (
    <>
      <PageHeader
        title={t("title")}
        actions={can(ctx, "customers.manage") && (
          <>
            <ImportDialog slug={ctx.slug} />
            <Button size="sm" render={<Link href={`${base}/new`} />}><Plus />{t("new")}</Button>
          </>
        )}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchBar defaultValue={q} />
        <nav className="flex flex-wrap gap-1 text-sm">
          {SEGMENTS.map((s) => (
            <Link key={s} href={s === "all" ? base : `${base}?segment=${s}`}
              className={`rounded-md px-2.5 py-1 ${segment === s && !q ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60"}`}>
              {t(`segments.${s}`)}
            </Link>
          ))}
        </nav>
      </div>
      <CustomersTable rows={rows} base={base} currency={ctx.settings.currency} timezone={ctx.settings.timezone} locale={locale} />
      {!q && <Pager page={page} total={total} pageSize={PAGE} />}
    </>
  );
}

function toRow(c: {
  id: string; first_name: string; last_name: string; phone: string | null; email: string | null; visits_count: number;
  total_spent: number; last_visit_at: string | null; is_vip: boolean; vehicles: { plate: string | null }[];
}): CustomerRow {
  return {
    id: c.id, name: `${c.first_name} ${c.last_name}`.trim() || "—", phone: c.phone, email: c.email,
    plates: c.vehicles.map((v) => v.plate).filter(Boolean) as string[], visits: c.visits_count,
    spent: c.total_spent, lastVisit: c.last_visit_at, vip: c.is_vip,
  };
}
