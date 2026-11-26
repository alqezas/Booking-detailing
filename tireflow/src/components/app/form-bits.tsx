"use client";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { FieldErrors } from "react-hook-form";
import type { ActionResult } from "@/lib/action";

/** Shows a translated toast for a failed server action. Returns true on success. */
export function useActionToast() {
  const te = useTranslations("errors");
  const tc = useTranslations("common");
  return <T,>(res: ActionResult<T>, okMessage?: string): res is { ok: true; data?: T } => {
    if (res.ok) {
      toast.success(okMessage ?? tc("saved"));
      return true;
    }
    const key = res.error as Parameters<typeof te>[0];
    toast.error(te.has(key) ? te(key) : tc("error"));
    return false;
  };
}

export function FieldError({ errors, name }: { errors: FieldErrors; name: string }) {
  const tc = useTranslations("common");
  if (!errors[name]) return null;
  return <span className="text-xs text-destructive">{tc("required")}</span>;
}
