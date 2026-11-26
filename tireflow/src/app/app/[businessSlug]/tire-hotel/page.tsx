import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { can, requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Empty, PageHeader, Section, Stat, StatusBadge } from "@/components/app/ui";
import { Pager, SearchBar } from "@/components/app/list-controls";
import { GridDialog } from "./grid-dialog";

const PAGE = 50;

export default async function TireHotelPage({ params, searchParams }: PageProps<"/app/[businessSlug]/tire-hotel">) {
  const { businessSlug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(businessSlug, "tire_hotel.view", "tire_hotel");
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const status = sp.status === "released" ? "released" : "stored";
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();
  const [t, tc, to, locale] = await Promise.all([getTranslations("hotel"), getTranslations("common"), getTranslations("orders"), getLocale()]);

  let query = supabase.from("tire_sets")
    .select("id, code, season, manufacturer, model, width, profile, diameter, quantity, with_rims, status, created_at, customer:customers(first_name, last_name), vehicle:vehicles(plate), location:storage_locations(code), contracts:tire_storage_contracts(ends_on, status, price, paid_total)", { count: "exact" })
    .eq("business_id", ctx.id).eq("status", status);
  if (q) {
    const norm = q.toUpperCase().replace(/[^A-Z0-9-]/g, "");
    const { data: vs } = await supabase.from("vehicles").select("id").eq("business_id", ctx.id).ilike("plate_normalized", `%${norm.replace(/-/g, "")}%`).limit(100);
    const ids = (vs ?? []).map((v) => v.id);
    query = ids.length ? query.or(`code.ilike.%${norm}%,vehicle_id.in.(${ids.join(",")})`) : query.ilike("code", `%${norm}%`);
  }
  const [{ data, count }, cells, warehouses] = await Promise.all([
    query.order("created_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1),
    supabase.from("storage_locations").select("warehouse_id, capacity_sets, occupied_sets, zone").eq("business_id", ctx.id).eq("is_active", true),
    supabase.from("warehouses").select("id, name").eq("business_id", ctx.id).eq("purpose", "tire_hotel"),
  ]);
  const cap = (cells.data ?? []).reduce((s, c) => s + c.capacity_sets, 0);
  const occ = (cells.data ?? []).reduce((s, c) => s + c.occupied_sets, 0);
  const zones = new Map<string, { cap: number; occ: number }>();
  for (const c of cells.data ?? []) {
    const k = `${warehouses.data?.find((w) => w.id === c.warehouse_id)?.name ?? ""} · ${c.zone}`;
    const z = zones.get(k) ?? { cap: 0, occ: 0 };
    zones.set(k, { cap: z.cap + c.capacity_sets, occ: z.occ + c.occupied_sets });
  }
  const base = `/app/${ctx.slug}/tire-hotel`;

  return (
    <>
      <PageHeader title={t("title")} actions={can(ctx, "tire_hotel.manage") && (
        <>
          <GridDialog slug={ctx.slug} warehouses={warehouses.data ?? []} />
          <Button size="sm" render={<Link href={`${base}/check-in`} />}><Plus />{t("checkIn")}</Button>
        </>
      )} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("capacity")} value={cap} />
        <Stat label={t("occupied")} value={occ} />
        <Stat label={t("free")} value={cap - occ} />
        <Stat label={t("fill")} value={`${cap ? Math.round((occ / cap) * 100) : 0}%`} tone={cap && occ / cap > 0.9 ? "warn" : undefined} />
      </div>
      {zones.size > 0 && (
        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[...zones].map(([k, z]) => (
            <div key={k} className="rounded-lg border bg-card px-3 py-2 text-sm">
              <div className="flex justify-between"><span>{k}</span><span className="tabular text-muted-foreground">{z.occ}/{z.cap}</span></div>
              <div className="mt-1.5 h-1.5 rounded bg-muted"><div className="h-1.5 rounded bg-primary" style={{ width: `${(z.occ / Math.max(1, z.cap)) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchBar defaultValue={q} placeholder={t("scan")} />
        <nav className="flex gap-1 text-sm">
          <Link href={base} className={`rounded-md px-2.5 py-1 ${status === "stored" ? "bg-muted font-medium" : "text-muted-foreground"}`}>{t("occupied")}</Link>
          <Link href={`${base}?status=released`} className={`rounded-md px-2.5 py-1 ${status === "released" ? "bg-muted font-medium" : "text-muted-foreground"}`}>{t("released")}</Link>
        </nav>
      </div>
      <Section title={tc("rows", { count: count ?? 0 })}>
        {(data ?? []).length === 0 ? <Empty>{tc("empty")}</Empty> : (
          <ul className="divide-y text-sm">
            {data!.map((s) => {
              const c = s.contracts.find((x) => x.status === "active");
              const unpaid = c && c.paid_total < c.price;
              return (
                <li key={s.id}>
                  <Link href={`${base}/${s.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 hover:bg-muted/50">
                    <span className="tabular w-24 font-medium">{s.code}</span>
                    <span className="w-20 rounded bg-muted px-1.5 text-center font-mono text-xs">{s.location?.code ?? "—"}</span>
                    <span className="min-w-40 flex-1 truncate">{s.customer ? `${s.customer.first_name} ${s.customer.last_name}` : "—"} <span className="font-mono text-xs text-muted-foreground">{s.vehicle?.plate}</span></span>
                    <span className="text-muted-foreground">{s.quantity}× {s.manufacturer} {s.width && `${s.width}/${s.profile} R${s.diameter}`}</span>
                    <span>{t(`seasons.${s.season as "summer"}`)}</span>
                    {c && <span className="tabular text-xs text-muted-foreground">{t("ends")} {formatDate(c.ends_on, ctx.settings.timezone, locale)}</span>}
                    {unpaid && <StatusBadge status="unpaid" label={to("payment.unpaid")} />}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      <Pager page={page} total={count ?? 0} pageSize={PAGE} />
    </>
  );
}
