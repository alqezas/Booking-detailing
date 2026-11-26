"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Grid3x3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, NativeSelect } from "@/components/app/ui";
import { useActionToast } from "@/components/app/form-bits";
import { createGrid } from "./actions";

/** Generates Zone → Rack → Shelf → Cell positions (A-01-01-01 …). */
export function GridDialog({ slug, warehouses }: { slug: string; warehouses: { id: string; name: string }[] }) {
  const t = useTranslations("hotel");
  const tc = useTranslations("common");
  const router = useRouter();
  const toastResult = useActionToast();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [v, setV] = useState({ warehouse: warehouses[0]?.id ?? "", zone: "C", racks: 4, shelves: 4, cells: 4, capacity: 1 });
  if (!warehouses.length) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}><Grid3x3 />{t("location")}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("location")}: Zone → Rack → Shelf → Cell</DialogTitle></DialogHeader>
        <form className="grid grid-cols-2 gap-3" onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await createGrid(slug, v.warehouse, v.zone.toUpperCase(), v.racks, v.shelves, v.cells, v.capacity);
            if (toastResult(res, `${tc("created")}: ${res.ok ? res.data?.created : 0}`)) { setOpen(false); router.refresh(); }
          });
        }}>
          <div className="col-span-2">
            <Field label={t("warehouse")}>
              <NativeSelect value={v.warehouse} onChange={(e) => setV({ ...v, warehouse: e.target.value })}>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </NativeSelect>
            </Field>
          </div>
          <Field label="Zone"><Input value={v.zone} maxLength={4} onChange={(e) => setV({ ...v, zone: e.target.value })} /></Field>
          <Field label="Racks"><Input type="number" min={1} max={99} value={v.racks} onChange={(e) => setV({ ...v, racks: Number(e.target.value) })} /></Field>
          <Field label="Shelves"><Input type="number" min={1} max={20} value={v.shelves} onChange={(e) => setV({ ...v, shelves: Number(e.target.value) })} /></Field>
          <Field label="Cells"><Input type="number" min={1} max={50} value={v.cells} onChange={(e) => setV({ ...v, cells: Number(e.target.value) })} /></Field>
          <Field label={t("capacity")}><Input type="number" min={1} max={20} value={v.capacity} onChange={(e) => setV({ ...v, capacity: Number(e.target.value) })} /></Field>
          <div className="col-span-2"><Button type="submit" disabled={pending}>{tc("create")}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
