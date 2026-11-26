"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { ArrowLeftRight, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, NativeSelect } from "@/components/app/ui";
import { useActionToast } from "@/components/app/form-bits";
import { moveStock, saveProduct } from "./actions";

const CATS = ["new_tires", "used_tires", "rims", "valves", "tpms_sensors", "balance_weights", "repair_materials", "bolts", "nuts", "consumables", "other"] as const;
type P = { id: string; sku: string; barcode: string; name: string; category: string; manufacturer: string; purchase_price: string; retail_price: string; min_stock: string; location_note: string };

export function ProductDialog({ slug, currency, product }: { slug: string; currency: string; product?: P }) {
  const t = useTranslations("inventory");
  const tc = useTranslations("common");
  const router = useRouter();
  const toastResult = useActionToast();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const { register, handleSubmit } = useForm({ defaultValues: product ?? { sku: "", barcode: "", name: "", category: "consumables", manufacturer: "", purchase_price: "0", retail_price: "0", min_stock: "0", location_note: "" } });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={product ? <Button size="icon-xs" variant="ghost" aria-label={tc("edit")} /> : <Button size="sm" />}>{product ? <Pencil /> : <><Plus />{t("newProduct")}</>}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{product?.name ?? t("newProduct")}</DialogTitle></DialogHeader>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit((v) => start(async () => { if (toastResult(await saveProduct(slug, product?.id ?? null, v))) { setOpen(false); router.refresh(); } }))}>
          <Field label={t("sku")}><Input {...register("sku", { required: true })} className="font-mono" /></Field>
          <Field label={t("barcode")}><Input {...register("barcode")} className="font-mono" /></Field>
          <div className="sm:col-span-2"><Field label={tc("name")}><Input {...register("name", { required: true })} /></Field></div>
          <Field label={t("category")}><NativeSelect {...register("category")}>{CATS.map((c) => <option key={c} value={c}>{t(`categories.${c}`)}</option>)}</NativeSelect></Field>
          <Field label="Brand"><Input {...register("manufacturer")} /></Field>
          <Field label={`${t("purchase")}, ${currency}`}><Input inputMode="decimal" {...register("purchase_price")} /></Field>
          <Field label={`${t("retail")}, ${currency}`}><Input inputMode="decimal" {...register("retail_price")} /></Field>
          <Field label={t("minStock")}><Input inputMode="decimal" {...register("min_stock")} /></Field>
          <Field label="Location"><Input {...register("location_note")} /></Field>
          <div className="sm:col-span-2"><Button type="submit" disabled={pending}>{tc("save")}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MovementDialog({ slug, products, warehouses, currency }: { slug: string; products: { id: string; name: string }[]; warehouses: { id: string; name: string }[]; currency: string }) {
  const t = useTranslations("inventory");
  const tc = useTranslations("common");
  const router = useRouter();
  const toastResult = useActionToast();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [v, setV] = useState({ product_id: products[0]?.id ?? "", warehouse_id: warehouses[0]?.id ?? "", kind: "receipt", quantity: "", unit_cost: "", note: "", to_warehouse_id: warehouses[1]?.id ?? "" });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}><ArrowLeftRight />{t("movement")}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("movement")}</DialogTitle></DialogHeader>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); start(async () => { if (toastResult(await moveStock(slug, v))) { setOpen(false); setV({ ...v, quantity: "", note: "" }); router.refresh(); } }); }}>
          <div className="sm:col-span-2"><Field label={tc("name")}><NativeSelect value={v.product_id} onChange={(e) => setV({ ...v, product_id: e.target.value })}>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field></div>
          <Field label={t("movement")}>
            <NativeSelect value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>
              {(["receipt", "issue", "write_off", "return", "adjustment"] as const).map((k) => <option key={k} value={k}>{t(`kinds.${k}`)}</option>)}
              {warehouses.length > 1 && <option value="transfer">{t("kinds.transfer_out")} → {t("kinds.transfer_in")}</option>}
            </NativeSelect>
          </Field>
          <Field label="Warehouse"><NativeSelect value={v.warehouse_id} onChange={(e) => setV({ ...v, warehouse_id: e.target.value })}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</NativeSelect></Field>
          {v.kind === "transfer" && <Field label="→"><NativeSelect value={v.to_warehouse_id} onChange={(e) => setV({ ...v, to_warehouse_id: e.target.value })}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</NativeSelect></Field>}
          <Field label={tc("quantity")} hint={v.kind === "adjustment" ? "±" : undefined}><Input inputMode="decimal" value={v.quantity} onChange={(e) => setV({ ...v, quantity: e.target.value })} required /></Field>
          {v.kind === "receipt" && <Field label={`${t("unitCost")}, ${currency}`}><Input inputMode="decimal" value={v.unit_cost} onChange={(e) => setV({ ...v, unit_cost: e.target.value })} /></Field>}
          <div className="sm:col-span-2"><Field label={tc("notes")}><Input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field></div>
          <div className="sm:col-span-2"><Button type="submit" disabled={pending}>{tc("save")}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
