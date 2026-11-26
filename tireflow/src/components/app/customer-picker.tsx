"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

type Hit = { id: string; first_name: string; last_name: string; phone: string | null; plates: string[] };

/** Find a customer by name, phone or plate (server-side search, RLS-scoped). */
export function CustomerPicker({ businessId, value, onChange, autoFocus }: {
  businessId: string; value: { id: string; name: string } | null; onChange: (v: { id: string; name: string } | null) => void; autoFocus?: boolean;
}) {
  const t = useTranslations("calendar");
  const [q, setQ] = useState("");
  const { data: hits } = useQuery({
    queryKey: ["cust-search", businessId, q],
    enabled: q.trim().length >= 2 && !value,
    queryFn: async () => ((await createClient().rpc("search_customers", { p_business: businessId, p_query: q, p_limit: 8 })).data ?? []) as Hit[],
  });
  if (value) {
    return (
      <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-1.5 text-sm">
        <span className="font-medium">{value.name || "—"}</span>
        <Button type="button" size="icon-xs" variant="ghost" onClick={() => onChange(null)}><X /></Button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
      <Input className="pl-8" placeholder={t("searchCustomer")} value={q} onChange={(e) => setQ(e.target.value)} autoFocus={autoFocus} />
      {(hits?.length ?? 0) > 0 && (
        <ul className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
          {hits!.map((h) => (
            <li key={h.id}>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => { onChange({ id: h.id, name: `${h.first_name} ${h.last_name}`.trim() }); setQ(""); }}>
                <span className="font-medium">{`${h.first_name} ${h.last_name}`.trim() || "—"}</span>
                <span className="font-mono text-xs text-muted-foreground">{h.plates.join(", ")}</span>
                <span className="ml-auto text-xs text-muted-foreground">{h.phone}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
