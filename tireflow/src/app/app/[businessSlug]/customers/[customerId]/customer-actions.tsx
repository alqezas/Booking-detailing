"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Download, MoreHorizontal, Pencil, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useActionToast } from "@/components/app/form-bits";
import { anonymizeCustomer, exportCustomer } from "../actions";
import { CustomerForm, type CustomerFormValues } from "../customer-form";

export function CustomerActions({ slug, customer, canEdit, canExport, defaults }: {
  slug: string; customer: { id: string; name: string }; canEdit: boolean; canExport: boolean; defaults: CustomerFormValues;
}) {
  const t = useTranslations("customers");
  const tc = useTranslations("common");
  const router = useRouter();
  const toastResult = useActionToast();
  const [edit, setEdit] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();

  if (!canEdit && !canExport) return null;
  return (
    <>
      {canEdit && <Button size="sm" variant="outline" onClick={() => setEdit(true)}><Pencil />{tc("edit")}</Button>}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={tc("actions")} />}><MoreHorizontal /></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canExport && (
            <DropdownMenuItem onClick={() => start(async () => {
              const res = await exportCustomer(slug, customer.id);
              if (!res.ok) return void toastResult(res);
              const blob = new Blob([res.data!.json], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `customer-${customer.id}.json`;
              a.click();
              URL.revokeObjectURL(a.href);
            })}><Download className="size-4" />{t("exportData")}</DropdownMenuItem>
          )}
          {canEdit && canExport && (
            <DropdownMenuItem variant="destructive" onClick={() => setConfirm(true)}><UserX className="size-4" />{t("anonymize")}</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={edit} onOpenChange={setEdit}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>{customer.name}</DialogTitle></DialogHeader>
          <CustomerForm slug={slug} id={customer.id} defaults={defaults} onSaved={() => setEdit(false)} />
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("anonymize")}: {customer.name}</AlertDialogTitle>
            <AlertDialogDescription>{t("anonymizeConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={pending} onClick={() => start(async () => {
              const res = await anonymizeCustomer(slug, customer.id);
              if (toastResult(res)) { setConfirm(false); router.refresh(); }
            })}>{t("anonymize")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
