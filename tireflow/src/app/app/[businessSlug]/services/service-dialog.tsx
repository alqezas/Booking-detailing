"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, NativeSelect } from "@/components/app/ui";
import { useActionToast } from "@/components/app/form-bits";
import { minorToInput, type Currency } from "@/lib/format";
import { saveService } from "./actions";

type Service = {
  id: string; name: string; description: string | null; category_id: string | null; unit: string; base_price: number;
  base_duration_min: number; online_bookable: boolean; is_active: boolean; required_equipment: string[];
};

export function ServiceDialog({ slug, categories, currency, service }: {
  slug: string; categories: { id: string; name: string }[]; currency: Currency; service?: Service;
}) {
  const t = useTranslations("services");
  const tc = useTranslations("common");
  const router = useRouter();
  const toastResult = useActionToast();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const { register, handleSubmit } = useForm({
    defaultValues: {
      name: service?.name ?? "", description: service?.description ?? "", category_id: service?.category_id ?? categories[0]?.id ?? "",
      unit: service?.unit ?? "job", base_price: service ? minorToInput(service.base_price) : "", base_duration_min: service?.base_duration_min ?? 30,
      online_bookable: service?.online_bookable ?? true, is_active: service?.is_active ?? true,
      required_equipment: service?.required_equipment.join(", ") ?? "",
    },
  });
  const submit = handleSubmit((v) => start(async () => {
    const res = await saveService(slug, service?.id ?? null, v);
    if (toastResult(res)) { setOpen(false); router.refresh(); }
  }));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={service ? <Button size="icon-xs" variant="ghost" aria-label={tc("edit")} /> : <Button size="sm" />}>
        {service ? <Pencil /> : <><Plus />{t("new")}</>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{service?.name ?? t("new")}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label={tc("name")}><Input {...register("name", { required: true })} autoFocus /></Field></div>
          <Field label={t("category")}>
            <NativeSelect {...register("category_id")}>
              <option value="">—</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label={t("unit")}>
            <NativeSelect {...register("unit")}>
              {(["job", "wheel", "piece", "hour"] as const).map((u) => <option key={u} value={u}>{t(`units.${u}`)}</option>)}
            </NativeSelect>
          </Field>
          <Field label={`${t("basePrice")}, ${currency}`}><Input inputMode="decimal" {...register("base_price", { required: true })} /></Field>
          <Field label={t("duration")}><Input type="number" min={0} max={600} {...register("base_duration_min")} /></Field>
          <div className="sm:col-span-2"><Field label={t("equipment")} hint="lift, balancer, changer"><Input {...register("required_equipment")} /></Field></div>
          <div className="sm:col-span-2"><Field label={tc("description")}><Textarea rows={2} {...register("description")} /></Field></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" {...register("online_bookable")} />{t("online")}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" {...register("is_active")} />{t("active")}</label>
          <div className="sm:col-span-2"><Button type="submit" disabled={pending}>{tc("save")}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
