"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, Plus, Trash2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Field, NativeSelect, Section } from "@/components/app/ui";
import { useActionToast } from "@/components/app/form-bits";
import { formatDateTime, formatMoney, minorToInput, type Currency } from "@/lib/format";
import type { Locale } from "@/i18n/config";
import { addItem, decideItem, recordPayment, refundPayment, removeItem, setOrderStatus, updateOrderNotes } from "../actions";

type Item = { id: string; kind: string; name: string; quantity: number; unitPrice: number; discountBp: number; taxBp: number; total: number; approval: string; additional: boolean };
type Payment = { id: string; kind: string; amount: number; at: string; method: string; refundOf: string | null; note: string | null };

export function OrderWorkspace(props: {
  slug: string;
  order: { id: string; status: string; subtotal: number; discount: number; tax: number; total: number; paid: number; damage: string; note: string; mileage: string; employeeId: string; includesTax: boolean };
  items: Item[]; payments: Payment[];
  services: { id: string; name: string }[]; products: { id: string; name: string; sku: string }[];
  warehouses: { id: string; name: string }[]; methods: { id: string; name: string }[]; employees: { id: string; name: string }[];
  currency: Currency; timezone: string; locale: Locale;
  can: { manage: boolean; work: boolean; pay: boolean; fin: boolean; custom: boolean };
  totalLabel: string;
}) {
  const t = useTranslations("orders");
  const tc = useTranslations("common");
  const router = useRouter();
  const toastResult = useActionToast();
  const [pending, start] = useTransition();
  const o = props.order;
  const closed = ["completed", "cancelled"].includes(o.status);
  const money = (v: number) => formatMoney(v, props.currency, props.locale);
  const run = (fn: () => Promise<Parameters<typeof toastResult>[0]>) => start(async () => { if (toastResult(await fn())) router.refresh(); });
  const due = o.total - o.paid;
  const pendingApproval = props.items.some((i) => i.approval === "pending");

  return (
    <div className="space-y-4">
      {!closed && (props.can.manage || props.can.work) && (
        <div className="flex flex-wrap gap-2">
          {["draft", "scheduled"].includes(o.status) && <Button size="sm" disabled={pending} onClick={() => run(() => setOrderStatus(props.slug, o.id, "in_progress"))}>{t("start")}</Button>}
          {["in_progress"].includes(o.status) && <Button size="sm" disabled={pending} onClick={() => run(() => setOrderStatus(props.slug, o.id, "ready"))}>{t("ready")}</Button>}
          {props.can.manage && ["in_progress", "ready", "scheduled"].includes(o.status) && (
            <Button size="sm" variant={o.status === "ready" ? "default" : "outline"} disabled={pending || pendingApproval} onClick={() => run(() => setOrderStatus(props.slug, o.id, "completed"))}>{t("complete")}</Button>
          )}
          {props.can.manage && (
            <AlertDialog>
              <AlertDialogTrigger render={<Button size="sm" variant="destructive" disabled={pending} />}>{t("cancelOrder")}</AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader><AlertDialogTitle>{t("cancelOrder")}?</AlertDialogTitle></AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{tc("back")}</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => run(() => setOrderStatus(props.slug, o.id, "cancelled"))}>{tc("confirm")}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      )}
      {pendingApproval && <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2 text-sm">{t("awaitingApproval")}</div>}

      <Section title={t("items")} actions={!closed && props.can.manage && (
        <div className="flex gap-1.5">
          <AddItemDialog kind="service" {...props} />
          {props.products.length > 0 && <AddItemDialog kind="product" {...props} />}
          {props.can.custom && <AddItemDialog kind="custom" {...props} />}
        </div>
      )}>
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b text-left">
              <th className="px-4 py-2 font-medium">{tc("name")}</th>
              <th className="px-2 py-2 text-right font-medium">{tc("quantity")}</th>
              {props.can.fin || props.can.manage ? <><th className="px-2 py-2 text-right font-medium">{tc("price")}</th><th className="px-4 py-2 text-right font-medium">{tc("total")}</th></> : null}
              <th className="w-20" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {props.items.map((i) => (
              <tr key={i.id} className={i.approval === "declined" ? "text-muted-foreground line-through" : ""}>
                <td className="px-4 py-2">
                  {i.name}
                  {i.additional && <span className="ml-2 rounded bg-muted px-1.5 text-xs">{t("additional")}</span>}
                  {i.discountBp > 0 && <span className="ml-2 text-xs text-muted-foreground">−{i.discountBp / 100} %</span>}
                </td>
                <td className="tabular px-2 py-2 text-right">{i.quantity}</td>
                {props.can.fin || props.can.manage ? <><td className="tabular px-2 py-2 text-right">{money(i.unitPrice)}</td><td className="tabular px-4 py-2 text-right">{money(i.total)}</td></> : null}
                <td className="px-2 py-1 text-right">
                  {!closed && props.can.manage && i.approval === "pending" && (
                    <span className="inline-flex gap-1">
                      <Button size="icon-xs" variant="outline" aria-label={t("approve")} onClick={() => run(() => decideItem(props.slug, o.id, i.id, true))}><Check /></Button>
                      <Button size="icon-xs" variant="outline" aria-label={t("decline")} onClick={() => run(() => decideItem(props.slug, o.id, i.id, false))}><X /></Button>
                    </span>
                  )}
                  {!closed && props.can.manage && i.approval !== "pending" && (
                    <Button size="icon-xs" variant="ghost" aria-label={tc("delete")} onClick={() => run(() => removeItem(props.slug, o.id, i.id))}><Trash2 /></Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {(props.can.fin || props.can.manage) && (
            <tfoot className="border-t text-sm">
              <tr><td className="px-4 pt-2 text-muted-foreground" colSpan={3}>{t("subtotal")}</td><td className="tabular px-4 pt-2 text-right">{money(o.subtotal)}</td><td /></tr>
              {o.discount > 0 && <tr><td className="px-4 text-muted-foreground" colSpan={3}>{t("discount")}</td><td className="tabular px-4 text-right">−{money(o.discount)}</td><td /></tr>}
              <tr><td className="px-4 text-muted-foreground" colSpan={3}>{t("tax")} {o.includesTax ? "(incl.)" : ""}</td><td className="tabular px-4 text-right">{money(o.tax)}</td><td /></tr>
              <tr className="font-semibold"><td className="px-4 pb-2" colSpan={3}>{tc("total")}</td><td className="tabular px-4 pb-2 text-right">{money(o.total)}</td><td /></tr>
            </tfoot>
          )}
        </table>
      </Section>

      {props.can.fin && (
        <Section title={t("paid")} actions={props.can.pay && o.status !== "cancelled" && due > 0 && <PaymentDialog {...props} due={due} />}>
          <div className="flex flex-wrap gap-6 px-4 py-3 text-sm">
            <span>{t("paid")}: <b className="tabular">{money(o.paid)}</b></span>
            <span>{t("due")}: <b className={`tabular ${due > 0 ? "text-warning" : ""}`}>{money(Math.max(0, due))}</b></span>
          </div>
          {props.payments.length > 0 && (
            <ul className="divide-y border-t text-sm">
              {props.payments.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-2">
                  <span className="tabular w-40 text-muted-foreground">{formatDateTime(p.at, props.timezone, props.locale)}</span>
                  <span>{p.method}{p.kind === "refund" && ` · ${t("refund")}: ${p.note ?? ""}`}</span>
                  <span className={`tabular ml-auto ${p.kind === "refund" ? "text-destructive" : ""}`}>{p.kind === "refund" ? "−" : ""}{money(p.amount)}</span>
                  {props.can.pay && p.kind === "payment" && <RefundDialog {...props} payment={p} />}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      <NotesSection {...props} closed={closed} />
    </div>
  );
}

function NotesSection(props: Parameters<typeof OrderWorkspace>[0] & { closed: boolean }) {
  const t = useTranslations("orders");
  const tc = useTranslations("common");
  const router = useRouter();
  const toastResult = useActionToast();
  const [pending, start] = useTransition();
  const [damage, setDamage] = useState(props.order.damage);
  const [note, setNote] = useState(props.order.note);
  const [mileage, setMileage] = useState(props.order.mileage);
  const [employee, setEmployee] = useState(props.order.employeeId);
  const editable = !props.closed && (props.can.manage || props.can.work);
  return (
    <Section title={tc("notes")}>
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label={t("damage")}><Textarea rows={2} value={damage} onChange={(e) => setDamage(e.target.value)} disabled={!editable} /></Field></div>
        <div className="sm:col-span-2"><Field label={tc("notes")}><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={!editable} /></Field></div>
        <Field label={t("mileage")}><Input type="number" value={mileage} onChange={(e) => setMileage(e.target.value)} disabled={!editable} /></Field>
        {props.can.manage && (
          <Field label={t("assigned")}>
            <NativeSelect value={employee} onChange={(e) => setEmployee(e.target.value)} disabled={!editable}>
              <option value="">—</option>
              {props.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </NativeSelect>
          </Field>
        )}
        {editable && (
          <div className="sm:col-span-2">
            <Button size="sm" disabled={pending} onClick={() => start(async () => {
              const res = await updateOrderNotes(props.slug, props.order.id, { damage_notes: damage, internal_note: note, mileage_km: mileage, ...(props.can.manage ? { employee_id: employee } : {}) });
              if (toastResult(res)) router.refresh();
            })}>{tc("save")}</Button>
          </div>
        )}
      </div>
    </Section>
  );
}

function AddItemDialog(props: Parameters<typeof OrderWorkspace>[0] & { kind: "service" | "product" | "custom" }) {
  const t = useTranslations("orders");
  const tc = useTranslations("common");
  const router = useRouter();
  const toastResult = useActionToast();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [ref, setRef] = useState("");
  const [warehouse, setWarehouse] = useState(props.warehouses[0]?.id ?? "");
  const [qty, setQty] = useState("");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [additional, setAdditional] = useState(props.order.status === "in_progress");
  const label = props.kind === "service" ? t("addService") : props.kind === "product" ? t("addProduct") : tc("add");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="xs" variant="outline" />}><Plus />{label}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{label}</DialogTitle></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await addItem(props.slug, props.order.id, {
              kind: props.kind, service_id: props.kind === "service" ? ref : undefined, product_id: props.kind === "product" ? ref : undefined,
              warehouse_id: props.kind === "product" ? warehouse : undefined, quantity: qty ? Number(qty.replace(",", ".")) : undefined,
              name: props.kind === "custom" ? name : undefined, unit_price: props.kind === "custom" ? price : undefined, is_additional: additional,
            });
            if (toastResult(res)) { setOpen(false); setRef(""); setQty(""); router.refresh(); }
          });
        }}>
          {props.kind === "service" && (
            <Field label={t("addService")}>
              <NativeSelect value={ref} onChange={(e) => setRef(e.target.value)} required>
                <option value="" disabled>—</option>
                {props.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </NativeSelect>
            </Field>
          )}
          {props.kind === "product" && (
            <>
              <Field label={t("addProduct")}>
                <NativeSelect value={ref} onChange={(e) => setRef(e.target.value)} required>
                  <option value="" disabled>—</option>
                  {props.products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
                </NativeSelect>
              </Field>
              <Field label={t("warehouse")}>
                <NativeSelect value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
                  {props.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </NativeSelect>
              </Field>
            </>
          )}
          {props.kind === "custom" && (
            <>
              <Field label={tc("name")}><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
              <Field label={`${tc("price")}, ${props.currency}`}><Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} required /></Field>
            </>
          )}
          <Field label={tc("quantity")} hint={props.kind === "service" ? "auto" : undefined}><Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder={props.kind === "service" ? "4" : "1"} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={additional} onChange={(e) => setAdditional(e.target.checked)} />{t("additional")}</label>
          <Button type="submit" disabled={pending}>{tc("add")}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog(props: Parameters<typeof OrderWorkspace>[0] & { due: number }) {
  const t = useTranslations("orders");
  const tc = useTranslations("common");
  const router = useRouter();
  const toastResult = useActionToast();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [amount, setAmount] = useState(minorToInput(props.due));
  const [method, setMethod] = useState(props.methods[0]?.id ?? "");
  const [key, setKey] = useState(() => crypto.randomUUID());
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setKey(crypto.randomUUID()); setAmount(minorToInput(props.due)); } }}>
      <DialogTrigger render={<Button size="xs" />}><Plus />{t("recordPayment")}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("recordPayment")}</DialogTitle></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => {
          e.preventDefault();
          start(async () => { if (toastResult(await recordPayment(props.slug, props.order.id, amount, method, key))) { setOpen(false); router.refresh(); } });
        }}>
          <Field label={`${tc("amount")}, ${props.currency}`}><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
          <Field label={tc("method")}>
            <NativeSelect value={method} onChange={(e) => setMethod(e.target.value)}>
              {props.methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </NativeSelect>
          </Field>
          <Button type="submit" disabled={pending}>{tc("save")}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RefundDialog(props: Parameters<typeof OrderWorkspace>[0] & { payment: Payment }) {
  const t = useTranslations("orders");
  const tc = useTranslations("common");
  const router = useRouter();
  const toastResult = useActionToast();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [amount, setAmount] = useState(minorToInput(props.payment.amount));
  const [reason, setReason] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="icon-xs" variant="ghost" aria-label={t("refund")} />}><Undo2 /></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("refund")}</DialogTitle></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => {
          e.preventDefault();
          start(async () => { if (toastResult(await refundPayment(props.slug, props.order.id, props.payment.id, amount, reason, key))) { setOpen(false); router.refresh(); } });
        }}>
          <Field label={`${tc("amount")}, ${props.currency}`}><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label={t("refundReason")}><Input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} /></Field>
          <Button type="submit" variant="destructive" disabled={pending}>{t("refund")}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
