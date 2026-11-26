"use client";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { columnHelper, DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/ui";
import { formatDate, formatMoney, type Currency } from "@/lib/format";
import type { Locale } from "@/i18n/config";

export type OrderRow = {
  id: string; number: string; status: string; payment: string; total: number; paid: number; created: string;
  customer: string; plate: string | null; employee: string | null;
};
const h = columnHelper<OrderRow>();

export function OrdersTable({ rows, base, currency, timezone, locale, showMoney }: { rows: OrderRow[]; base: string; currency: Currency; timezone: string; locale: Locale; showMoney: boolean }) {
  const t = useTranslations("orders");
  const tc = useTranslations("common");
  const tv = useTranslations("vehicles");
  const router = useRouter();
  const columns = useMemo(() => h.columns([
    h.accessor("number", { header: t("number"), sortFn: "alphanumeric", cell: (c) => <span className="tabular font-medium">{c.getValue()}</span> }),
    h.accessor("created", { header: tc("date"), sortFn: "datetime", cell: (c) => <span className="tabular">{formatDate(c.getValue(), timezone, locale)}</span> }),
    h.accessor("customer", { header: t("assigned") && tc("name"), sortFn: "text" }),
    h.accessor("plate", { header: tv("plate"), enableSorting: false, cell: (c) => <span className="font-mono text-xs">{c.getValue() ?? "—"}</span> }),
    h.accessor("employee", { header: t("assigned"), enableSorting: false, cell: (c) => c.getValue() ?? "—" }),
    ...(showMoney ? [h.accessor("total", { header: tc("total"), sortFn: "basic", cell: (c) => <span className="tabular">{formatMoney(c.getValue(), currency, locale)}</span> })] : []),
    h.accessor("payment", { header: t("paid"), enableSorting: false, cell: (c) => <StatusBadge status={c.getValue()} label={t(`payment.${c.getValue()}` as "payment.paid")} /> }),
    h.accessor("status", { header: tc("status"), enableSorting: false, cell: (c) => <StatusBadge status={c.getValue()} label={t(`status.${c.getValue()}` as "status.draft")} /> }),
  ]), [t, tc, tv, currency, timezone, locale, showMoney]);
  return <DataTable columns={columns} data={rows} empty={tc("empty")} onRowClick={(r) => router.push(`${base}/${r.id}`)} />;
}
