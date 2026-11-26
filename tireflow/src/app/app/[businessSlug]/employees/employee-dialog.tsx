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
import { saveEmployee } from "./actions";

export function EmployeeDialog({ slug, branches }: { slug: string; branches: { id: string; name: string }[] }) {
  const t = useTranslations("employees");
  const tc = useTranslations("common");
  const tcu = useTranslations("customers");
  const router = useRouter();
  const toastResult = useActionToast();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [v, setV] = useState({ first_name: "", last_name: "", phone: "", email: "", position: "", branch_id: branches[0]?.id ?? "", skills: "", commission_pct: "0", color: "#2563eb", workdays: "12345", starts: "08:00", ends: "17:00" });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}><Plus />{t("new")}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{t("new")}</DialogTitle></DialogHeader>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); start(async () => { if (toastResult(await saveEmployee(slug, v))) { setOpen(false); router.refresh(); } }); }}>
          <Field label={tcu("firstName")}><Input value={v.first_name} onChange={(e) => setV({ ...v, first_name: e.target.value })} required autoFocus /></Field>
          <Field label={tcu("lastName")}><Input value={v.last_name} onChange={(e) => setV({ ...v, last_name: e.target.value })} /></Field>
          <Field label={tc("phone")}><Input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
          <Field label={tc("email")}><Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
          <Field label={t("position")}><Input value={v.position} onChange={(e) => setV({ ...v, position: e.target.value })} /></Field>
          <Field label={tc("branch")}><NativeSelect value={v.branch_id} onChange={(e) => setV({ ...v, branch_id: e.target.value })}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</NativeSelect></Field>
          <Field label={t("skills")} hint="tpms, runflat, rims"><Input value={v.skills} onChange={(e) => setV({ ...v, skills: e.target.value })} /></Field>
          <Field label={t("commission")}><Input inputMode="decimal" value={v.commission_pct} onChange={(e) => setV({ ...v, commission_pct: e.target.value })} /></Field>
          <Field label={t("schedule")} hint="1=Mon … 7=Sun"><Input value={v.workdays} onChange={(e) => setV({ ...v, workdays: e.target.value.replace(/[^1-7]/g, "") })} /></Field>
          <div className="flex items-end gap-2">
            <Input type="time" value={v.starts} onChange={(e) => setV({ ...v, starts: e.target.value })} />
            <Input type="time" value={v.ends} onChange={(e) => setV({ ...v, ends: e.target.value })} />
          </div>
          <Field label="Color"><Input type="color" className="h-9 p-1" value={v.color} onChange={(e) => setV({ ...v, color: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Button type="submit" disabled={pending}>{tc("create")}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
