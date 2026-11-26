"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, NativeSelect } from "@/components/app/ui";
import { addDays, formatMoney, formatTime, zonedDay, zonedInstant, type Currency } from "@/lib/format";
import { intlLocale, type Locale } from "@/i18n/config";
import { publicBook, publicQuote, publicSlots } from "./actions";

export type PublicBusiness = {
  id: string; slug: string; name: string; logo_path: string | null; brand_color: string; phone: string | null; email: string | null;
  currency: Currency; locale: string; timezone: string; horizon_days: number;
  branches: { id: string; name: string; address: string | null; city: string | null; phone: string | null; opening_hours: Record<string, [string, string][]> }[];
  categories: { id: string; code: string; name: string }[];
  services: { id: string; name: string; description: string | null; unit: string; base_price: number; duration_min: number; category: string | null }[];
};

export function BookingWizard({ slug, business: b, locale }: { slug: string; business: PublicBusiness; locale: Locale }) {
  const t = useTranslations("public");
  const te = useTranslations("errors");
  const tc = useTranslations("common");
  const tcu = useTranslations("customers");
  const tz = b.timezone;
  const [pending, start] = useTransition();
  const [branch, setBranch] = useState(b.branches[0]?.id ?? "");
  const [category, setCategory] = useState(b.categories[0]?.id ?? "");
  const [rim, setRim] = useState(16);
  const [tpms, setTpms] = useState(false);
  const [runflat, setRunflat] = useState(false);
  const [services, setServices] = useState<string[]>([]);
  const [quoteRes, setQuoteRes] = useState<{ key: string; value: { total: number; duration_min: number } | null } | null>(null);
  const today = zonedDay(new Date(), tz);
  const [day, setDay] = useState(today);
  const [slotsRes, setSlotsRes] = useState<{ key: string; value: string[] } | null>(null);
  const [picked, setSlot] = useState<string | null>(null);
  const [contact, setContact] = useState({ first_name: "", last_name: "", phone: "", email: "", plate: "", note: "", consent_marketing: false, website: "" });
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const params = useMemo(() => ({ vehicle_category_id: category || undefined, rim, tpms, runflat, wheel_count: 4 }), [category, rim, tpms, runflat]);

  // results are tagged with the inputs they were computed for, so stale ones are ignored
  const quoteKey = JSON.stringify([services, params]);
  const slotsKey = JSON.stringify([branch, day, services, params]);
  const quote = services.length && quoteRes?.key === quoteKey ? quoteRes.value : null;
  const slots = slotsRes?.key === slotsKey ? slotsRes.value : null;
  const slot = picked && slots?.includes(picked) ? picked : null;

  useEffect(() => {
    if (!services.length) return;
    let live = true;
    publicQuote(slug, services, params).then((q) => { if (live) setQuoteRes({ key: quoteKey, value: q }); });
    return () => { live = false; };
  }, [slug, services, params, quoteKey]);

  useEffect(() => {
    if (!services.length || !branch) return;
    let live = true;
    publicSlots(slug, branch, day, services, params).then((s) => { if (live) setSlotsRes({ key: slotsKey, value: s }); });
    return () => { live = false; };
  }, [slug, branch, day, services, params, slotsKey]);

  const days = Array.from({ length: Math.min(21, b.horizon_days) }, (_, i) => addDays(today, i));
  const dayLabel = (d: string) => new Intl.DateTimeFormat(intlLocale[locale], { timeZone: tz, weekday: "short", day: "numeric", month: "numeric" }).format(zonedInstant(d, 720, tz));

  if (token) {
    const link = `${window.location.origin}/booking/${token}`;
    return (
      <div className="rounded-lg border bg-background p-6 text-center">
        <CheckCircle2 className="mx-auto size-10 text-[var(--primary)]" />
        <h3 className="mt-2 text-lg font-semibold">{t("done")}</h3>
        <p className="mt-1 text-sm">{slot && `${new Intl.DateTimeFormat(intlLocale[locale], { timeZone: tz, dateStyle: "full", timeStyle: "short" }).format(new Date(slot))}`}</p>
        <p className="mt-4 text-sm text-muted-foreground">{t("doneText")}</p>
        <div className="mx-auto mt-2 flex max-w-md items-center gap-2">
          <Input readOnly value={link} className="font-mono text-xs" />
          <Button size="icon" variant="outline" aria-label="copy" onClick={() => navigator.clipboard.writeText(link)}><Copy /></Button>
        </div>
        <Button className="mt-4" render={<a href={link} />}>{t("manage")}</Button>
      </div>
    );
  }

  const step = (n: number, title: string, children: React.ReactNode) => (
    <section className="rounded-lg border bg-background p-4">
      <h3 className="mb-3 text-sm font-medium"><span className="mr-2 inline-flex size-5 items-center justify-center rounded-full bg-[var(--primary)] text-xs text-white">{n}</span>{title}</h3>
      {children}
    </section>
  );

  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      if (!slot) return;
      setError(null);
      start(async () => {
        const res = await publicBook(slug, { branch_id: branch, service_ids: services, vehicle_params: params, starts_at: slot, locale, ...contact });
        if (res.ok) setToken(res.data!.token);
        else setError(te.has(res.error as "generic") ? te(res.error as "generic") : te("generic"));
      });
    }}>
      {b.branches.length > 1 && step(1, t("branch"), (
        <div className="grid gap-2 sm:grid-cols-2">
          {b.branches.map((br) => (
            <label key={br.id} className={`cursor-pointer rounded-md border p-3 text-sm ${branch === br.id ? "border-[var(--primary)] ring-1 ring-[var(--primary)]" : ""}`}>
              <input type="radio" name="branch" className="sr-only" checked={branch === br.id} onChange={() => setBranch(br.id)} />
              <div className="font-medium">{br.name}</div>
              <div className="text-xs text-muted-foreground">{br.address}, {br.city}</div>
            </label>
          ))}
        </div>
      ))}
      {step(b.branches.length > 1 ? 2 : 1, t("vehicle"), (
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <Field label={t("category")}>
              <NativeSelect value={category} onChange={(e) => setCategory(e.target.value)}>
                {b.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </NativeSelect>
            </Field>
          </div>
          <Field label={t("rim")}>
            <NativeSelect value={rim} onChange={(e) => setRim(Number(e.target.value))}>
              {Array.from({ length: 13 }, (_, i) => 13 + i).map((r) => <option key={r} value={r}>R{r}</option>)}
            </NativeSelect>
          </Field>
          <div className="flex flex-col justify-end gap-1 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={tpms} onChange={(e) => setTpms(e.target.checked)} />{t("tpms")}</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={runflat} onChange={(e) => setRunflat(e.target.checked)} />{t("runflat")}</label>
          </div>
        </div>
      ))}
      {step(b.branches.length > 1 ? 3 : 2, t("services"), (
        <>
          <ul className="divide-y rounded-md border">
            {b.services.map((s) => {
              const on = services.includes(s.id);
              return (
                <li key={s.id}>
                  <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 text-sm hover:bg-muted/50">
                    <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={on}
                      onChange={() => setServices(on ? services.filter((x) => x !== s.id) : [...services, s.id])} />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{s.name}</span>
                      {s.description && <span className="block text-xs text-muted-foreground">{s.description}</span>}
                    </span>
                    <span className="tabular whitespace-nowrap text-muted-foreground">{formatMoney(s.base_price, b.currency, locale)}{s.unit === "wheel" ? " / 1" : ""}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          {quote && (
            <div className="mt-3 flex items-baseline justify-between rounded-md bg-muted/60 px-3 py-2">
              <span className="text-sm">{t("estimate")} · {tc("minutes", { n: quote.duration_min })}</span>
              <span className="tabular text-lg font-semibold">{formatMoney(quote.total, b.currency, locale)}</span>
            </div>
          )}
          {quote && <p className="mt-1 text-xs text-muted-foreground">{t("estimateNote")}</p>}
        </>
      ))}
      {services.length > 0 && step(b.branches.length > 1 ? 4 : 3, t("slot"), (
        <>
          <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
            {days.map((d) => (
              <button type="button" key={d} onClick={() => setDay(d)}
                className={`shrink-0 rounded-md border px-2.5 py-1.5 text-xs ${day === d ? "border-[var(--primary)] bg-[var(--primary)] text-white" : "hover:bg-muted"}`}>{dayLabel(d)}</button>
            ))}
          </div>
          {slots === null ? <p className="text-sm text-muted-foreground">{tc("loading")}</p>
            : slots.length === 0 ? <p className="text-sm text-muted-foreground">{t("noSlots")}</p>
            : (
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
                {slots.map((s) => (
                  <button type="button" key={s} onClick={() => setSlot(s)}
                    className={`tabular rounded-md border py-1.5 text-sm ${slot === s ? "border-[var(--primary)] bg-[var(--primary)] text-white" : "hover:bg-muted"}`}>
                    {formatTime(s, tz, locale)}
                  </button>
                ))}
              </div>
            )}
        </>
      ))}
      {slot && step(b.branches.length > 1 ? 5 : 4, t("contact"), (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tcu("firstName")}><Input required value={contact.first_name} onChange={(e) => setContact({ ...contact, first_name: e.target.value })} autoComplete="given-name" /></Field>
          <Field label={tcu("lastName")}><Input value={contact.last_name} onChange={(e) => setContact({ ...contact, last_name: e.target.value })} autoComplete="family-name" /></Field>
          <Field label={tc("phone")}><Input required type="tel" inputMode="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} autoComplete="tel" /></Field>
          <Field label={`${tc("email")} (${tc("optional")})`}><Input type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} autoComplete="email" /></Field>
          <Field label={t("plate")}><Input value={contact.plate} onChange={(e) => setContact({ ...contact, plate: e.target.value.toUpperCase() })} className="font-mono" /></Field>
          <div className="sm:col-span-2"><Field label={t("note")}><Textarea rows={2} value={contact.note} onChange={(e) => setContact({ ...contact, note: e.target.value })} /></Field></div>
          <input tabIndex={-1} aria-hidden className="hidden" value={contact.website} onChange={(e) => setContact({ ...contact, website: e.target.value })} name="website" autoComplete="off" />
          <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" className="mt-0.5" checked={contact.consent_marketing} onChange={(e) => setContact({ ...contact, consent_marketing: e.target.checked })} />{t("marketing")}</label>
          <p className="text-xs text-muted-foreground sm:col-span-2">{t("gdpr")}</p>
          {error && <p role="alert" className="text-sm text-destructive sm:col-span-2">{error}</p>}
          <Button type="submit" size="lg" disabled={pending} className="sm:col-span-2">{t("confirm")}</Button>
        </div>
      ))}
    </form>
  );
}
