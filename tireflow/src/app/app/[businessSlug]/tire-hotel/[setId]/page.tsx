import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import QRCode from "qrcode";
import { can, requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatMoney, minorToInput, addDays } from "@/lib/format";
import { DL, PageHeader, Section, StatusBadge } from "@/components/app/ui";
import { SetActions } from "./set-actions";

export default async function TireSetPage({ params }: PageProps<"/app/[businessSlug]/tire-hotel/[setId]">) {
  const { businessSlug, setId } = await params;
  const ctx = await requirePermission(businessSlug, "tire_hotel.view", "tire_hotel");
  const supabase = await createClient();
  const { data: s } = await supabase.from("tire_sets")
    .select("*, customer:customers(id, first_name, last_name, phone), vehicle:vehicles(plate, make, model), location:storage_locations(id, code, warehouse_id)")
    .eq("id", setId).eq("business_id", ctx.id).maybeSingle();
  if (!s) notFound();
  const [items, contracts, moves, free, methods] = await Promise.all([
    supabase.from("tire_set_items").select("*").eq("tire_set_id", s.id),
    supabase.from("tire_storage_contracts").select("*").eq("tire_set_id", s.id).order("created_at", { ascending: false }),
    supabase.from("tire_storage_movements").select("kind, created_at, from:storage_locations!tire_storage_movements_business_id_from_location_id_fkey(code), to:storage_locations!tire_storage_movements_business_id_to_location_id_fkey(code)").eq("tire_set_id", s.id).order("created_at"),
    s.location ? supabase.from("storage_locations").select("id, code, capacity_sets, occupied_sets").eq("warehouse_id", s.location.warehouse_id).eq("is_active", true).order("code").limit(400) : Promise.resolve({ data: [] }),
    supabase.from("payment_methods").select("id, name").eq("business_id", ctx.id).eq("is_active", true),
  ]);
  const [t, tc, to, locale] = await Promise.all([getTranslations("hotel"), getTranslations("common"), getTranslations("orders"), getLocale()]);
  const tz = ctx.settings.timezone;
  const money = (v: number) => formatMoney(v, ctx.settings.currency, locale);
  const active = (contracts.data ?? []).find((c) => c.status === "active");
  // QR encodes only the set code: no personal data on the label
  const qr = await QRCode.toDataURL(`TF:${s.code}`, { margin: 1, width: 240 });
  const order = ["FL", "FR", "RL", "RR", "SPARE", "X1", "X2"];

  return (
    <>
      <PageHeader
        title={`${s.code}`}
        description={<span className="inline-flex items-center gap-2"><StatusBadge status={s.status} label={s.status === "stored" ? t("occupied") : t("released")} />{s.location?.code && <span className="font-mono">{s.location.code}</span>}</span>}
        actions={can(ctx, "tire_hotel.manage") && s.status === "stored" && (
          <SetActions
            slug={ctx.slug} setId={s.id} currency={ctx.settings.currency} canPay={can(ctx, "finance.manage")} methods={methods.data ?? []}
            contract={active ? { id: active.id, due: active.price - active.paid_total, endsOn: active.ends_on } : null}
            freeCells={(free.data ?? []).filter((c) => c.occupied_sets < c.capacity_sets).map((c) => ({ id: c.id, code: c.code ?? "" }))}
            nextEnd={active ? addDays(active.ends_on, 183) : ""} defaultPrice={minorToInput(ctx.settings.storage_price_per_season)}
          />
        )}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Section title={t("label")}>
            <div id="label" className="flex items-center gap-4 p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt={s.code} className="size-28 rounded bg-white p-1" />
              <div className="text-sm">
                <div className="text-2xl font-bold tracking-wide">{s.location?.code ?? "—"}</div>
                <div className="tabular font-medium">{s.code}</div>
                <div className="font-mono">{s.vehicle?.plate}</div>
                <div className="text-muted-foreground">{s.quantity}× {t(`seasons.${s.season as "summer"}`)} {s.width && `${s.width}/${s.profile} R${s.diameter}`}</div>
              </div>
            </div>
            <div className="border-t px-4 py-2"><Link className="text-sm text-primary hover:underline" href={`/app/${ctx.slug}/tire-hotel/${s.id}/label`} target="_blank">{t("label")} →</Link></div>
          </Section>
          <Section title={tc("details")}>
            <DL items={[
              [tc("name"), s.customer ? <Link className="hover:underline" href={`/app/${ctx.slug}/customers/${s.customer.id}`}>{s.customer.first_name} {s.customer.last_name}</Link> : null],
              [tc("phone"), s.customer?.phone],
              ["Vehicle", s.vehicle ? `${s.vehicle.plate} · ${s.vehicle.make} ${s.vehicle.model}` : null],
              [t("manufacturer"), [s.manufacturer, s.model].filter(Boolean).join(" ")],
              [t("loadIndex"), [s.load_index, s.speed_index].filter(Boolean).join(" ")],
              [t("withRims"), s.with_rims ? `${tc("yes")} ${s.rim_type ?? ""}` : tc("no")],
              [t("condition"), t(`conditions.${s.condition as "good"}`)],
              [t("storedSince"), formatDate(s.created_at, tz, locale)],
              [tc("notes"), s.notes],
            ]} />
          </Section>
        </div>
        <div className="space-y-4 lg:col-span-2">
          <Section title={t("tires")}>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground"><tr className="border-b text-left">
                <th className="px-4 py-2 font-medium" /><th className="px-2 py-2 font-medium">{t("dot")}</th><th className="px-2 py-2 font-medium">{t("tread")}</th><th className="px-2 py-2 font-medium">{t("damage")}</th>
              </tr></thead>
              <tbody className="divide-y">
                {(items.data ?? []).sort((a, b) => order.indexOf(a.position) - order.indexOf(b.position)).map((i) => (
                  <tr key={i.id}>
                    <td className="px-4 py-2">{t(`positions.${i.position as "FL"}`)}</td>
                    <td className="tabular px-2 py-2">{i.dot ?? "—"}</td>
                    <td className={`tabular px-2 py-2 ${i.tread_mm !== null && Number(i.tread_mm) < (s.season === "winter" ? 4 : 3) ? "font-medium text-destructive" : ""}`}>{i.tread_mm ?? "—"}</td>
                    <td className="px-2 py-2">{i.damage ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
          <Section title={t("contract")}>
            <ul className="divide-y text-sm">
              {(contracts.data ?? []).map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-4 px-4 py-2">
                  <span className="tabular font-medium">{c.number}</span>
                  <span className="tabular">{formatDate(c.starts_on, tz, locale)} – {formatDate(c.ends_on, tz, locale)}</span>
                  <span className="text-muted-foreground">{c.status}</span>
                  <span className="tabular ml-auto">{money(c.paid_total)} / {money(c.price)}</span>
                  <StatusBadge status={c.paid_total >= c.price ? "paid" : c.paid_total > 0 ? "partial" : "unpaid"} label={to(`payment.${c.paid_total >= c.price ? "paid" : c.paid_total > 0 ? "partial" : "unpaid"}`)} />
                </li>
              ))}
            </ul>
          </Section>
          <Section title="History">
            <ul className="divide-y text-sm">
              {(moves.data ?? []).map((m, i) => (
                <li key={i} className="flex items-center gap-3 px-4 py-2">
                  <span className="tabular w-40 text-muted-foreground">{formatDateTime(m.created_at, tz, locale)}</span>
                  <span>{m.kind}</span>
                  <span className="font-mono text-xs">{m.from?.code} {m.from && m.to ? "→" : ""} {m.to?.code}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </>
  );
}
