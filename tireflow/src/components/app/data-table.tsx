"use client";
import { useMemo } from "react";
import {
  createColumnHelper, createSortedRowModel, rowSortingFeature, sortFn_alphanumeric, sortFn_basic, sortFn_datetime,
  sortFn_text, tableFeatures, useTable, type ColumnDef, type RowData,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const tableFeaturesSorted = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic, datetime: sortFn_datetime, text: sortFn_text },
});
type F = typeof tableFeaturesSorted;

export function columnHelper<T extends RowData>() {
  return createColumnHelper<F, T>();
}

/** Compact, sortable table. Data is already filtered/paged on the server. */
export function DataTable<T extends RowData>({ columns, data, empty, onRowClick, rowHref }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- columns carry mixed value types
  columns: ColumnDef<F, T, any>[];
  data: T[];
  empty?: React.ReactNode;
  onRowClick?: (row: T) => void;
  rowHref?: (row: T) => string;
}) {
  const stable = useMemo(() => data, [data]);
  const table = useTable({ features: tableFeaturesSorted, columns, data: stable });
  const rows = table.getRowModel().rows;
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((g) => (
            <TableRow key={g.id}>
              {g.headers.map((h) => {
                const sorted = h.column.getIsSorted();
                const canSort = h.column.getCanSort();
                return (
                  <TableHead key={h.id} className="h-9 whitespace-nowrap text-xs">
                    {h.isPlaceholder ? null : canSort ? (
                      <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={h.column.getToggleSortingHandler()}>
                        <table.FlexRender header={h} />
                        {sorted === "asc" && <ArrowUp className="size-3" />}
                        {sorted === "desc" && <ArrowDown className="size-3" />}
                      </button>
                    ) : (
                      <table.FlexRender header={h} />
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center text-sm text-muted-foreground">{empty}</TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow
                key={row.id}
                className={cn((onRowClick || rowHref) && "cursor-pointer")}
                onClick={() => {
                  if (onRowClick) onRowClick(row.original);
                  else if (rowHref) window.location.assign(rowHref(row.original));
                }}
              >
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id} className="py-2 text-sm">
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
