import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { CalendarPlus, ClipboardPlus, Star } from "lucide-react";
import { can, requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { DL, Empty, PageHeader, Section, StatusBadge } from "@/components/app/ui";
import { CustomerActions } from "./customer-actions";
import { VehicleDialog } from "../vehicle-dialog";

export default async function CustomerPage({ params }: PageProps<"/app/[businessSlug]/customers/[customerId]">) {
  const { businessSlug, customerId } = await params;
  const ctx = await requirePermission(businessSlug, "customers.view", "customers");
  const supabase = await createClient();
  const fin = can(ctx, "finance.view") || can(ctx, "finance.manage");

  const { data: c } = await supabase.from("customers").select("*").eq("id", customerId).eq("business_id", ctx.id).maybeSingle();
  if (!c) notFound();

  const [vehicles, bookings, orders, sets, consents, categories, payments, tags] = await Promise.all([
    supabase.from("vehicles").select("*, category:vehicle_categories(name)").eq("customer_id", c.id).is("deleted_at", null).order("created_at"),
    supabase.from("bookings").select("id, starts_at, status, plate_text, workstation:workstations(name)").eq("customer_id", c.id).order("starts_at", { ascending: false }).limit(20),
    can(ctx, "orders.view_all")
      ? supabase.from("work_orders").select("id, number, status, payment_status, total, created_at, vehicle:vehicles(plate)").eq("customer_id", c.id).order("created_at", { ascending: false }).limit(30)
      : Promise.resolve({ data: [] as never[] }),
    ctx.modules.includes("tire_hotel")
      ? supabase.from("tire_sets").select("id, code, season, status, manufacturer, diameter, location:storage_locations(code)").eq("customer_id", c.id).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as never[] }),
    supabase.from("customer_consent_state").select("kind, granted, recorded_at").eq("customer_id", c.id),
    supabase.from("vehicle_categories").select("id, name").eq("business_id", ctx.id).eq("is_active", true).order("sort_order"),
    fin ? supabase.from("payments").select("id, kind, amount, received_at, method:payment_methods(name)").eq("customer_id", c.id).order("received_at", { ascending: false }).limit(20)
        : Promise.resolve({ data: [] as never[] }),
    supabase.from("customer_tags").select("tag:tags(name)").eq("customer_id", c.id),
  ]);

  const [t, tc, tv, tcal, to, th, locale] = await Promise.all([
    getTranslations("customers"), getTranslations("common"), getTranslations("vehicles"), getTranslations("calendar"),
    getTranslations("orders"), getTranslations("hotel"), getLocale(),
  ]);
  const tz = ctx.settings.timezone;
  const money = (v: number) => formatMoney(v, ctx.settings.currency, locale);
  const base = `/app/${ctx.slug}`;
  const name = `${c.first_name} ${c.last_name}`.trim() || "—";
  const consent = (k: string) => consents.data?.find((x) => x.kind === k)?.granted;

  return (
    <>
      <PageHeader
        title={name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {c.is_vip && <span className="inline-flex items-center gap-1 text-warning"><Star className="size-3.5 fill-current" />{t("vip")}</span>}
            {(tags.data ?? []).map((x) => x.tag && <span key={x.tag.name} className="rounded bg-muted px-1.5 text-xs">{x.tag.name}</span>)}
            {c.anonymized_at && <span className="text-destructive">{t("anonymize")} · {formatDate(c.anonymized_at, tz, locale)}</span>}
          </span>
        }
        actions={
          <>
            {can(ctx, "calendar.manage") && <Button size="sm" render={<Link href={`${base}/calendar?new=1&customer=${c.id}`} />}><CalendarPlus />{tcal("newBooking")}</Button>}
            {can(ctx, "orders.manage") && <Button size="sm" variant="outline" render={<Link href={`${base}/orders/new?customer=${c.id}`} />}><ClipboardPlus />{to("new")}</Button>}
            <CustomerActions slug={ctx.slug} customer={{ id: c.id, name }} canEdit={can(ctx, "customers.manage")} canExport={can(ctx, "customers.export")}
              defaults={{
                first_name: c.first_name, last_name: c.last_name, phone: c.phone ?? "", email: c.email ?? "",
                preferred_channel: c.preferred_channel, locale: c.locale, discount_pct: String(c.discount_bp / 100),
                notes: c.notes ?? "", is_vip: c.is_vip, corporate_customer_id: c.corporate_customer_id ?? "",
                consent_marketing: consent("marketing_sms") ?? false,
              }} />
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Section title={tc("details")}>
            <DL items={[
              [tc("phone"), c.phone && <a className="tabular hover:underline" href={`tel:${c.phone}`}>{c.phone}</a>],
              [tc("email"), c.email && <a className="hover:underline" href={`mailto:${c.email}`}>{c.email}</a>],
              [t("channel"), t(`channels.${c.preferred_channel}` as "channels.sms")],
              [t("visits"), c.visits_count],
              ...(fin ? [[t("spent"), money(c.total_spent)] as [string, React.ReactNode]] : []),
              [t("lastVisit"), c.last_visit_at ? formatDate(c.last_visit_at, tz, locale) : null],
              [t("discount"), c.discount_bp ? `${c.discount_bp / 100} %` : null],
              [tc("notes"), c.notes && <span className="whitespace-pre-wrap">{c.notes}</span>],
            ]} />
          </Section>
          <Section title={t("consents")}>
            <DL items={[
              [t("dataProcessing"), consent("data_processing") ? tc("yes") : tc("no")],
              [t("marketing"), consent("marketing_sms") ? tc("yes") : tc("no")],
            ]} />
          </Section>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Section title={t("vehicles")} actions={can(ctx, "customers.manage") && <VehicleDialog slug={ctx.slug} customerId={c.id} categories={categories.data ?? []} />}>
            {(vehicles.data ?? []).length === 0 ? <Empty>{tc("empty")}</Empty> : (
              <ul className="divide-y text-sm">
                {vehicles.data!.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
                    <span className="rounded border bg-muted/50 px-1.5 font-mono text-xs">{v.plate ?? "—"}</span>
                    <span className="font-medium">{v.make} {v.model} {v.year && <span className="text-muted-foreground">{v.year}</span>}</span>
                    <span className="text-muted-foreground">{v.category?.name}</span>
                    {v.rim_diameter && <span className="text-muted-foreground">R{v.rim_diameter}</span>}
                    {v.tire_size && <span className="text-muted-foreground">{v.tire_size}</span>}
                    {v.has_tpms && <span className="rounded bg-muted px-1.5 text-xs">{tv("tpms")}</span>}
                    {v.has_runflat && <span className="rounded bg-muted px-1.5 text-xs">{tv("runflat")}</span>}
                    {can(ctx, "customers.manage") && (
                      <span className="ml-auto"><VehicleDialog slug={ctx.slug} customerId={c.id} categories={categories.data ?? []} vehicle={v} /></span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {can(ctx, "orders.view_all") && (
            <Section title={t("orders")}>
              {(orders.data ?? []).length === 0 ? <Empty>{tc("empty")}</Empty> : (
                <ul className="divide-y text-sm">
                  {orders.data!.map((o) => (
                    <li key={o.id}>
                      <Link href={`${base}/orders/${o.id}`} className="flex items-center gap-3 px-4 py-2 hover:bg-muted/50">
                        <span className="tabular w-24 font-medium">{o.number}</span>
                        <span className="tabular w-28 text-muted-foreground">{formatDate(o.created_at, tz, locale)}</span>
                        <span className="font-mono text-xs text-muted-foreground">{o.vehicle?.plate}</span>
                        <span className="ml-auto flex items-center gap-2">
                          {fin && <span className="tabular">{money(o.total)}</span>}
                          <StatusBadge status={o.payment_status} label={to(`payment.${o.payment_status}` as "payment.paid")} />
                          <StatusBadge status={o.status} label={to(`status.${o.status}` as "status.draft")} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          <Section title={t("bookings")}>
            {(bookings.data ?? []).length === 0 ? <Empty>{tc("empty")}</Empty> : (
              <ul className="divide-y text-sm">
                {bookings.data!.map((b) => (
                  <li key={b.id}>
                    <Link href={`${base}/calendar?booking=${b.id}`} className="flex items-center gap-3 px-4 py-2 hover:bg-muted/50">
                      <span className="tabular w-40">{formatDateTime(b.starts_at, tz, locale)}</span>
                      <span className="text-muted-foreground">{b.workstation?.name}</span>
                      <span className="ml-auto"><StatusBadge status={b.status} label={tcal(`status.${b.status}` as "status.confirmed")} /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {ctx.modules.includes("tire_hotel") && (
            <Section title={t("tireSets")}>
              {(sets.data ?? []).length === 0 ? <Empty>{tc("empty")}</Empty> : (
                <ul className="divide-y text-sm">
                  {sets.data!.map((s) => (
                    <li key={s.id}>
                      <Link href={`${base}/tire-hotel/${s.id}`} className="flex items-center gap-3 px-4 py-2 hover:bg-muted/50">
                        <span className="tabular w-24 font-medium">{s.code}</span>
                        <span>{th(`seasons.${s.season}` as "seasons.summer")}</span>
                        <span className="text-muted-foreground">{s.manufacturer} {s.diameter && `R${s.diameter}`}</span>
                        <span className="ml-auto font-mono text-xs">{s.location?.code}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {fin && (payments.data ?? []).length > 0 && (
            <Section title={t("payments")}>
              <ul className="divide-y text-sm">
                {payments.data!.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-2">
                    <span className="tabular w-40 text-muted-foreground">{formatDateTime(p.received_at, tz, locale)}</span>
                    <span>{p.method?.name}</span>
                    <span className={`tabular ml-auto ${p.kind === "refund" ? "text-destructive" : ""}`}>{p.kind === "refund" ? "−" : ""}{money(p.amount)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </>
  );
}
