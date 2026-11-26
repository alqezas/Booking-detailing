"use client";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Star } from "lucide-react";
import { columnHelper, DataTable } from "@/components/app/data-table";
import { formatDate, formatMoney, type Currency } from "@/lib/format";
import type { Locale } from "@/i18n/config";

export type CustomerRow = {
  id: string; name: string; phone: string | null; email: string | null; plates: string[];
  visits: number; spent: number; lastVisit: string | null; vip: boolean;
};

const h = columnHelper<CustomerRow>();

export function CustomersTable({ rows, base, currency, timezone, locale }: { rows: CustomerRow[]; base: string; currency: Currency; timezone: string; locale: Locale }) {
  const t = useTranslations("customers");
  const tc = useTranslations("common");
  const tv = useTranslations("vehicles");
  const router = useRouter();
  const columns = useMemo(() => h.columns([
    h.accessor("name", {
      header: tc("name"), sortFn: "text",
      cell: (c) => (
        <span className="inline-flex items-center gap-1.5 font-medium">
          {c.row.original.vip && <Star className="size-3.5 fill-warning text-warning" aria-label={t("vip")} />}
          {c.getValue()}
        </span>
      ),
    }),
    h.accessor("phone", { header: tc("phone"), enableSorting: false, cell: (c) => <span className="tabular">{c.getValue() ?? "—"}</span> }),
    h.accessor((r) => r.plates.join(", "), { id: "plates", header: tv("plate"), enableSorting: false, cell: (c) => <span className="font-mono text-xs">{c.getValue() || "—"}</span> }),
    h.accessor("visits", { header: t("visits"), sortFn: "basic", cell: (c) => <span className="tabular">{c.getValue()}</span> }),
    h.accessor("spent", { header: t("spent"), sortFn: "basic", cell: (c) => <span className="tabular">{formatMoney(c.getValue(), currency, locale)}</span> }),
    h.accessor("lastVisit", { header: t("lastVisit"), sortFn: "datetime", cell: (c) => c.getValue() ? formatDate(c.getValue()!, timezone, locale) : "—" }),
  ]), [t, tc, tv, currency, timezone, locale]);
  return <DataTable columns={columns} data={rows} empty={tc("empty")} onRowClick={(r) => router.push(`${base}/${r.id}`)} />;
}
