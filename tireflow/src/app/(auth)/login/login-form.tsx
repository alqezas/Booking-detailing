"use client";
import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sendPasswordReset, signIn } from "@/app/actions/auth";

export function LoginForm({ next }: { next?: string }) {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const [mode, setMode] = useState<"signin" | "reset">("signin");
  const [state, action, pending] = useActionState(signIn, undefined);
  const [resetState, resetAction, resetPending] = useActionState(sendPasswordReset, undefined);

  if (mode === "reset") {
    return (
      <form action={resetAction} className="space-y-4 rounded-xl border bg-card p-6 shadow-xs">
        <div className="space-y-2">
          <Label htmlFor="email">{tc("email")}</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
        </div>
        {resetState?.ok && <p className="text-sm text-muted-foreground">{t("resetSent")}</p>}
        <Button type="submit" className="w-full" disabled={resetPending}>{t("sendReset")}</Button>
        <Button type="button" variant="link" className="w-full" onClick={() => setMode("signin")}>{t("backToSignIn")}</Button>
      </form>
    );
  }

  return (
    <form action={action} className="space-y-4 rounded-xl border bg-card p-6 shadow-xs">
      <input type="hidden" name="next" value={next ?? ""} />
      <div className="space-y-2">
        <Label htmlFor="email">{tc("email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">{t("password")}</Label>
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setMode("reset")}>
            {t("forgot")}
          </button>
        </div>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {state?.error && <p role="alert" className="text-sm text-destructive">{t("invalid")}</p>}
      <Button type="submit" className="w-full" disabled={pending}>{t("signIn")}</Button>
    </form>
  );
}
