"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, NativeSelect } from "@/components/app/ui";
import { useActionToast } from "@/components/app/form-bits";
import { addExpense } from "./actions";

const CATS = ["rent", "salaries", "utilities", "purchases", "equipment", "marketing", "taxes", "other"] as const;

export function ExpenseDialog({ slug, branches, currency, today }: { slug: string; branches: { id: string; name: string }[]; currency: string; today: string }) {
  const t = useTranslations("finance");
  const tc = useTranslations("common");
  const router = useRouter();
  const toastResult = useActionToast();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [v, setV] = useState({ category: "purchases", amount: "", spent_on: today, branch_id: "", note: "" });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}><Plus />{t("newExpense")}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("newExpense")}</DialogTitle></DialogHeader>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); start(async () => { if (toastResult(await addExpense(slug, v))) { setOpen(false); router.refresh(); } }); }}>
          <Field label={t("category")}><NativeSelect value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>{CATS.map((c) => <option key={c} value={c}>{t(`expenseCategories.${c}`)}</option>)}</NativeSelect></Field>
          <Field label={`${tc("amount")}, ${currency}`}><Input inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} required /></Field>
          <Field label={tc("date")}><Input type="date" value={v.spent_on} onChange={(e) => setV({ ...v, spent_on: e.target.value })} /></Field>
          <Field label={tc("branch")}><NativeSelect value={v.branch_id} onChange={(e) => setV({ ...v, branch_id: e.target.value })}><option value="">—</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</NativeSelect></Field>
          <div className="sm:col-span-2"><Field label={tc("notes")}><Input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field></div>
          <div className="sm:col-span-2"><Button type="submit" disabled={pending}>{tc("save")}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
