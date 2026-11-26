"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ClipboardList, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DL, StatusBadge } from "@/components/app/ui";
import { useActionToast } from "@/components/app/form-bits";
import { formatDateTime, formatMoney, formatTime, type Currency } from "@/lib/format";
import type { Locale } from "@/i18n/config";
import type { CalBooking } from "./board";
import { createOrderFromBooking, setBookingStatus, updateBookingNote } from "./actions";

const NEXT: Record<string, ("confirmed" | "arrived" | "in_progress" | "completed" | "no_show")[]> = {
  pending: ["confirmed"],
  confirmed: ["arrived", "no_show"],
  arrived: ["in_progress"],
  in_progress: ["completed"],
};

export function BookingSheet({ booking, onClose, slug, timezone, locale, currency, posts, employees, canManage, canOrder }: {
  booking: CalBooking | null; onClose: () => void; slug: string; timezone: string; locale: Locale; currency: Currency;
  posts: { id: string; name: string }[]; employees: { id: string; name: string }[]; canManage: boolean; canOrder: boolean;
}) {
  const t = useTranslations("calendar");
  const tc = useTranslations("common");
  const to = useTranslations("orders");
  const router = useRouter();
  const toastResult = useActionToast();
  const [pending, start] = useTransition();
  // draft note per booking; falls back to the saved note when untouched
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [confirmCancel, setConfirmCancel] = useState(false);

  const status = (s: Parameters<typeof setBookingStatus>[2]) => start(async () => {
    if (toastResult(await setBookingStatus(slug, booking!.id, s))) router.refresh();
  });
  const open = Boolean(booking);
  const b = booking;
  const note = b ? drafts[b.id] ?? b.note ?? "" : "";
  const setNote = (v: string) => { if (b) setDrafts((d) => ({ ...d, [b.id]: v })); };
  const closed = b ? ["completed", "cancelled", "no_show"].includes(b.status) : true;

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {b && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  {formatTime(b.startsAt, timezone, locale)}–{formatTime(b.endsAt, timezone, locale)}
                  <StatusBadge status={b.status} label={t(`status.${b.status}` as "status.confirmed")} />
                </SheetTitle>
              </SheetHeader>
              <div className="space-y-4 px-4 pb-6">
                <DL items={[
                  [tc("date"), formatDateTime(b.startsAt, timezone, locale)],
                  [t("customer"), b.customerId ? <Link className="font-medium hover:underline" href={`/app/${slug}/customers/${b.customerId}`}>{b.customer}</Link> : b.customer],
                  [tc("phone"), b.phone && <a href={`tel:${b.phone}`} className="inline-flex items-center gap-1 hover:underline"><Phone className="size-3" />{b.phone}</a>],
                  [t("vehicle"), [b.plate, b.vehicle].filter(Boolean).join(" · ")],
                  [t("services"), b.services.join(", ")],
                  [t("post"), posts.find((p) => p.id === b.postId)?.name],
                  [t("employee"), b.employeeId ? employees.find((e) => e.id === b.employeeId)?.name : t("noEmployee")],
                  [t("estimate"), formatMoney(b.total, currency, locale)],
                  [tc("notes"), b.customerNote],
                ]} />
                {canManage && !closed && (
                  <div className="flex flex-wrap gap-2">
                    {(NEXT[b.status] ?? []).map((s) => (
                      <Button key={s} size="sm" variant={s === "no_show" ? "outline" : "default"} disabled={pending} onClick={() => status(s)}>
                        {t(`status.${s}`)}
                      </Button>
                    ))}
                    <Button size="sm" variant="destructive" disabled={pending} onClick={() => setConfirmCancel(true)}>{tc("cancel")}</Button>
                  </div>
                )}
                {canOrder && b.status !== "cancelled" && (
                  b.orderId ? (
                    <Button size="sm" variant="outline" render={<Link href={`/app/${slug}/orders/${b.orderId}`} />}><ClipboardList />{t("openOrder")}</Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
                      const res = await createOrderFromBooking(slug, b.id);
                      if (toastResult(res, tc("created"))) router.push(`/app/${slug}/orders/${res.data!.id}`);
                    })}><ClipboardList />{t("createOrder")}</Button>
                  )
                )}
                {canManage && (
                  <div className="grid gap-1.5">
                    <span className="text-sm font-medium">{t("internalNote")}</span>
                    <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
                    <Button size="sm" variant="outline" className="justify-self-start" disabled={pending || note === (b.note ?? "")}
                      onClick={() => start(async () => { if (toastResult(await updateBookingNote(slug, b.id, note))) router.refresh(); })}>{tc("save")}</Button>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">{to("number")}: {b.id.slice(0, 8)} · {b.source}</p>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{tc("cancel")}: {b?.customer ?? ""} {b && formatTime(b.startsAt, timezone, locale)}?</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("back")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { setConfirmCancel(false); status("cancelled" as never); }}>{tc("confirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
