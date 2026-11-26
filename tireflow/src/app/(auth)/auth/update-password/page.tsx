"use client";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updatePassword } from "@/app/actions/auth";

export default function UpdatePasswordPage() {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState(updatePassword, undefined);
  return (
    <form action={action} className="space-y-4 rounded-xl border bg-card p-6 shadow-xs">
      <h1 className="text-lg font-semibold">{t("newPassword")}</h1>
      <div className="space-y-2">
        <Label htmlFor="password">{t("newPassword")}</Label>
        <Input id="password" name="password" type="password" minLength={10} autoComplete="new-password" required />
        <p className="text-xs text-muted-foreground">{t("minLength")}</p>
      </div>
      {state?.error && <p role="alert" className="text-sm text-destructive">{t("minLength")}</p>}
      <Button type="submit" className="w-full" disabled={pending}>{t("setPassword")}</Button>
    </form>
  );
}
