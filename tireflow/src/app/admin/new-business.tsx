"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, NativeSelect } from "@/components/app/ui";
import { useActionToast } from "@/components/app/form-bits";
import { localeNames, locales } from "@/i18n/config";
import { createBusiness } from "./actions";

export function NewBusinessDialog() {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const ts = useTranslations("settings");
  const router = useRouter();
  const toastResult = useActionToast();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const { register, handleSubmit, setValue, reset } = useForm({ defaultValues: { name: "", slug: "", owner_email: "", locale: "cs", currency: "CZK", branch: "" } });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}><Plus />{t("new")}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("new")}</DialogTitle></DialogHeader>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit((v) => start(async () => {
          if (toastResult(await createBusiness(v), t("createdInvite"))) { setOpen(false); reset(); router.refresh(); }
        }))}>
          <div className="sm:col-span-2">
            <Field label={tc("name")}>
              <Input {...register("name", {
                required: true,
                onChange: (e) => setValue("slug", e.target.value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50)),
              })} autoFocus />
            </Field>
          </div>
          <Field label={t("slug")} hint="/s/…"><Input {...register("slug", { required: true })} className="font-mono" /></Field>
          <Field label={t("ownerEmail")}><Input type="email" {...register("owner_email", { required: true })} /></Field>
          <Field label={ts("crmLocale")}>
            <NativeSelect {...register("locale")}>{locales.map((l) => <option key={l} value={l}>{localeNames[l]}</option>)}</NativeSelect>
          </Field>
          <Field label={ts("currency")}>
            <NativeSelect {...register("currency")}>{["CZK", "EUR", "PLN", "UAH"].map((c) => <option key={c}>{c}</option>)}</NativeSelect>
          </Field>
          <div className="sm:col-span-2"><Field label={tc("branch")}><Input {...register("branch")} /></Field></div>
          <div className="sm:col-span-2"><Button type="submit" disabled={pending}>{tc("create")}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
