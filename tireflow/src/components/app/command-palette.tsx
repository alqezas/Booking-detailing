"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Car, Plus, User } from "lucide-react";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { createClient } from "@/lib/supabase/client";
import type { NavKey } from "@/lib/nav";
import { navIcons } from "./nav-icons";

type Hit = { id: string; first_name: string; last_name: string; phone: string | null; plates: string[] };

export function CommandPalette({ open, onOpenChange, nav, business }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  nav: { key: NavKey; href: string }[];
  business: { id: string; slug: string };
}) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const td = useTranslations("dashboard");
  const router = useRouter();
  const [q, setQ] = useState("");
  const enabled = q.trim().length >= 2;
  const { data } = useQuery({
    queryKey: ["palette", business.id, q],
    enabled,
    queryFn: async () => ((await createClient().rpc("search_customers", { p_business: business.id, p_query: q, p_limit: 8 })).data ?? []) as Hit[],
  });
  const hits = enabled ? data ?? [] : [];

  const go = (href: string) => {
    onOpenChange(false);
    setQ("");
    router.push(href);
  };
  const base = `/app/${business.slug}`;
  const has = (k: NavKey) => nav.some((n) => n.key === k);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder={tc("searchPlaceholder")} value={q} onValueChange={setQ} />
      <CommandList>
        <CommandEmpty>{tc("noResults")}</CommandEmpty>
        {hits.length > 0 && (
          <CommandGroup heading={t("customers")}>
            {hits.map((h) => (
              <CommandItem key={h.id} value={`c-${h.id}-${q}`} onSelect={() => go(`${base}/customers/${h.id}`)}>
                <User className="size-4" />
                <span>{`${h.first_name} ${h.last_name}`.trim() || "—"}</span>
                <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                  {h.plates.slice(0, 2).map((p) => (
                    <span key={p} className="inline-flex items-center gap-1"><Car className="size-3" />{p}</span>
                  ))}
                  {h.phone}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading={td("quick")}>
          {has("calendar") && <CommandItem onSelect={() => go(`${base}/calendar?new=1`)}><Plus className="size-4" />{td("newBooking")}</CommandItem>}
          {has("customers") && <CommandItem onSelect={() => go(`${base}/customers/new`)}><Plus className="size-4" />{td("newCustomer")}</CommandItem>}
          {has("orders") && <CommandItem onSelect={() => go(`${base}/orders/new`)}><Plus className="size-4" />{td("newOrder")}</CommandItem>}
          {has("tireHotel") && <CommandItem onSelect={() => go(`${base}/tire-hotel/check-in`)}><Plus className="size-4" />{td("checkIn")}</CommandItem>}
        </CommandGroup>
        <CommandGroup heading="TireFlow">
          {nav.map((n) => {
            const Icon = navIcons[n.key];
            return (
              <CommandItem key={n.key} onSelect={() => go(n.href)}>
                <Icon className="size-4" />{t(n.key)}
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
