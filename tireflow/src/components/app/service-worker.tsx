"use client";
import { useEffect } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

/** Registers the service worker in production and warns when the connection drops. */
export function ServiceWorker() {
  const t = useTranslations("common");
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    }
    const off = () => toast.warning(t("offline"), { id: "offline", duration: Infinity });
    const on = () => toast.dismiss("offline");
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    return () => {
      window.removeEventListener("offline", off);
      window.removeEventListener("online", on);
    };
  }, [t]);
  return null;
}
