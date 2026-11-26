"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/app/ui";
import { useActionToast } from "@/components/app/form-bits";
import { setOrderStatus, updateOrderNotes } from "../orders/actions";

export type WorkItem = {
  id: string; number: string; status: string; damage_notes: string | null; internal_note: string | null;
  make: string | null; model: string | null; plate: string | null; rim_diameter: number | null; has_tpms: boolean | null; has_runflat: boolean | null;
  items: { id: string; name: string; quantity: number; approval: string }[];
};

export function WorkCard({ slug, item: w }: { slug: string; item: WorkItem }) {
  const t = useTranslations("orders");
  const tc = useTranslations("common");
  const router = useRouter();
  const toastResult = useActionToast();
  const [pending, start] = useTransition();
  const [damage, setDamage] = useState(w.damage_notes ?? "");
  const [note, setNote] = useState(w.internal_note ?? "");
  const run = (fn: () => ReturnType<typeof setOrderStatus>) => start(async () => { if (toastResult(await fn())) router.refresh(); });
  return (
    <article className="space-y-3 rounded-xl border bg-card p-4">
      <header className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-2xl font-bold">{w.plate ?? "—"}</div>
          <div className="text-sm text-muted-foreground">{w.make} {w.model} {w.rim_diameter && `· R${w.rim_diameter}`} {w.has_tpms && "· TPMS"} {w.has_runflat && "· RunFlat"}</div>
        </div>
        <div className="text-right"><div className="tabular text-sm font-medium">{w.number}</div><StatusBadge status={w.status} label={t(`status.${w.status}` as "status.draft")} /></div>
      </header>
      <ul className="space-y-1 text-base">
        {w.items.map((i) => (
          <li key={i.id} className={`flex justify-between rounded-md bg-muted/50 px-3 py-2 ${i.approval === "declined" ? "line-through opacity-60" : ""}`}>
            <span>{i.name}</span><span className="tabular">{Number(i.quantity)}×{i.approval === "pending" ? " ⏳" : ""}</span>
          </li>
        ))}
      </ul>
      <Textarea placeholder={t("damage")} value={damage} onChange={(e) => setDamage(e.target.value)} rows={2} className="text-base" />
      <Textarea placeholder={tc("notes")} value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="text-base" />
      <div className="flex flex-wrap gap-2">
        <Button size="lg" variant="outline" disabled={pending} onClick={() => run(() => updateOrderNotes(slug, w.id, { damage_notes: damage, internal_note: note }))}>{tc("save")}</Button>
        {["scheduled", "draft"].includes(w.status) && <Button size="lg" disabled={pending} onClick={() => run(() => setOrderStatus(slug, w.id, "in_progress"))}>{t("start")}</Button>}
        {w.status === "in_progress" && <Button size="lg" disabled={pending} onClick={() => run(() => setOrderStatus(slug, w.id, "ready"))}>{t("ready")}</Button>}
      </div>
    </article>
  );
}
