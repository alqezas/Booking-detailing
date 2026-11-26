"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/** GET search box: keeps other filters, resets the page. */
export function SearchBar({ defaultValue, placeholder, name = "q" }: { defaultValue?: string; placeholder?: string; name?: string }) {
  const t = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  return (
    <form
      className="relative w-full max-w-xs"
      onSubmit={(e) => {
        e.preventDefault();
        const v = String(new FormData(e.currentTarget).get(name) ?? "").trim();
        const next = new URLSearchParams(sp);
        if (v) next.set(name, v); else next.delete(name);
        next.delete("page");
        router.push(`${pathname}?${next}`);
      }}
    >
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input name={name} defaultValue={defaultValue} placeholder={placeholder ?? t("searchPlaceholder")} className="pl-8" />
    </form>
  );
}

export function Pager({ page, total, pageSize }: { page: number; total: number; pageSize: number }) {
  const t = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const go = (p: number) => {
    const next = new URLSearchParams(sp);
    next.set("page", String(p));
    router.push(`${pathname}?${next}`);
  };
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
      <span>{t("rows", { count: total })}</span>
      <div className="flex items-center gap-2">
        <span>{t("page", { page, pages })}</span>
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => go(page - 1)}>{t("previous")}</Button>
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => go(page + 1)}>{t("next")}</Button>
      </div>
    </div>
  );
}
