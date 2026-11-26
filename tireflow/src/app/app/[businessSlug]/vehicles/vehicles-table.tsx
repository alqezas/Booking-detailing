"use client";
import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { columnHelper, DataTable } from "@/components/app/data-table";

export type VehicleRow = {
  id: string; plate: string | null; vehicle: string; year: number | null; category: string | null; rim: number | null;
  size: string | null; flags: string[]; customerId: string | null; owner: string | null; phone: string | null;
};
const h = columnHelper<VehicleRow>();

export function VehiclesTable({ rows, base, canBook }: { rows: VehicleRow[]; base: string; canBook: boolean }) {
  const t = useTranslations("vehicles");
  const tc = useTranslations("common");
  const tcal = useTranslations("calendar");
  const router = useRouter();
  const columns = useMemo(() => h.columns([
    h.accessor("plate", { header: t("plate"), sortFn: "alphanumeric", cell: (c) => <span className="rounded border bg-muted/50 px-1.5 font-mono text-xs">{c.getValue() ?? "—"}</span> }),
    h.accessor("vehicle", { header: t("make"), sortFn: "text", cell: (c) => <span className="font-medium">{c.getValue()} <span className="text-muted-foreground">{c.row.original.year}</span></span> }),
    h.accessor("category", { header: t("category"), enableSorting: false }),
    h.accessor((r) => [r.rim && `R${r.rim}`, r.size].filter(Boolean).join(" · "), { id: "size", header: t("tireSize"), enableSorting: false }),
    h.accessor((r) => r.flags.join(", "), { id: "flags", header: "", enableSorting: false, cell: (c) => <span className="text-xs text-muted-foreground">{c.getValue()}</span> }),
    h.accessor("owner", { header: t("owner"), sortFn: "text", cell: (c) => c.getValue() ?? "—" }),
    h.display({
      id: "act", header: "",
      cell: (c) => canBook && c.row.original.customerId ? (
        <Button size="xs" variant="ghost" onClick={(e) => e.stopPropagation()}
          render={<Link href={`${base}/calendar?new=1&customer=${c.row.original.customerId}&vehicle=${c.row.original.id}`} />}>
          <CalendarPlus />{tcal("newBooking")}
        </Button>
      ) : null,
    }),
  ]), [t, tcal, base, canBook]);
  return <DataTable columns={columns} data={rows} empty={tc("empty")} onRowClick={(r) => r.customerId && router.push(`${base}/customers/${r.customerId}`)} />;
}
