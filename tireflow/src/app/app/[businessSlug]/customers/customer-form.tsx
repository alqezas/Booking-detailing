"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, NativeSelect } from "@/components/app/ui";
import { FieldError, useActionToast } from "@/components/app/form-bits";
import { customerSchema } from "@/lib/schemas";
import { localeNames, locales } from "@/i18n/config";
import { saveCustomer } from "./actions";

export type CustomerFormValues = {
  first_name: string; last_name: string; phone: string; email: string; preferred_channel: string; locale: string;
  discount_pct: string; notes: string; is_vip: boolean; corporate_customer_id: string; consent_marketing: boolean;
};

const CHANNELS = ["sms", "email", "whatsapp", "telegram", "phone", "none"] as const;

export function CustomerForm({ slug, id, defaults, corporates, onSaved }: {
  slug: string;
  id?: string;
  defaults?: Partial<CustomerFormValues>;
  corporates?: { id: string; name: string }[];
  onSaved?: (id: string) => void;
}) {
  const t = useTranslations("customers");
  const tc = useTranslations("common");
  const router = useRouter();
  const toastResult = useActionToast();
  const [pending, start] = useTransition();
  const { register, handleSubmit, formState: { errors } } = useForm<CustomerFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(customerSchema as any),
    defaultValues: { preferred_channel: "sms", locale: "cs", is_vip: false, consent_marketing: false, ...defaults },
  });

  const submit = handleSubmit((values) => start(async () => {
    const res = await saveCustomer(slug, id ?? null, values);
    if (toastResult(res, id ? tc("saved") : tc("created"))) {
      if (onSaved) onSaved(res.data!.id);
      else router.push(`/app/${slug}/customers/${res.data!.id}`);
      router.refresh();
    }
  }));

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <Field label={t("firstName")}><Input {...register("first_name")} autoFocus /><FieldError errors={errors} name="first_name" /></Field>
      <Field label={t("lastName")}><Input {...register("last_name")} /></Field>
      <Field label={tc("phone")}><Input type="tel" inputMode="tel" {...register("phone")} placeholder="+420 …" /><FieldError errors={errors} name="phone" /></Field>
      <Field label={tc("email")}><Input type="email" {...register("email")} /><FieldError errors={errors} name="email" /></Field>
      <Field label={t("channel")}>
        <NativeSelect {...register("preferred_channel")}>
          {CHANNELS.map((c) => <option key={c} value={c}>{t(`channels.${c}`)}</option>)}
        </NativeSelect>
      </Field>
      <Field label={t("locale")}>
        <NativeSelect {...register("locale")}>
          {locales.map((l) => <option key={l} value={l}>{localeNames[l]}</option>)}
        </NativeSelect>
      </Field>
      <Field label={t("discount")}><Input type="number" min={0} max={100} step="0.5" {...register("discount_pct")} /></Field>
      {corporates && corporates.length > 0 && (
        <Field label="Fleet">
          <NativeSelect {...register("corporate_customer_id")}>
            <option value="">—</option>
            {corporates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </NativeSelect>
        </Field>
      )}
      <div className="sm:col-span-2"><Field label={tc("notes")}><Textarea rows={3} {...register("notes")} /></Field></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register("is_vip")} className="size-4" />{t("vip")}</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register("consent_marketing")} className="size-4" />{t("marketing")}</label>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={pending}>{tc("save")}</Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>{tc("cancel")}</Button>
      </div>
    </form>
  );
}
