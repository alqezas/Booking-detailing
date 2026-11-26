"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, NativeSelect, StatusBadge } from "@/components/app/ui";
import { useActionToast } from "@/components/app/form-bits";
import { setBusinessActive, setLicense, setModule } from "./actions";

type Row = {
  id: string; slug: string; name: string; is_active: boolean; is_demo: boolean; license_kind: string; valid: string | null;
  created: string; members: number; branches: number; bookings_30d: number; modules: string[];
};
const MODULES = ["calendar", "orders", "customers", "vehicles", "tire_hotel", "inventory", "services", "employees", "finance", "analytics", "notifications", "corporate", "online_booking", "ai_assistant"] as const;

export function AdminBusinesses({ rows }: { rows: Row[] }) {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b text-xs text-muted-foreground">
          <tr className="text-left">
            <th className="px-4 py-2 font-medium">{tc("name")}</th><th className="px-2 py-2 font-medium">{t("slug")}</th>
            <th className="px-2 py-2 font-medium">{t("license")}</th><th className="px-2 py-2 text-right font-medium">{t("members")}</th>
            <th className="px-2 py-2 text-right font-medium">{tc("branch")}</th><th className="px-2 py-2 text-right font-medium">{t("bookings30")}</th>
            <th className="px-2 py-2 font-medium">{tc("status")}</th><th />
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="px-4 py-2 font-medium">{r.name}{r.is_demo && <span className="ml-2 rounded bg-muted px-1.5 text-xs">demo</span>}<div className="text-xs font-normal text-muted-foreground">{r.created}</div></td>
              <td className="px-2 py-2 font-mono text-xs"><a className="hover:underline" href={`/s/${r.slug}`} target="_blank" rel="noreferrer">/s/{r.slug}</a></td>
              <td className="px-2 py-2">{r.license_kind}{r.valid && <span className="text-xs text-muted-foreground"> → {r.valid}</span>}</td>
              <td className="tabular px-2 py-2 text-right">{r.members}</td>
              <td className="tabular px-2 py-2 text-right">{r.branches}</td>
              <td className="tabular px-2 py-2 text-right">{r.bookings_30d}</td>
              <td className="px-2 py-2"><StatusBadge status={r.is_active ? "paid" : "cancelled"} label={r.is_active ? t("active") : t("deactivate")} /></td>
              <td className="px-2 py-1 text-right"><ManageDialog row={r} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ManageDialog({ row }: { row: Row }) {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const ts = useTranslations("settings");
  const router = useRouter();
  const toastResult = useActionToast();
  const [pending, start] = useTransition();
  const [lic, setLic] = useState({ kind: row.license_kind, valid: row.valid ?? "", branches: 3, users: 25 });
  const run = (fn: () => ReturnType<typeof setModule>) => start(async () => { if (toastResult(await fn())) router.refresh(); });
  return (
    <Dialog>
      <DialogTrigger render={<Button size="icon-sm" variant="ghost" aria-label={tc("edit")} />}><Settings2 /></DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{row.name}</DialogTitle></DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("license")}>
              <NativeSelect value={lic.kind} onChange={(e) => setLic({ ...lic, kind: e.target.value })}>
                {["trial", "subscription", "perpetual", "partner", "internal"].map((k) => <option key={k} value={k}>{k}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Valid until"><Input type="date" value={lic.valid} onChange={(e) => setLic({ ...lic, valid: e.target.value })} /></Field>
            <Field label="Max branches"><Input type="number" min={1} value={lic.branches} onChange={(e) => setLic({ ...lic, branches: Number(e.target.value) })} /></Field>
            <Field label="Max users"><Input type="number" min={1} value={lic.users} onChange={(e) => setLic({ ...lic, users: Number(e.target.value) })} /></Field>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setLicense(row.id, lic.kind, lic.valid || null, lic.branches, lic.users))}>{tc("save")}</Button>
          </div>
          <div>
            <div className="mb-2 text-sm font-medium">{ts("modules")}</div>
            <div className="grid grid-cols-2 gap-1.5 text-sm">
              {MODULES.map((m) => (
                <label key={m} className="flex items-center gap-2">
                  <input type="checkbox" defaultChecked={row.modules.includes(m)} disabled={pending} onChange={(e) => run(() => setModule(row.id, m, e.target.checked))} />
                  {ts(`moduleNames.${m}`)}
                </label>
              ))}
            </div>
          </div>
          <Button variant={row.is_active ? "destructive" : "default"} disabled={pending} onClick={() => run(() => setBusinessActive(row.id, !row.is_active))}>
            {row.is_active ? t("deactivate") : t("activate")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
