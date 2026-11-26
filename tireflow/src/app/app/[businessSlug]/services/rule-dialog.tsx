"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, NativeSelect } from "@/components/app/ui";
import { useActionToast } from "@/components/app/form-bits";
import { deleteRule, saveRule } from "./actions";

/** Visual "when … then …" editor: owners change prices without code. */
export function RuleDialog({ slug, kind, services, categories, currency }: {
  slug: string; kind: "price" | "duration"; services: { id: string; name: string }[]; categories: { id: string; name: string }[]; currency: string;
}) {
  const t = useTranslations("services");
  const tc = useTranslations("common");
  const tv = useTranslations("vehicles");
  const router = useRouter();
  const toastResult = useActionToast();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const { register, handleSubmit, watch, reset } = useForm({
    defaultValues: {
      kind, name: "", service_id: "", priority: 100, vehicle_category_id: "", rim_min: "", rim_max: "",
      runflat: "any", tpms: "any", rim_type: "", adjustment: "add", amount: "",
    },
  });
  const adj = watch("adjustment");
  const submit = handleSubmit((v) => start(async () => {
    const res = await saveRule(slug, v);
    if (toastResult(res)) { setOpen(false); reset(); router.refresh(); }
  }));
  const tri = (name: "runflat" | "tpms", label: string) => (
    <Field label={label}>
      <NativeSelect {...register(name)}>
        <option value="any">{tc("all")}</option><option value="yes">{tc("yes")}</option><option value="no">{tc("no")}</option>
      </NativeSelect>
    </Field>
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="xs" variant="outline" />}><Plus />{t("newRule")}</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>{kind === "price" ? t("rules") : t("durationRules")}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <Field label={tc("name")}><Input {...register("name", { required: true })} placeholder="R19+ surcharge" autoFocus /></Field>
          <fieldset className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3">
            <legend className="px-1 text-xs font-medium text-muted-foreground">{t("conditions")}</legend>
            <div className="sm:col-span-2">
              <Field label={t("title")}>
                <NativeSelect {...register("service_id")}>
                  <option value="">{t("anyService")}</option>
                  {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </NativeSelect>
              </Field>
            </div>
            <Field label={tv("category")}>
              <NativeSelect {...register("vehicle_category_id")}>
                <option value="">{t("anyCategory")}</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label={`${tv("rim")} ≥`}><Input type="number" min={10} max={26} {...register("rim_min")} /></Field>
            <Field label={`${tv("rim")} ≤`}><Input type="number" min={10} max={26} {...register("rim_max")} /></Field>
            <Field label={t("rimType")}>
              <NativeSelect {...register("rim_type")}>
                <option value="">{tc("all")}</option><option value="steel">{t("steel")}</option><option value="alloy">{t("alloy")}</option>
              </NativeSelect>
            </Field>
            {tri("runflat", tv("runflat"))}
            {tri("tpms", tv("tpms"))}
          </fieldset>
          <fieldset className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3">
            <legend className="px-1 text-xs font-medium text-muted-foreground">{t("adjustment")}</legend>
            <Field label={t("adjustment")}>
              <NativeSelect {...register("adjustment")}>
                {(["add", "set", "percent"] as const).map((a) => <option key={a} value={a}>{t(`adjust.${a}`)}</option>)}
              </NativeSelect>
            </Field>
            <Field label={adj === "percent" ? "%" : kind === "price" ? currency : tc("minutes", { n: "" }).trim()}>
              <Input inputMode="decimal" {...register("amount", { required: true })} placeholder={adj === "percent" ? "20" : kind === "price" ? "150" : "10"} />
            </Field>
            <Field label={t("priority")}><Input type="number" {...register("priority")} /></Field>
          </fieldset>
          <Button type="submit" disabled={pending}>{tc("save")}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteRuleButton({ slug, kind, id }: { slug: string; kind: "price" | "duration"; id: string }) {
  const tc = useTranslations("common");
  const router = useRouter();
  const toastResult = useActionToast();
  const [pending, start] = useTransition();
  return (
    <Button size="icon-xs" variant="ghost" aria-label={tc("delete")} disabled={pending}
      onClick={() => start(async () => { if (toastResult(await deleteRule(slug, kind, id))) router.refresh(); })}>
      <Trash2 />
    </Button>
  );
}
