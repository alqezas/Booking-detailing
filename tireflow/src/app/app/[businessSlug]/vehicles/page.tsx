import { getTranslations } from "next-intl/server";
import { can, requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/ui";
import { Pager, SearchBar } from "@/components/app/list-controls";
import { VehiclesTable, type VehicleRow } from "./vehicles-table";
import { VehicleDialog } from "../customers/vehicle-dialog";

const PAGE = 50;

export default async function VehiclesPage({ params, searchParams }: PageProps<"/app/[businessSlug]/vehicles">) {
  const { businessSlug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(businessSlug, "customers.view", "vehicles");
  const t = await getTranslations("vehicles");
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();

  let query = supabase.from("vehicles")
    .select("id, make, model, year, plate, rim_diameter, tire_size, has_tpms, has_runflat, customer:customers(id, first_name, last_name, phone), category:vehicle_categories(name)", { count: "exact" })
    .eq("business_id", ctx.id).is("deleted_at", null);
  if (q) {
    const plate = q.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const safe = q.replace(/[%,()]/g, " ");
    query = plate.length >= 2
      ? query.or(`plate_normalized.ilike.%${plate}%,make.ilike.%${safe}%,model.ilike.%${safe}%,vin.ilike.%${plate}%`)
      : query.or(`make.ilike.%${safe}%,model.ilike.%${safe}%`);
  }
  const [{ data, count }, cats] = await Promise.all([
    query.order("created_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1),
    supabase.from("vehicle_categories").select("id, name").eq("business_id", ctx.id).eq("is_active", true).order("sort_order"),
  ]);
  const rows: VehicleRow[] = (data ?? []).map((v) => ({
    id: v.id, plate: v.plate, vehicle: `${v.make} ${v.model}`.trim(), year: v.year, category: v.category?.name ?? null,
    rim: v.rim_diameter, size: v.tire_size, flags: [v.has_tpms && "TPMS", v.has_runflat && "RunFlat"].filter(Boolean) as string[],
    customerId: v.customer?.id ?? null, owner: v.customer ? `${v.customer.first_name} ${v.customer.last_name}`.trim() : null,
    phone: v.customer?.phone ?? null,
  }));

  return (
    <>
      <PageHeader title={t("title")} actions={can(ctx, "customers.manage") && <VehicleDialog slug={ctx.slug} customerId={null} categories={cats.data ?? []} />} />
      <div className="mb-3"><SearchBar defaultValue={q} placeholder={t("findByPlate")} /></div>
      <VehiclesTable rows={rows} base={`/app/${ctx.slug}`} canBook={can(ctx, "calendar.manage")} />
      <Pager page={page} total={count ?? 0} pageSize={PAGE} />
    </>
  );
}
