import { getLocale } from "next-intl/server";
import { can, requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDays, zonedDay, zonedInstant } from "@/lib/format";
import { CalendarBoard, type CalBooking, type CalBlock } from "./board";

export default async function CalendarPage({ params, searchParams }: PageProps<"/app/[businessSlug]/calendar">) {
  const { businessSlug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(businessSlug, "calendar.view", "calendar");
  const tz = ctx.settings.timezone;
  const view = (["day", "week", "list", "staff"] as const).find((v) => v === sp.view) ?? "day";
  const day = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : zonedDay(new Date(), tz);
  const branchId = (typeof sp.branch === "string" && ctx.branches.some((b) => b.id === sp.branch)) ? sp.branch : ctx.branches[0]?.id;
  const rangeStart = view === "week" ? weekStart(day) : day;
  const rangeEnd = addDays(rangeStart, view === "week" ? 7 : view === "list" ? 14 : 1);
  const from = zonedInstant(rangeStart, 0, tz).toISOString();
  const to = zonedInstant(rangeEnd, 0, tz).toISOString();
  const supabase = await createClient();

  const [posts, bookings, blocks, employees, services, categories, branch, focus] = await Promise.all([
    supabase.from("workstations").select("id, name, kind").eq("branch_id", branchId!).eq("is_active", true).is("deleted_at", null).order("sort_order"),
    supabase.from("bookings")
      .select("id, starts_at, ends_at, status, source, workstation_id, employee_id, plate_text, contact_name, contact_phone, internal_note, customer_note, quoted_total, customer:customers(id, first_name, last_name, phone), vehicle:vehicles(id, make, model, plate), booking_services(service:services(name)), work_order:work_orders(id, number)")
      .eq("business_id", ctx.id).eq("branch_id", branchId!).lt("starts_at", to).gt("ends_at", from).order("starts_at"),
    supabase.from("resource_occupancies").select("id, resource_id, during, block_reason").eq("branch_id", branchId!).is("booking_id", null).eq("resource_kind", "workstation").overlaps("during", `[${from},${to})`),
    supabase.from("employees").select("id, first_name, last_name, color, branch_id").eq("business_id", ctx.id).eq("is_active", true).is("deleted_at", null).order("first_name"),
    supabase.from("services").select("id, name, unit, base_duration_min").eq("business_id", ctx.id).eq("is_active", true).is("deleted_at", null).order("sort_order"),
    supabase.from("vehicle_categories").select("id, name").eq("business_id", ctx.id).eq("is_active", true).order("sort_order"),
    supabase.from("branches").select("opening_hours").eq("id", branchId!).single(),
    typeof sp.booking === "string" ? supabase.from("bookings").select("starts_at, branch_id").eq("id", sp.booking).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const calBookings: CalBooking[] = (bookings.data ?? []).map((b) => ({
    id: b.id, startsAt: b.starts_at, endsAt: b.ends_at, status: b.status, source: b.source, postId: b.workstation_id,
    employeeId: b.employee_id, customerId: b.customer?.id ?? null,
    customer: b.customer ? `${b.customer.first_name} ${b.customer.last_name}`.trim() : b.contact_name,
    phone: b.customer?.phone ?? b.contact_phone, plate: b.vehicle?.plate ?? b.plate_text,
    vehicle: b.vehicle ? `${b.vehicle.make} ${b.vehicle.model}`.trim() : null,
    services: b.booking_services.map((s) => s.service?.name).filter(Boolean) as string[],
    note: b.internal_note, customerNote: b.customer_note, total: b.quoted_total,
    orderId: Array.isArray(b.work_order) ? b.work_order[0]?.id ?? null : (b.work_order as { id: string } | null)?.id ?? null,
  }));
  const calBlocks: CalBlock[] = (blocks.data ?? []).flatMap((o) => {
    const m = /^[[(]"?([^",]+)"?,"?([^",)\]]+)"?[)\]]$/.exec(o.during as unknown as string);
    if (!m) return [];
    const s = new Date(m[1]).toISOString(), e = new Date(m[2]).toISOString();
    return e > from && s < to ? [{ id: o.id, postId: o.resource_id, startsAt: s, endsAt: e, reason: o.block_reason ?? "" }] : [];
  });

  return (
    <CalendarBoard
      slug={ctx.slug}
      businessId={ctx.id}
      branchId={branchId!}
      branches={ctx.branches}
      view={view}
      day={day}
      rangeStart={rangeStart}
      timezone={tz}
      locale={await getLocale()}
      currency={ctx.settings.currency}
      slotStep={ctx.settings.slot_step_minutes}
      hours={(branch.data?.opening_hours ?? {}) as Record<string, [string, string][]>}
      posts={posts.data ?? []}
      bookings={calBookings}
      blocks={calBlocks}
      employees={(employees.data ?? []).map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}`.trim(), color: e.color, branchId: e.branch_id }))}
      services={services.data ?? []}
      categories={categories.data ?? []}
      canManage={can(ctx, "calendar.manage")}
      canOrder={can(ctx, "orders.manage") && ctx.modules.includes("orders")}
      openNew={sp.new === "1"}
      presetCustomer={typeof sp.customer === "string" ? sp.customer : undefined}
      presetVehicle={typeof sp.vehicle === "string" ? sp.vehicle : undefined}
      focusBooking={typeof sp.booking === "string" ? sp.booking : undefined}
      focusDay={focus.data ? zonedDay(new Date(focus.data.starts_at), tz) : undefined}
    />
  );
}

function weekStart(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(day, -dow);
}
