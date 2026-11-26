"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect, Section } from "@/components/app/ui";
import { createClient } from "@/lib/supabase/client";
import { formatMoney, type Currency } from "@/lib/format";
import type { Locale } from "@/i18n/config";

type Quote = { total: number; duration_min: number; lines: { service_id: string; unit_price: number; quantity: number; line_total: number; duration_min: number }[] };

/** Live preview of the server-side quote engine with the current rules. */
export function PriceCheck({ businessId, services, categories, currency, locale }: {
  businessId: string; services: { id: string; name: string }[]; categories: { id: string; name: string }[]; currency: Currency; locale: Locale;
}) {
  const t = useTranslations("services");
  const tv = useTranslations("vehicles");
  const tc = useTranslations("common");
  const [svc, setSvc] = useState(services[0]?.id ?? "");
  const [cat, setCat] = useState(categories[0]?.id ?? "");
  const [rim, setRim] = useState("16");
  const [wheels, setWheels] = useState("4");
  const [runflat, setRunflat] = useState(false);
  const [tpms, setTpms] = useState(false);
  const params = { vehicle_category_id: cat, rim: Number(rim) || null, wheel_count: Number(wheels) || 4, runflat, tpms };
  const { data } = useQuery({
    queryKey: ["quote", businessId, svc, params],
    enabled: Boolean(svc),
    queryFn: async () => {
      const { data, error } = await createClient().rpc("quote_services", { p_business: businessId, p_services: [svc], p_params: params });
      if (error) throw error;
      return data as unknown as Quote;
    },
  });
  return (
    <Section title={t("preview")}>
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label={t("title")}>
            <NativeSelect value={svc} onChange={(e) => setSvc(e.target.value)}>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </NativeSelect>
          </Field>
        </div>
        <Field label={tv("category")}>
          <NativeSelect value={cat} onChange={(e) => setCat(e.target.value)}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label={tv("rim")}><Input type="number" value={rim} onChange={(e) => setRim(e.target.value)} /></Field>
        <Field label={t("wheels")}><Input type="number" min={1} max={10} value={wheels} onChange={(e) => setWheels(e.target.value)} /></Field>
        <div className="flex items-end gap-4 pb-1 text-sm">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={runflat} onChange={(e) => setRunflat(e.target.checked)} />{tv("runflat")}</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={tpms} onChange={(e) => setTpms(e.target.checked)} />{tv("tpms")}</label>
        </div>
        <div className="flex items-baseline justify-between rounded-md bg-muted/60 px-3 py-2 sm:col-span-2">
          <span className="text-sm text-muted-foreground">{data ? `${data.lines[0]?.quantity ?? 1} × ${formatMoney(data.lines[0]?.unit_price ?? 0, currency, locale)} · ${tc("minutes", { n: data.duration_min })}` : "…"}</span>
          <span className="tabular text-lg font-semibold">{data ? formatMoney(data.total, currency, locale) : "—"}</span>
        </div>
      </div>
    </Section>
  );
}
