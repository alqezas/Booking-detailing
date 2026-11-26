"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Search, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, NativeSelect } from "@/components/app/ui";
import { useActionToast } from "@/components/app/form-bits";
import { createClient } from "@/lib/supabase/client";
import { formatMoney, formatTime, zonedDay, zonedInstant, zonedMinutes, type Currency } from "@/lib/format";
import type { Locale } from "@/i18n/config";
import { createBooking, customerVehicles } from "./actions";
import { saveCustomer } from "../customers/actions";

type Hit = { id: string; first_name: string; last_name: string; phone: string | null; plates: string[] };
type Vehicle = Awaited<ReturnType<typeof customerVehicles>>[number];
type Quote = { total: number; duration_min: number };

/** Designed for speed: existing customer → services → time → Enter. */
export function BookingDialog(props: {
  open: boolean; onOpenChange: (o: boolean) => void; slug: string; businessId: string; branchId: string; timezone: string;
  locale: Locale; currency: Currency; day: string; posts: { id: string; name: string }[]; employees: { id: string; name: string }[];
  services: { id: string; name: string; unit: string; base_duration_min: number }[]; categories: { id: string; name: string }[];
  presetStart?: string; presetPost?: string; walkIn?: boolean; presetCustomer?: string; presetVehicle?: string;
  onCreated: (id: string) => void;
}) {
  const t = useTranslations("calendar");
  const tc = useTranslations("common");
  const tv = useTranslations("vehicles");
  const tcu = useTranslations("customers");
  const toastResult = useActionToast();
  const tz = props.timezone;
  const [idem] = useState(() => crypto.randomUUID());
  const [pending, start] = useTransition();

  const initial = props.walkIn ? new Date() : props.presetStart ? new Date(props.presetStart) : null;
  const [date, setDate] = useState(initial ? zonedDay(initial, tz) : props.day);
  const [time, setTime] = useState(() => {
    if (!initial) return "09:00";
    const m = Math.ceil(zonedMinutes(initial, tz) / 5) * 5;
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  });
  const [postId, setPostId] = useState(props.presetPost ?? "");
  const [employeeId, setEmployeeId] = useState("");
  const [q, setQ] = useState("");
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [newCustomer, setNewCustomer] = useState<{ first_name: string; last_name: string; phone: string } | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleId, setVehicleId] = useState("");
  const [plate, setPlate] = useState("");
  const [params, setParams] = useState({ vehicle_category_id: props.categories[0]?.id ?? "", rim: 16, wheel_count: 4, tpms: false, runflat: false });
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [slots, setSlots] = useState<{ starts_at: string; workstation_id: string }[] | null>(null);

  // preset customer (from customer card / vehicles list)
  useEffect(() => {
    if (!props.presetCustomer) return;
    (async () => {
      const { data } = await createClient().from("customers").select("id, first_name, last_name").eq("id", props.presetCustomer!).single();
      if (data) pickCustomer({ id: data.id, name: `${data.first_name} ${data.last_name}`.trim() }, props.presetVehicle);
    })();
  }, [props.presetCustomer]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: hits } = useQuery({
    queryKey: ["cust-search", props.businessId, q],
    enabled: q.trim().length >= 2 && !customer,
    queryFn: async () => ((await createClient().rpc("search_customers", { p_business: props.businessId, p_query: q, p_limit: 6 })).data ?? []) as Hit[],
  });

  const { data: quote } = useQuery({
    queryKey: ["quote", props.businessId, selected, params],
    enabled: selected.length > 0,
    queryFn: async () => (await createClient().rpc("quote_services", { p_business: props.businessId, p_services: selected, p_params: params })).data as unknown as Quote,
  });

  async function pickCustomer(c: { id: string; name: string }, vehicle?: string) {
    setCustomer(c);
    setQ("");
    const list = await customerVehicles(props.slug, c.id);
    setVehicles(list);
    const v = list.find((x) => x.id === vehicle) ?? list[0];
    if (v) pickVehicle(v);
  }
  function pickVehicle(v: Vehicle) {
    setVehicleId(v.id);
    setPlate(v.plate ?? "");
    setParams((p) => ({ ...p, vehicle_category_id: v.category_id ?? p.vehicle_category_id, rim: v.rim_diameter ?? p.rim, tpms: v.has_tpms, runflat: v.has_runflat }));
  }

  const startsAt = useMemo(() => {
    const [h, m] = time.split(":").map(Number);
    return zonedInstant(date, h * 60 + m, tz).toISOString();
  }, [date, time, tz]);

  const findSlots = async () => {
    const { data } = await createClient().rpc("find_slots", { p_business: props.businessId, p_branch: props.branchId, p_day: date, p_services: selected, p_params: params });
    setSlots((data ?? []).slice(0, 40));
  };

  const submit = () => start(async () => {
    let customerId = customer?.id ?? null;
    if (!customerId && newCustomer && (newCustomer.first_name || newCustomer.phone)) {
      const res = await saveCustomer(props.slug, null, { ...newCustomer, email: "", preferred_channel: "sms", locale: props.locale });
      if (!toastResult(res, tc("created"))) return;
      customerId = res.data!.id;
    }
    const res = await createBooking(props.slug, {
      branch_id: props.branchId, customer_id: customerId, vehicle_id: vehicleId || null, workstation_id: postId || null,
      employee_id: employeeId || null, starts_at: startsAt, service_ids: selected, vehicle_params: params,
      source: props.walkIn ? "walk_in" : "staff", internal_note: note || undefined, plate: plate || undefined,
      contact_name: !customerId ? undefined : undefined, idempotency_key: idem,
    });
    if (toastResult(res, tc("created"))) props.onCreated(res.data!.id);
  });

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{props.walkIn ? t("walkIn") : t("newBooking")}</DialogTitle></DialogHeader>
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (selected.length) submit(); }}>
          {/* customer */}
          <div className="grid gap-2">
            <span className="text-sm font-medium">{t("customer")}</span>
            {customer ? (
              <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-1.5 text-sm">
                <span className="font-medium">{customer.name || "—"}</span>
                <Button type="button" size="icon-xs" variant="ghost" onClick={() => { setCustomer(null); setVehicles([]); setVehicleId(""); }}><X /></Button>
              </div>
            ) : newCustomer ? (
              <div className="grid gap-2 sm:grid-cols-3">
                <Input placeholder={tcu("firstName")} value={newCustomer.first_name} onChange={(e) => setNewCustomer({ ...newCustomer, first_name: e.target.value })} autoFocus />
                <Input placeholder={tcu("lastName")} value={newCustomer.last_name} onChange={(e) => setNewCustomer({ ...newCustomer, last_name: e.target.value })} />
                <Input placeholder={tc("phone")} type="tel" value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} />
              </div>
            ) : (
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
                <Input className="pl-8" placeholder={t("searchCustomer")} value={q} onChange={(e) => setQ(e.target.value)} autoFocus={!props.presetCustomer} />
                {(hits?.length ?? 0) > 0 && (
                  <ul className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
                    {hits!.map((h) => (
                      <li key={h.id}>
                        <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
                          onClick={() => pickCustomer({ id: h.id, name: `${h.first_name} ${h.last_name}`.trim() })}>
                          <span className="font-medium">{`${h.first_name} ${h.last_name}`.trim() || "—"}</span>
                          <span className="font-mono text-xs text-muted-foreground">{h.plates.join(", ")}</span>
                          <span className="ml-auto text-xs text-muted-foreground">{h.phone}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {!customer && !newCustomer && (
              <button type="button" className="justify-self-start text-xs text-primary hover:underline" onClick={() => setNewCustomer({ first_name: "", last_name: "", phone: "" })}>
                + {t("newCustomerInline")}
              </button>
            )}
          </div>

          {/* vehicle */}
          <div className="grid gap-3 sm:grid-cols-5">
            <div className="sm:col-span-2">
              <Field label={t("vehicle")}>
                {vehicles.length > 0 ? (
                  <NativeSelect value={vehicleId} onChange={(e) => { const v = vehicles.find((x) => x.id === e.target.value); if (v) pickVehicle(v); else setVehicleId(""); }}>
                    {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate} · {v.make} {v.model}</option>)}
                    <option value="">—</option>
                  </NativeSelect>
                ) : (
                  <Input placeholder={tv("plate")} value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} className="font-mono" />
                )}
              </Field>
            </div>
            <Field label={tv("category")}>
              <NativeSelect value={params.vehicle_category_id} onChange={(e) => setParams({ ...params, vehicle_category_id: e.target.value })}>
                {props.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label={tv("rim")}><Input type="number" min={10} max={26} value={params.rim} onChange={(e) => setParams({ ...params, rim: Number(e.target.value) })} /></Field>
            <div className="flex items-end gap-3 pb-1.5 text-sm">
              <label className="flex items-center gap-1"><input type="checkbox" checked={params.tpms} onChange={(e) => setParams({ ...params, tpms: e.target.checked })} />TPMS</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={params.runflat} onChange={(e) => setParams({ ...params, runflat: e.target.checked })} />RF</label>
            </div>
          </div>

          {/* services */}
          <div className="grid gap-2">
            <span className="text-sm font-medium">{t("services")}</span>
            <div className="flex flex-wrap gap-1.5">
              {props.services.map((s) => {
                const on = selected.includes(s.id);
                return (
                  <button type="button" key={s.id} aria-pressed={on}
                    onClick={() => setSelected(on ? selected.filter((x) => x !== s.id) : [...selected, s.id])}
                    className={`rounded-md border px-2.5 py-1 text-sm transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                    {s.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* time & resources */}
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label={tc("date")}><Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setSlots(null); }} /></Field>
            <Field label={t("start")}><Input type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} /></Field>
            <Field label={t("post")}>
              <NativeSelect value={postId} onChange={(e) => setPostId(e.target.value)}>
                <option value="">{t("anyPost")}</option>
                {props.posts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label={t("employee")}>
              <NativeSelect value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="">{t("noEmployee")}</option>
                {props.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </NativeSelect>
            </Field>
          </div>
          {selected.length > 0 && !props.walkIn && (
            <div className="grid gap-2">
              <Button type="button" size="xs" variant="outline" className="justify-self-start" onClick={findSlots}><Sparkles />{tc("search")}: {formatDateLabel(date)}</Button>
              {slots && (slots.length === 0 ? <p className="text-xs text-muted-foreground">—</p> : (
                <div className="flex flex-wrap gap-1">
                  {dedupe(slots).map((s) => (
                    <button type="button" key={s.starts_at + s.workstation_id}
                      onClick={() => { const m = zonedMinutes(new Date(s.starts_at), tz); setTime(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`); setPostId(s.workstation_id); }}
                      className="tabular rounded border px-1.5 py-0.5 text-xs hover:bg-muted">
                      {formatTime(s.starts_at, tz, props.locale)}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
          <Field label={t("internalNote")}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>

          <div className="flex items-center justify-between gap-3 border-t pt-3">
            <div className="text-sm">
              {quote ? (
                <>
                  <span className="text-muted-foreground">{t("estimate")}: </span>
                  <span className="tabular font-semibold">{formatMoney(quote.total, props.currency, props.locale)}</span>
                  <span className="text-muted-foreground"> · {tc("minutes", { n: quote.duration_min })}</span>
                </>
              ) : <span className="text-muted-foreground">{tc("required")}: {t("services")}</span>}
            </div>
            <Button type="submit" disabled={pending || selected.length === 0}>{tc("create")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function dedupe(slots: { starts_at: string; workstation_id: string }[]) {
  const seen = new Set<string>();
  return slots.filter((s) => (seen.has(s.starts_at) ? false : (seen.add(s.starts_at), true)));
}
function formatDateLabel(d: string) {
  return d.split("-").reverse().join(".");
}
