"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect, Section } from "@/components/app/ui";
import { CustomerPicker } from "@/components/app/customer-picker";
import { useActionToast } from "@/components/app/form-bits";
import type { Currency } from "@/lib/format";
import { checkIn } from "../actions";
import { customerVehicles } from "../../calendar/actions";

type Vehicle = Awaited<ReturnType<typeof customerVehicles>>[number];
const POSITIONS = ["FL", "FR", "RL", "RR"] as const;

export function CheckInForm(props: {
  slug: string; businessId: string; warehouses: { id: string; name: string }[]; methods: { id: string; name: string }[];
  currency: Currency; canPay: boolean; defaultPrice: string; defaultEnd: string; presetCustomer: { id: string; name: string } | null;
}) {
  const t = useTranslations("hotel");
  const tc = useTranslations("common");
  const tcal = useTranslations("calendar");
  const router = useRouter();
  const toastResult = useActionToast();
  const [pending, start] = useTransition();
  const [key] = useState(() => crypto.randomUUID());
  const [customer, setCustomer] = useState(props.presetCustomer);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [f, setF] = useState({
    vehicle_id: "", warehouse_id: props.warehouses[0]?.id ?? "", quantity: "4", manufacturer: "", model: "", season: "winter",
    width: "", profile: "", diameter: "", load_index: "", speed_index: "", with_rims: false, rim_type: "", condition: "good", notes: "",
    ends_on: props.defaultEnd, price: props.defaultPrice, pay_now: props.canPay, method_id: props.methods[0]?.id ?? "",
  });
  const [items, setItems] = useState(POSITIONS.map((p) => ({ position: p, dot: "", tread_mm: "", damage: "" })));
  const set = (k: keyof typeof f, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));

  const loadVehicles = (id: string) => customerVehicles(props.slug, id).then((v) => {
    setVehicles(v);
    if (v[0]) setF((s) => ({ ...s, vehicle_id: v[0].id, diameter: v[0].rim_diameter ? String(v[0].rim_diameter) : s.diameter }));
  });
  const chooseCustomer = (c: { id: string; name: string } | null) => {
    setCustomer(c);
    setVehicles([]);
    if (c) loadVehicles(c.id);
  };
  useEffect(() => {
    if (props.presetCustomer) loadVehicles(props.presetCustomer.id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => start(async () => {
    if (!customer) return;
    const res = await checkIn(props.slug, { ...f, customer_id: customer.id, items, idempotency_key: key });
    if (toastResult(res, res.ok ? t("checkedIn", { location: res.data!.location }) : undefined)) {
      router.push(`/app/${props.slug}/tire-hotel/${res.data!.id}?label=1`);
    }
  });

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <Section title={`1 · ${tcal("customer")}`}>
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <CustomerPicker businessId={props.businessId} value={customer} onChange={chooseCustomer} autoFocus />
          {vehicles.length > 0 && (
            <NativeSelect value={f.vehicle_id} onChange={(e) => set("vehicle_id", e.target.value)} aria-label={tcal("vehicle")}>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate} · {v.make} {v.model}</option>)}
              <option value="">—</option>
            </NativeSelect>
          )}
        </div>
      </Section>

      <Section title={`2 · ${t("size")}`}>
        <div className="grid gap-3 p-4 sm:grid-cols-4">
          <Field label={t("season")}>
            <NativeSelect value={f.season} onChange={(e) => set("season", e.target.value)}>
              {(["winter", "summer", "all_season"] as const).map((s) => <option key={s} value={s}>{t(`seasons.${s}`)}</option>)}
            </NativeSelect>
          </Field>
          <Field label={t("quantity")}><Input type="number" min={1} max={10} value={f.quantity} onChange={(e) => set("quantity", e.target.value)} /></Field>
          <Field label={t("manufacturer")}><Input value={f.manufacturer} onChange={(e) => set("manufacturer", e.target.value)} /></Field>
          <Field label="Model"><Input value={f.model} onChange={(e) => set("model", e.target.value)} /></Field>
          <Field label={t("width")}><Input type="number" value={f.width} onChange={(e) => set("width", e.target.value)} placeholder="205" /></Field>
          <Field label={t("profile")}><Input type="number" value={f.profile} onChange={(e) => set("profile", e.target.value)} placeholder="55" /></Field>
          <Field label={t("diameter")}><Input type="number" value={f.diameter} onChange={(e) => set("diameter", e.target.value)} placeholder="16" /></Field>
          <Field label={`${t("loadIndex")} / ${t("speedIndex")}`}>
            <div className="flex gap-1">
              <Input value={f.load_index} onChange={(e) => set("load_index", e.target.value)} placeholder="91" />
              <Input value={f.speed_index} onChange={(e) => set("speed_index", e.target.value.toUpperCase())} placeholder="V" maxLength={3} />
            </div>
          </Field>
          <Field label={t("condition")}>
            <NativeSelect value={f.condition} onChange={(e) => set("condition", e.target.value)}>
              {(["new", "good", "fair", "worn", "unsafe"] as const).map((c) => <option key={c} value={c}>{t(`conditions.${c}`)}</option>)}
            </NativeSelect>
          </Field>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={f.with_rims} onChange={(e) => set("with_rims", e.target.checked)} />{t("withRims")}</label>
          {f.with_rims && (
            <Field label="Rims">
              <NativeSelect value={f.rim_type} onChange={(e) => set("rim_type", e.target.value)}>
                <option value="">—</option><option value="steel">Steel</option><option value="alloy">Alloy</option>
              </NativeSelect>
            </Field>
          )}
        </div>
      </Section>

      <Section title={`3 · ${t("tires")}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground"><tr className="border-b text-left">
              <th className="px-4 py-2 font-medium" /><th className="px-2 py-2 font-medium">{t("dot")}</th><th className="px-2 py-2 font-medium">{t("tread")}</th><th className="px-2 py-2 font-medium">{t("damage")}</th>
            </tr></thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={it.position} className="border-b last:border-0">
                  <td className="whitespace-nowrap px-4 py-1.5">{t(`positions.${it.position}`)}</td>
                  <td className="px-2 py-1.5"><Input value={it.dot} maxLength={4} inputMode="numeric" placeholder="1223" className="w-20"
                    onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, dot: e.target.value } : x)))} /></td>
                  <td className="px-2 py-1.5"><Input value={it.tread_mm} inputMode="decimal" placeholder="6.5" className="w-20"
                    onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, tread_mm: e.target.value.replace(",", ".") } : x)))} /></td>
                  <td className="px-2 py-1.5"><Input value={it.damage}
                    onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, damage: e.target.value } : x)))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={`4 · ${t("location")} & ${t("contract")}`}>
        <div className="grid gap-3 p-4 sm:grid-cols-4">
          <Field label={t("warehouse")}>
            <NativeSelect value={f.warehouse_id} onChange={(e) => set("warehouse_id", e.target.value)}>
              {props.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label={t("until")}><Input type="date" value={f.ends_on} onChange={(e) => set("ends_on", e.target.value)} /></Field>
          <Field label={`${t("price")}, ${props.currency}`}><Input inputMode="decimal" value={f.price} onChange={(e) => set("price", e.target.value)} /></Field>
          {props.canPay && (
            <Field label={tc("method")}>
              <NativeSelect value={f.method_id} onChange={(e) => set("method_id", e.target.value)} disabled={!f.pay_now}>
                {props.methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </NativeSelect>
            </Field>
          )}
          {props.canPay && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.pay_now} onChange={(e) => set("pay_now", e.target.checked)} />{t("payNow")}</label>}
          <div className="sm:col-span-4"><Field label={tc("notes")}><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field></div>
        </div>
      </Section>
      <Button type="submit" disabled={pending || !customer}>{t("checkIn")}</Button>
    </form>
  );
}
