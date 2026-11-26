"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { addDays, formatMoney, formatTime, zonedDay, zonedInstant, type Currency } from "@/lib/format";
import { intlLocale, type Locale } from "@/i18n/config";
import { publicCancel, publicReschedule, publicSlots } from "../../s/[businessSlug]/actions";

export type ManagedBooking = {
  status: string; starts_at: string; ends_at: string; quoted_total: number; currency: Currency; timezone: string; plate: string | null;
  contact_name: string | null; can_change: boolean; service_ids: string[]; vehicle_params: Record<string, unknown>;
  business: { name: string; slug: string; phone: string | null; brand_color: string };
  branch: { id: string; name: string; address: string | null; city: string | null };
  services: { name: string; price: number }[];
};

export function ManageBooking({ token, booking: b, locale }: { token: string; booking: ManagedBooking; locale: Locale }) {
  const t = useTranslations("public");
  const te = useTranslations("errors");
  const tc = useTranslations("common");
  const tcal = useTranslations("calendar");
  const router = useRouter();
  const tz = b.timezone;
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "move">("view");
  const today = zonedDay(new Date(), tz);
  const [day, setDay] = useState(zonedDay(new Date(b.starts_at), tz));
  const [result, setResult] = useState<{ day: string; slots: string[] } | null>(null);
  const slots = result?.day === day ? result.slots : null;

  useEffect(() => {
    if (mode !== "move") return;
    let live = true;
    publicSlots(b.business.slug, b.branch.id, day, b.service_ids, b.vehicle_params).then((s) => { if (live) setResult({ day, slots: s }); });
    return () => { live = false; };
  }, [mode, day, b]);

  const run = (fn: () => ReturnType<typeof publicCancel>) => start(async () => {
    setError(null);
    const res = await fn();
    if (res.ok) { setMode("view"); router.refresh(); }
    else setError(te.has(res.error as "generic") ? te(res.error as "generic") : te("generic"));
  });
  const full = new Intl.DateTimeFormat(intlLocale[locale], { timeZone: tz, dateStyle: "full", timeStyle: "short" });

  return (
    <div className="space-y-4 rounded-lg border bg-background p-5">
      <div>
        <div className="text-xs text-muted-foreground">{t("manage")}</div>
        <div className="text-lg font-semibold">{full.format(new Date(b.starts_at))}</div>
        <div className="text-sm">{tcal(`status.${b.status}` as "status.confirmed")}</div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{tc("branch")}</dt><dd>{b.branch.name}, {b.branch.address} {b.branch.city}</dd>
        {b.plate && <><dt className="text-muted-foreground">{t("plate")}</dt><dd className="font-mono">{b.plate}</dd></>}
        <dt className="text-muted-foreground">{t("services")}</dt><dd>{b.services.map((s) => s.name).join(", ")}</dd>
        <dt className="text-muted-foreground">{t("estimate")}</dt><dd className="tabular">{formatMoney(b.quoted_total, b.currency, locale)}</dd>
      </dl>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {b.can_change ? (
        mode === "view" ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setMode("move")}>{t("reschedule")}</Button>
            <Button variant="destructive" disabled={pending} onClick={() => { if (confirm(`${t("cancel")}?`)) run(() => publicCancel(token)); }}>{t("cancel")}</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {Array.from({ length: 21 }, (_, i) => addDays(today, i)).map((d) => (
                <button key={d} onClick={() => setDay(d)} className={`shrink-0 rounded-md border px-2.5 py-1.5 text-xs ${d === day ? "bg-[var(--primary)] text-white" : ""}`}>
                  {new Intl.DateTimeFormat(intlLocale[locale], { timeZone: tz, weekday: "short", day: "numeric", month: "numeric" }).format(zonedInstant(d, 720, tz))}
                </button>
              ))}
            </div>
            {slots === null ? <p className="text-sm text-muted-foreground">{tc("loading")}</p> : slots.length === 0 ? <p className="text-sm text-muted-foreground">{t("noSlots")}</p> : (
              <div className="grid grid-cols-4 gap-1.5">
                {slots.map((s) => (
                  <button key={s} disabled={pending} onClick={() => run(() => publicReschedule(token, s))} className="tabular rounded-md border py-1.5 text-sm hover:bg-muted">{formatTime(s, tz, locale)}</button>
                ))}
              </div>
            )}
            <Button variant="ghost" onClick={() => setMode("view")}>{tc("back")}</Button>
          </div>
        )
      ) : (
        b.status !== "cancelled" && <p className="text-sm text-muted-foreground">{te("too_late_to_change")} {b.business.phone}</p>
      )}
    </div>
  );
}
