"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, NativeSelect } from "@/components/app/ui";
import { FieldError, useActionToast } from "@/components/app/form-bits";
import { vehicleSchema } from "@/lib/schemas";
import { saveVehicle } from "./actions";

type V = {
  id?: string; make?: string; model?: string; year?: number | null; plate?: string | null; vin?: string | null;
  category_id?: string | null; rim_diameter?: number | null; tire_size?: string | null; mileage_km?: number | null;
  has_tpms?: boolean; has_runflat?: boolean; service_notes?: string | null;
};

export function VehicleDialog({ slug, customerId, categories, vehicle, onSaved }: {
  slug: string; customerId: string | null; categories: { id: string; name: string }[]; vehicle?: V; onSaved?: (id: string) => void;
}) {
  const t = useTranslations("vehicles");
  const tc = useTranslations("common");
  const router = useRouter();
  const toastResult = useActionToast();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const { register, handleSubmit, reset, formState: { errors } } = useForm({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(vehicleSchema as any),
    defaultValues: {
      make: vehicle?.make ?? "", model: vehicle?.model ?? "", year: vehicle?.year ?? "", plate: vehicle?.plate ?? "",
      vin: vehicle?.vin ?? "", category_id: vehicle?.category_id ?? categories[0]?.id ?? "", rim_diameter: vehicle?.rim_diameter ?? "",
      tire_size: vehicle?.tire_size ?? "", mileage_km: vehicle?.mileage_km ?? "", has_tpms: vehicle?.has_tpms ?? false,
      has_runflat: vehicle?.has_runflat ?? false, service_notes: vehicle?.service_notes ?? "",
    } as Record<string, unknown>,
  });
  const submit = handleSubmit((values) => start(async () => {
    const res = await saveVehicle(slug, customerId, vehicle?.id ?? null, values);
    if (toastResult(res)) {
      setOpen(false);
      if (!vehicle) reset();
      onSaved?.(res.data!.id);
      router.refresh();
    }
  }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={vehicle ? <Button size="icon-xs" variant="ghost" aria-label={tc("edit")} /> : <Button size="xs" variant="outline" />}>
        {vehicle ? <Pencil /> : <><Plus />{t("new")}</>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>{vehicle ? `${vehicle.make} ${vehicle.model ?? ""}` : t("new")}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <Field label={t("plate")}><Input {...register("plate")} className="font-mono uppercase" autoFocus /><FieldError errors={errors} name="plate" /></Field>
          <Field label={t("category")}>
            <NativeSelect {...register("category_id")}>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label={t("make")}><Input {...register("make")} /><FieldError errors={errors} name="make" /></Field>
          <Field label={t("model")}><Input {...register("model")} /></Field>
          <Field label={t("year")}><Input type="number" {...register("year")} /></Field>
          <Field label={t("rim")}><Input type="number" min={10} max={26} {...register("rim_diameter")} /></Field>
          <Field label={t("tireSize")}><Input {...register("tire_size")} placeholder="205/55 R16" /></Field>
          <Field label={t("mileage")}><Input type="number" {...register("mileage_km")} /></Field>
          <div className="sm:col-span-2"><Field label={t("vin")}><Input {...register("vin")} className="font-mono uppercase" maxLength={17} /><FieldError errors={errors} name="vin" /></Field></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" {...register("has_tpms")} />{t("tpms")}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" {...register("has_runflat")} />{t("runflat")}</label>
          <div className="sm:col-span-2"><Field label={t("serviceNotes")}><Input {...register("service_notes")} /></Field></div>
          <div className="sm:col-span-2"><Button type="submit" disabled={pending}>{tc("save")}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
