"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowRightLeft, CalendarPlus, LogOut, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Field, NativeSelect } from "@/components/app/ui";
import { useActionToast } from "@/components/app/form-bits";
import { minorToInput, type Currency } from "@/lib/format";
import { extendStorage, moveSet, payStorage, releaseSet } from "../actions";

export function SetActions({ slug, setId, currency, canPay, methods, contract, freeCells, nextEnd, defaultPrice }: {
  slug: string; setId: string; currency: Currency; canPay: boolean; methods: { id: string; name: string }[];
  contract: { id: string; due: number; endsOn: string } | null; freeCells: { id: string; code: string }[]; nextEnd: string; defaultPrice: string;
}) {
  const t = useTranslations("hotel");
  const tc = useTranslations("common");
  const to = useTranslations("orders");
  const router = useRouter();
  const toastResult = useActionToast();
  const [pending, start] = useTransition();
  const [cell, setCell] = useState(freeCells[0]?.id ?? "");
  const [end, setEnd] = useState(nextEnd);
  const [price, setPrice] = useState(defaultPrice);
  const [amount, setAmount] = useState(contract ? minorToInput(Math.max(0, contract.due)) : "");
  const [method, setMethod] = useState(methods[0]?.id ?? "");
  const [open, setOpen] = useState<"" | "move" | "extend" | "pay">("");
  const done = (res: Parameters<typeof toastResult>[0]) => { if (toastResult(res)) { setOpen(""); router.refresh(); } };
  const unpaid = (contract?.due ?? 0) > 0;

  return (
    <>
      {canPay && unpaid && (
        <Dialog open={open === "pay"} onOpenChange={(o) => setOpen(o ? "pay" : "")}>
          <DialogTrigger render={<Button size="sm" variant="outline" />}><Wallet />{to("recordPayment")}</DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{to("recordPayment")}</DialogTitle></DialogHeader>
            <div className="grid gap-3">
              <Field label={`${tc("amount")}, ${currency}`}><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
              <Field label={tc("method")}><NativeSelect value={method} onChange={(e) => setMethod(e.target.value)}>{methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</NativeSelect></Field>
              <Button disabled={pending} onClick={() => start(async () => done(await payStorage(slug, setId, contract!.id, amount, method)))}>{tc("save")}</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      <Dialog open={open === "move"} onOpenChange={(o) => setOpen(o ? "move" : "")}>
        <DialogTrigger render={<Button size="sm" variant="outline" />}><ArrowRightLeft />{t("location")}</DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("location")}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <NativeSelect value={cell} onChange={(e) => setCell(e.target.value)}>{freeCells.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</NativeSelect>
            <Button disabled={pending || !cell} onClick={() => start(async () => done(await moveSet(slug, setId, cell)))}>{tc("save")}</Button>
          </div>
        </DialogContent>
      </Dialog>
      {contract && (
        <Dialog open={open === "extend"} onOpenChange={(o) => setOpen(o ? "extend" : "")}>
          <DialogTrigger render={<Button size="sm" variant="outline" />}><CalendarPlus />{t("until")}</DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{t("until")}</DialogTitle></DialogHeader>
            <div className="grid gap-3">
              <Field label={t("ends")}><Input type="date" value={end} min={contract.endsOn} onChange={(e) => setEnd(e.target.value)} /></Field>
              <Field label={`${t("price")}, ${currency}`}><Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
              <Button disabled={pending} onClick={() => start(async () => done(await extendStorage(slug, setId, end, price)))}>{tc("save")}</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      <AlertDialog>
        <AlertDialogTrigger render={<Button size="sm" />}><LogOut />{t("release")}</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("release")}</AlertDialogTitle>
            <AlertDialogDescription>{t("releaseConfirm")}{unpaid ? ` ${to("payment.unpaid")}!` : ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("back")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => start(async () => done(await releaseSet(slug, setId, unpaid)))}>{t("release")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
