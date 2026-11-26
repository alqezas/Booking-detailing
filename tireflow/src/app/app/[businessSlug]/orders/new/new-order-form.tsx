"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field, NativeSelect } from "@/components/app/ui";
import { CustomerPicker } from "@/components/app/customer-picker";
import { useActionToast } from "@/components/app/form-bits";
import { createWorkOrder } from "../actions";
import { customerVehicles } from "../../calendar/actions";

type Vehicle = Awaited<ReturnType<typeof customerVehicles>>[number];

export function NewOrderForm(props: {
  slug: string; businessId: string; branches: { id: string; name: string }[]; services: { id: string; name: string }[];
  employees: { id: string; name: string }[]; posts: { id: string; name: string; branch_id: string }[]; presetCustomer: { id: string; name: string } | null;
}) {
  const t = useTranslations("orders");
  const tc = useTranslations("common");
  const tcal = useTranslations("calendar");
  const router = useRouter();
  const toastResult = useActionToast();
  const [pending, start] = useTransition();
  const [key] = useState(() => crypto.randomUUID());
  const [customer, setCustomer] = useState(props.presetCustomer);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleId, setVehicleId] = useState("");
  const [branch, setBranch] = useState(props.branches[0]?.id ?? "");
  const [post, setPost] = useState("");
  const [employee, setEmployee] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [startNow, setStartNow] = useState(true);

  const loadVehicles = (id: string) => customerVehicles(props.slug, id).then((v) => { setVehicles(v); setVehicleId(v[0]?.id ?? ""); });
  const chooseCustomer = (c: { id: string; name: string } | null) => {
    setCustomer(c);
    setVehicles([]);
    setVehicleId("");
    if (c) loadVehicles(c.id);
  };
  useEffect(() => {
    if (props.presetCustomer) loadVehicles(props.presetCustomer.id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const v = vehicles.find((x) => x.id === vehicleId);
  const submit = () => start(async () => {
    const res = await createWorkOrder(props.slug, {
      branch_id: branch, customer_id: customer?.id ?? null, vehicle_id: vehicleId || null, employee_id: employee || null,
      workstation_id: post || null, service_ids: selected, status: startNow ? "in_progress" : "scheduled", idempotency_key: key,
      vehicle_params: v ? { vehicle_category_id: v.category_id, rim: v.rim_diameter, tpms: v.has_tpms, runflat: v.has_runflat, wheel_count: 4 } : { wheel_count: 4 },
    });
    if (toastResult(res, tc("created"))) router.push(`/app/${props.slug}/orders/${res.data!.id}`);
  });

  return (
    <form className="grid gap-4 rounded-lg border bg-card p-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <Field label={tcal("customer")}><CustomerPicker businessId={props.businessId} value={customer} onChange={chooseCustomer} autoFocus /></Field>
      {vehicles.length > 0 && (
        <Field label={tcal("vehicle")}>
          <NativeSelect value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            {vehicles.map((x) => <option key={x.id} value={x.id}>{x.plate} · {x.make} {x.model} {x.rim_diameter ? `R${x.rim_diameter}` : ""}</option>)}
          </NativeSelect>
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={tc("branch")}>
          <NativeSelect value={branch} onChange={(e) => { setBranch(e.target.value); setPost(""); }}>
            {props.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label={tcal("post")}>
          <NativeSelect value={post} onChange={(e) => setPost(e.target.value)}>
            <option value="">—</option>
            {props.posts.filter((p) => p.branch_id === branch).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label={t("assigned")}>
          <NativeSelect value={employee} onChange={(e) => setEmployee(e.target.value)}>
            <option value="">—</option>
            {props.employees.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </NativeSelect>
        </Field>
      </div>
      <div className="grid gap-2">
        <span className="text-sm font-medium">{tcal("services")}</span>
        <div className="flex flex-wrap gap-1.5">
          {props.services.map((s) => {
            const on = selected.includes(s.id);
            return (
              <button type="button" key={s.id} aria-pressed={on} onClick={() => setSelected(on ? selected.filter((x) => x !== s.id) : [...selected, s.id])}
                className={`rounded-md border px-2.5 py-1 text-sm ${on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{s.name}</button>
            );
          })}
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} />{t("start")}</label>
      <Button type="submit" disabled={pending} className="justify-self-start">{tc("create")}</Button>
    </form>
  );
}
