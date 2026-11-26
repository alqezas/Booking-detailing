import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { can, requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatMoney, minorToInput } from "@/lib/format";
import { Empty, PageHeader, Section, Stat } from "@/components/app/ui";
import { SearchBar } from "@/components/app/list-controls";
import { MovementDialog, ProductDialog } from "./dialogs";

const CATS = ["new_tires", "used_tires", "rims", "valves", "tpms_sensors", "balance_weights", "repair_materials", "bolts", "nuts", "consumables", "other"] as const;

export default async function InventoryPage({ params, searchParams }: PageProps<"/app/[businessSlug]/inventory">) {
  const { businessSlug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(businessSlug, "inventory.view", "inventory");
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const cat = typeof sp.cat === "string" && (CATS as readonly string[]).includes(sp.cat) ? sp.cat : null;
  const supabase = await createClient();
  let pq = supabase.from("products").select("id, sku, barcode, name, category, manufacturer, purchase_price, retail_price, min_stock, location_note, stock:inventory_stock(warehouse_id, on_hand, avg_cost)")
    .eq("business_id", ctx.id).is("deleted_at", null);
  if (q) pq = pq.or(`name.ilike.%${q.replace(/[%,()]/g, " ")}%,sku.ilike.%${q.replace(/[%,()]/g, "")}%,barcode.eq.${q.replace(/[^0-9A-Za-z]/g, "")}`);
  if (cat) pq = pq.eq("category", cat as (typeof CATS)[number]);
  const [products, warehouses, moves, t, tc, locale] = await Promise.all([
    pq.order("name").limit(300),
    supabase.from("warehouses").select("id, name").eq("business_id", ctx.id).eq("purpose", "stock").order("name"),
    supabase.from("inventory_movements").select("id, kind, quantity, created_at, note, product:products(name, sku), warehouse:warehouses(name)").eq("business_id", ctx.id).order("created_at", { ascending: false }).limit(25),
    getTranslations("inventory"), getTranslations("common"), getLocale(),
  ]);
  const money = (v: number) => formatMoney(v, ctx.settings.currency, locale);
  const rows = (products.data ?? []).map((p) => {
    const onHand = p.stock.reduce((s, x) => s + Number(x.on_hand), 0);
    const value = p.stock.reduce((s, x) => s + Number(x.on_hand) * x.avg_cost, 0);
    return { ...p, onHand, value };
  });
  const low = rows.filter((r) => r.min_stock > 0 && r.onHand <= Number(r.min_stock)).length;
  const value = rows.reduce((s, r) => s + r.value, 0);
  const edit = can(ctx, "inventory.manage");
  const wh = warehouses.data ?? [];
  const base = `/app/${ctx.slug}/inventory`;

  return (
    <>
      <PageHeader title={t("title")} actions={edit && (
        <>
          <MovementDialog slug={ctx.slug} products={rows.map((r) => ({ id: r.id, name: `${r.sku} · ${r.name}` }))} warehouses={wh} currency={ctx.settings.currency} />
          <ProductDialog slug={ctx.slug} currency={ctx.settings.currency} />
        </>
      )} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={tc("rows", { count: rows.length })} value={rows.length} />
        <Stat label={t("low")} value={low} tone={low ? "warn" : undefined} />
        {can(ctx, "finance.view") && <Stat label={t("purchase")} value={money(Math.round(value))} />}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchBar defaultValue={q} placeholder={`${t("sku")} / ${t("barcode")} / ${tc("name")}`} />
        <nav className="flex flex-wrap gap-1 text-sm">
          <Link href={base} className={`rounded-md px-2 py-1 ${!cat ? "bg-muted font-medium" : "text-muted-foreground"}`}>{tc("all")}</Link>
          {CATS.map((c) => <Link key={c} href={`${base}?cat=${c}`} className={`rounded-md px-2 py-1 ${cat === c ? "bg-muted font-medium" : "text-muted-foreground"}`}>{t(`categories.${c}`)}</Link>)}
        </nav>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="overflow-x-auto rounded-lg border bg-card xl:col-span-2">
          <table className="w-full text-sm">
            <thead className="border-b text-xs text-muted-foreground"><tr className="text-left">
              <th className="px-3 py-2 font-medium">{t("sku")}</th><th className="px-3 py-2 font-medium">{tc("name")}</th>
              <th className="px-3 py-2 font-medium">{t("category")}</th>
              {wh.map((w) => <th key={w.id} className="px-2 py-2 text-right font-medium">{w.name}</th>)}
              <th className="px-2 py-2 text-right font-medium">{t("minStock")}</th><th className="px-3 py-2 text-right font-medium">{t("retail")}</th><th />
            </tr></thead>
            <tbody className="divide-y">
              {rows.length === 0 && <tr><td colSpan={7 + wh.length}><Empty>{tc("empty")}</Empty></td></tr>}
              {rows.map((r) => (
                <tr key={r.id} className={r.min_stock > 0 && r.onHand <= Number(r.min_stock) ? "bg-warning/5" : ""}>
                  <td className="px-3 py-1.5 font-mono text-xs">{r.sku}</td>
                  <td className="px-3 py-1.5">{r.name}<div className="text-xs text-muted-foreground">{r.manufacturer} {r.location_note}</div></td>
                  <td className="px-3 py-1.5 text-muted-foreground">{t(`categories.${r.category as "other"}`)}</td>
                  {wh.map((w) => <td key={w.id} className="tabular px-2 py-1.5 text-right">{Number(r.stock.find((s) => s.warehouse_id === w.id)?.on_hand ?? 0)}</td>)}
                  <td className="tabular px-2 py-1.5 text-right text-muted-foreground">{Number(r.min_stock)}</td>
                  <td className="tabular px-3 py-1.5 text-right">{money(r.retail_price)}</td>
                  <td className="px-2 py-1">{edit && <ProductDialog slug={ctx.slug} currency={ctx.settings.currency} product={{
                    id: r.id, sku: r.sku, barcode: r.barcode ?? "", name: r.name, category: r.category, manufacturer: r.manufacturer ?? "",
                    purchase_price: minorToInput(r.purchase_price), retail_price: minorToInput(r.retail_price), min_stock: String(r.min_stock), location_note: r.location_note ?? "",
                  }} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Section title={t("history")}>
          <ul className="divide-y text-sm">
            {(moves.data ?? []).map((m) => (
              <li key={m.id} className="px-4 py-2">
                <div className="flex justify-between gap-2">
                  <span className="truncate">{m.product?.name}</span>
                  <span className={`tabular ${Number(m.quantity) < 0 ? "text-destructive" : "text-success"}`}>{Number(m.quantity) > 0 ? "+" : ""}{Number(m.quantity)}</span>
                </div>
                <div className="text-xs text-muted-foreground">{t(`kinds.${m.kind as "receipt"}`)} · {m.warehouse?.name} · {formatDateTime(m.created_at, ctx.settings.timezone, locale)}</div>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </>
  );
}
