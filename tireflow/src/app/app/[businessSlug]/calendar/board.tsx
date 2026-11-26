"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Lock, Plus, UserRoundPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect, PageHeader, StatusBadge } from "@/components/app/ui";
import { useActionToast } from "@/components/app/form-bits";
import { createClient } from "@/lib/supabase/client";
import { addDays, formatDate, formatTime, zonedDay, zonedInstant, zonedMinutes, type Currency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/config";
import { rescheduleBooking } from "./actions";
import { BookingDialog } from "./booking-dialog";
import { BookingSheet } from "./booking-sheet";

export type CalBooking = {
  id: string; startsAt: string; endsAt: string; status: string; source: string; postId: string; employeeId: string | null;
  customerId: string | null; customer: string | null; phone: string | null; plate: string | null; vehicle: string | null;
  services: string[]; note: string | null; customerNote: string | null; total: number; orderId: string | null;
};
export type CalBlock = { id: string; postId: string; startsAt: string; endsAt: string; reason: string };
type Post = { id: string; name: string; kind: string };
type Employee = { id: string; name: string; color: string; branchId: string | null };

const PX_PER_MIN = 1.3;
const statusColor: Record<string, string> = {
  pending: "border-l-amber-500 bg-amber-50 dark:bg-amber-950/40",
  confirmed: "border-l-sky-500 bg-sky-50 dark:bg-sky-950/40",
  arrived: "border-l-violet-500 bg-violet-50 dark:bg-violet-950/40",
  in_progress: "border-l-teal-500 bg-teal-50 dark:bg-teal-950/40",
  completed: "border-l-zinc-400 bg-muted opacity-70",
  cancelled: "border-l-red-400 bg-red-50/60 opacity-50 line-through dark:bg-red-950/30",
  no_show: "border-l-red-500 bg-red-50/60 opacity-60 dark:bg-red-950/30",
};

export function CalendarBoard(props: {
  slug: string; businessId: string; branchId: string; branches: { id: string; name: string }[];
  view: "day" | "week" | "list" | "staff"; day: string; rangeStart: string; timezone: string; locale: Locale; currency: Currency;
  slotStep: number; hours: Record<string, [string, string][]>; posts: Post[]; bookings: CalBooking[]; blocks: CalBlock[];
  employees: Employee[]; services: { id: string; name: string; unit: string; base_duration_min: number }[];
  categories: { id: string; name: string }[]; canManage: boolean; canOrder: boolean; openNew: boolean;
  presetCustomer?: string; presetVehicle?: string; focusBooking?: string; focusDay?: string;
}) {
  const t = useTranslations("calendar");
  const tc = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const tz = props.timezone;
  const [dialog, setDialog] = useState<{ open: boolean; start?: string; postId?: string; walkIn?: boolean }>({ open: props.openNew });
  const [selected, setSelected] = useState<string | null>(props.focusBooking ?? null);

  const nav = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) if (v === null) next.delete(k); else next.set(k, v);
    next.delete("new"); next.delete("booking");
    router.push(`${pathname}?${next}`);
  }, [sp, pathname, router]);

  // jump to the day of a booking opened from elsewhere
  useEffect(() => {
    if (props.focusDay && props.focusDay !== props.day && props.view !== "list") nav({ date: props.focusDay });
  }, [props.focusDay]); // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime: only this business' bookings, refresh at most every 800 ms
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`bookings:${props.businessId}:${props.branchId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings", filter: `business_id=eq.${props.businessId}` }, () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => router.refresh(), 800);
      })
      .subscribe();
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(channel); };
  }, [props.businessId, props.branchId, router]);

  const step = props.view === "week" ? 7 : props.view === "list" ? 14 : 1;
  const today = zonedDay(new Date(), tz);
  const booking = props.bookings.find((b) => b.id === selected) ?? null;

  return (
    <>
      <PageHeader
        title={t("title")}
        description={props.view === "list"
          ? `${formatDate(zonedInstant(props.rangeStart, 720, tz), tz, props.locale)} – ${formatDate(zonedInstant(addDays(props.rangeStart, 13), 720, tz), tz, props.locale)}`
          : formatDate(zonedInstant(props.view === "week" ? props.rangeStart : props.day, 720, tz), tz, props.locale)}
        actions={props.canManage && (
          <>
            <Button size="sm" variant="outline" onClick={() => setDialog({ open: true, walkIn: true })}><UserRoundPlus />{t("walkIn")}</Button>
            <Button size="sm" onClick={() => setDialog({ open: true })}><Plus />{t("newBooking")}</Button>
          </>
        )}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="outline" aria-label={tc("previous")} onClick={() => nav({ date: addDays(props.view === "week" ? props.rangeStart : props.day, -step) })}><ChevronLeft /></Button>
          <Button size="sm" variant="outline" onClick={() => nav({ date: today })}>{tc("today")}</Button>
          <Button size="icon-sm" variant="outline" aria-label={tc("next")} onClick={() => nav({ date: addDays(props.view === "week" ? props.rangeStart : props.day, step) })}><ChevronRight /></Button>
          <input type="date" value={props.day} onChange={(e) => e.target.value && nav({ date: e.target.value })}
            className="h-7 rounded-md border bg-transparent px-2 text-sm" aria-label={tc("date")} />
        </div>
        <div className="flex rounded-lg border p-0.5 text-sm">
          {(["day", "staff", "week", "list"] as const).map((v) => (
            <button key={v} onClick={() => nav({ view: v === "day" ? null : v })}
              className={cn("rounded-md px-2.5 py-0.5", props.view === v ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}>
              {v === "staff" ? t("byEmployee") : v === "day" ? t("byPost") : t(v)}
            </button>
          ))}
        </div>
        {props.branches.length > 1 && (
          <NativeSelect className="w-auto" value={props.branchId} onChange={(e) => nav({ branch: e.target.value })} aria-label={tc("branch")}>
            {props.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </NativeSelect>
        )}
        {props.canManage && props.view === "day" && <span className="text-xs text-muted-foreground">{t("dragHint")}</span>}
      </div>

      {props.view === "day" || props.view === "staff" ? (
        <DayGrid {...props} byEmployee={props.view === "staff"} onSelect={setSelected} onEmpty={(start, postId) => props.canManage && setDialog({ open: true, start, postId })} />
      ) : props.view === "week" ? (
        <WeekGrid {...props} onSelect={setSelected} onDay={(d) => nav({ date: d, view: null })} />
      ) : (
        <ListView {...props} onSelect={setSelected} />
      )}

      {dialog.open && (
        <BookingDialog
          open={dialog.open}
          onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))}
          slug={props.slug} businessId={props.businessId} branchId={props.branchId} timezone={tz} locale={props.locale}
          currency={props.currency} day={props.day} posts={props.posts} employees={props.employees.filter((e) => !e.branchId || e.branchId === props.branchId)}
          services={props.services} categories={props.categories} presetStart={dialog.start} presetPost={dialog.postId}
          walkIn={dialog.walkIn} presetCustomer={props.presetCustomer} presetVehicle={props.presetVehicle}
          onCreated={(id) => { setDialog({ open: false }); setSelected(id); router.refresh(); }}
        />
      )}
      <BookingSheet
        booking={booking} onClose={() => setSelected(null)} slug={props.slug} timezone={tz} locale={props.locale}
        currency={props.currency} posts={props.posts} employees={props.employees} canManage={props.canManage} canOrder={props.canOrder}
      />
    </>
  );
}

function parseHours(hours: Record<string, [string, string][]>, day: string) {
  const [y, m, d] = day.split("-").map(Number);
  const iso = ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
  const ranges = hours[String(iso)] ?? [];
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  if (!ranges.length) return { open: 8 * 60, close: 18 * 60, closed: true };
  return { open: Math.min(...ranges.map((r) => toMin(r[0]))), close: Math.max(...ranges.map((r) => toMin(r[1]))), closed: false };
}

function DayGrid(props: Parameters<typeof CalendarBoard>[0] & { byEmployee: boolean; onSelect: (id: string) => void; onEmpty: (start: string, postId: string) => void }) {
  const t = useTranslations("calendar");
  const router = useRouter();
  const toastResult = useActionToast();
  const [, start] = useTransition();
  const tz = props.timezone;
  const hours = parseHours(props.hours, props.day);
  const from = Math.max(0, hours.open - 60);
  const to = Math.min(24 * 60, hours.close + 60);
  const height = (to - from) * PX_PER_MIN;
  const [drag, setDrag] = useState<{ id: string; offsetMin: number } | null>(null);
  const [resize, setResize] = useState<{ id: string; startY: number; base: number; dur: number } | null>(null);
  const [nowMin, setNowMin] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tick = () => setNowMin(zonedDay(new Date(), tz) === props.day ? zonedMinutes(new Date(), tz) : null);
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [tz, props.day]);

  const columns = props.byEmployee
    ? props.employees.filter((e) => !e.branchId || e.branchId === props.branchId).map((e) => ({ id: e.id, name: e.name, color: e.color }))
    : props.posts.map((p) => ({ id: p.id, name: p.name, color: undefined as string | undefined }));
  const colOf = (b: CalBooking) => (props.byEmployee ? b.employeeId : b.postId);
  const snap = (min: number) => Math.round(min / props.slotStep) * props.slotStep;
  const minAt = (clientY: number, el: HTMLElement) => from + (clientY - el.getBoundingClientRect().top) / PX_PER_MIN;

  const move = (b: CalBooking, newStartMin: number, colId: string) => {
    const startsAt = zonedInstant(props.day, snap(newStartMin), tz).toISOString();
    start(async () => {
      const res = props.byEmployee
        ? await rescheduleBooking(props.slug, b.id, startsAt, null, null, colId)
        : await rescheduleBooking(props.slug, b.id, startsAt, colId);
      if (toastResult(res, t("moved"))) router.refresh();
    });
  };

  // resize with the pointer; commit on release
  useEffect(() => {
    if (!resize) return;
    const onMove = (e: PointerEvent) => setResize((r) => r && { ...r, dur: Math.max(props.slotStep, snap(r.base + (e.clientY - r.startY) / PX_PER_MIN)) });
    const onUp = () => {
      const r = resize;
      setResize(null);
      const b = props.bookings.find((x) => x.id === r.id);
      if (!b) return;
      start(async () => {
        const res = await rescheduleBooking(props.slug, b.id, b.startsAt, null, r.dur);
        if (toastResult(res, t("moved"))) router.refresh();
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [resize?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const hourMarks: number[] = [];
  for (let m = Math.ceil(from / 60) * 60; m < to; m += 60) hourMarks.push(m);

  if (columns.length === 0) return <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">—</div>;

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <div className="grid min-w-max" style={{ gridTemplateColumns: `3.5rem repeat(${columns.length}, minmax(11rem, 1fr))` }}>
        <div className="sticky top-0 z-10 border-b bg-card" />
        {columns.map((c) => (
          <div key={c.id} className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-l bg-card px-2 py-2 text-sm font-medium">
            {c.color && <span className="size-2 rounded-full" style={{ background: c.color }} />}{c.name}
          </div>
        ))}
        <div className="relative" style={{ height }}>
          {hourMarks.map((m) => (
            <div key={m} className="tabular absolute right-1.5 -translate-y-1/2 text-[11px] text-muted-foreground" style={{ top: (m - from) * PX_PER_MIN }}>
              {String(m / 60).padStart(2, "0")}:00
            </div>
          ))}
        </div>
        {columns.map((col) => (
          <div
            key={col.id}
            ref={gridRef}
            className="relative border-l"
            style={{ height }}
            onDragOver={(e) => { if (drag) e.preventDefault(); }}
            onDrop={(e) => {
              e.preventDefault();
              const b = props.bookings.find((x) => x.id === drag?.id);
              if (b && drag) move(b, minAt(e.clientY, e.currentTarget) - drag.offsetMin, col.id);
              setDrag(null);
            }}
            onClick={(e) => {
              if (e.target !== e.currentTarget || props.byEmployee) return;
              const startMin = Math.floor(minAt(e.clientY, e.currentTarget) / props.slotStep) * props.slotStep;
              props.onEmpty(zonedInstant(props.day, startMin, tz).toISOString(), col.id);
            }}
          >
            {/* closed hours shading */}
            <div className="pointer-events-none absolute inset-x-0 top-0 bg-muted/60" style={{ height: (hours.open - from) * PX_PER_MIN }} />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-muted/60" style={{ height: (to - hours.close) * PX_PER_MIN }} />
            {hours.closed && <div className="pointer-events-none absolute inset-0 flex items-start justify-center bg-muted/60 pt-6 text-xs text-muted-foreground">{t("closed")}</div>}
            {hourMarks.map((m) => <div key={m} className="pointer-events-none absolute inset-x-0 border-t border-dashed" style={{ top: (m - from) * PX_PER_MIN }} />)}
            {nowMin !== null && nowMin > from && nowMin < to && (
              <div className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-red-500" style={{ top: (nowMin - from) * PX_PER_MIN }} />
            )}
            {!props.byEmployee && props.blocks.filter((bl) => bl.postId === col.id).map((bl) => {
              const s = zonedDay(new Date(bl.startsAt), tz) < props.day ? 0 : zonedMinutes(new Date(bl.startsAt), tz);
              const e = zonedDay(new Date(bl.endsAt), tz) > props.day ? 24 * 60 : zonedMinutes(new Date(bl.endsAt), tz);
              return (
                <div key={bl.id} className="absolute inset-x-1 flex items-start gap-1 rounded bg-[repeating-linear-gradient(45deg,var(--muted),var(--muted)_6px,transparent_6px,transparent_12px)] px-1.5 py-1 text-[11px] text-muted-foreground"
                  style={{ top: (Math.max(s, from) - from) * PX_PER_MIN, height: Math.max(12, (Math.min(e, to) - Math.max(s, from)) * PX_PER_MIN) }}>
                  <Lock className="size-3" />{bl.reason}
                </div>
              );
            })}
            {props.bookings.filter((b) => colOf(b) === col.id).map((b) => {
              const s = zonedMinutes(new Date(b.startsAt), tz);
              const dur = resize?.id === b.id ? resize.dur : (new Date(b.endsAt).getTime() - new Date(b.startsAt).getTime()) / 60000;
              const movable = props.canManage && !["completed", "cancelled", "no_show"].includes(b.status);
              return (
                <div
                  key={b.id}
                  draggable={movable && !resize}
                  onDragStart={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setDrag({ id: b.id, offsetMin: (e.clientY - rect.top) / PX_PER_MIN });
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => setDrag(null)}
                  onClick={(e) => { e.stopPropagation(); props.onSelect(b.id); }}
                  className={cn(
                    "group absolute inset-x-1 cursor-pointer overflow-hidden rounded-md border border-l-4 px-1.5 py-1 text-xs shadow-xs transition-shadow hover:shadow-md",
                    statusColor[b.status], drag?.id === b.id && "opacity-50",
                  )}
                  style={{ top: (s - from) * PX_PER_MIN, height: Math.max(18, dur * PX_PER_MIN - 2) }}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="tabular font-medium">{formatTime(b.startsAt, tz, props.locale)}</span>
                    {b.plate && <span className="truncate font-mono text-[10px] opacity-80">{b.plate}</span>}
                  </div>
                  <div className="truncate font-medium">{b.customer ?? "—"}</div>
                  <div className="truncate opacity-75">{b.services.join(", ")}</div>
                  {movable && (
                    <div
                      onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); setResize({ id: b.id, startY: e.clientY, base: dur, dur }); }}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100"
                      aria-label="resize"
                    ><div className="mx-auto mt-0.5 h-0.5 w-6 rounded bg-current opacity-40" /></div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function WeekGrid(props: Parameters<typeof CalendarBoard>[0] & { onSelect: (id: string) => void; onDay: (d: string) => void }) {
  const tcal = useTranslations("calendar");
  const tz = props.timezone;
  const days = Array.from({ length: 7 }, (_, i) => addDays(props.rangeStart, i));
  const byDay = useMemo(() => {
    const m = new Map<string, CalBooking[]>();
    for (const b of props.bookings) {
      const d = zonedDay(new Date(b.startsAt), tz);
      m.set(d, [...(m.get(d) ?? []), b]);
    }
    return m;
  }, [props.bookings, tz]);
  const load = (d: string) => {
    const h = parseHours(props.hours, d);
    if (h.closed) return 0;
    const capacity = (h.close - h.open) * Math.max(1, props.posts.length);
    const used = (byDay.get(d) ?? []).filter((b) => !["cancelled", "no_show"].includes(b.status))
      .reduce((s, b) => s + (new Date(b.endsAt).getTime() - new Date(b.startsAt).getTime()) / 60000, 0);
    return Math.min(100, Math.round((used / capacity) * 100));
  };
  return (
    <div className="grid gap-2 md:grid-cols-7">
      {days.map((d) => (
        <div key={d} className="min-h-40 rounded-lg border bg-card">
          <button onClick={() => props.onDay(d)} className="flex w-full items-center justify-between border-b px-2.5 py-1.5 text-left text-sm font-medium hover:bg-muted/50">
            <span>{formatDate(zonedInstant(d, 720, tz), tz, props.locale).replace(/,? \d{4}/, "")}</span>
            <span className="tabular text-xs text-muted-foreground">{load(d)}%</span>
          </button>
          <div className="h-1 bg-muted"><div className="h-1 bg-primary" style={{ width: `${load(d)}%` }} /></div>
          <ul className="space-y-1 p-1.5">
            {(byDay.get(d) ?? []).map((b) => (
              <li key={b.id}>
                <button onClick={() => props.onSelect(b.id)} className={cn("w-full rounded border border-l-4 px-1.5 py-0.5 text-left text-xs", statusColor[b.status])}>
                  <span className="tabular font-medium">{formatTime(b.startsAt, tz, props.locale)}</span> {b.customer ?? b.plate ?? "—"}
                </button>
              </li>
            ))}
          </ul>
          {(byDay.get(d) ?? []).length === 0 && <p className="px-2.5 pb-2 text-xs text-muted-foreground">{tcal("closed") && "—"}</p>}
        </div>
      ))}
    </div>
  );
}

function ListView(props: Parameters<typeof CalendarBoard>[0] & { onSelect: (id: string) => void }) {
  const tcal = useTranslations("calendar");
  const tc = useTranslations("common");
  const tz = props.timezone;
  const posts = new Map(props.posts.map((p) => [p.id, p.name]));
  const emps = new Map(props.employees.map((e) => [e.id, e.name]));
  if (props.bookings.length === 0) return <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">{tc("empty")}</div>;
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b text-xs text-muted-foreground">
          <tr className="text-left">
            <th className="px-3 py-2 font-medium">{tc("date")}</th><th className="px-3 py-2 font-medium">{tcal("customer")}</th>
            <th className="px-3 py-2 font-medium">{tcal("services")}</th><th className="px-3 py-2 font-medium">{tcal("post")}</th>
            <th className="px-3 py-2 font-medium">{tcal("employee")}</th><th className="px-3 py-2 font-medium">{tc("status")}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {props.bookings.map((b) => (
            <tr key={b.id} className="cursor-pointer hover:bg-muted/50" onClick={() => props.onSelect(b.id)}>
              <td className="tabular whitespace-nowrap px-3 py-2">{formatDate(b.startsAt, tz, props.locale)} {formatTime(b.startsAt, tz, props.locale)}</td>
              <td className="px-3 py-2">{b.customer ?? "—"} <span className="font-mono text-xs text-muted-foreground">{b.plate}</span></td>
              <td className="max-w-64 truncate px-3 py-2 text-muted-foreground">{b.services.join(", ")}</td>
              <td className="px-3 py-2">{posts.get(b.postId)}</td>
              <td className="px-3 py-2">{b.employeeId ? emps.get(b.employeeId) : "—"}</td>
              <td className="px-3 py-2"><StatusBadge status={b.status} label={tcal(`status.${b.status}` as "status.confirmed")} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t px-3 py-2 text-xs text-muted-foreground">
        <Link href="?view=list">{tc("rows", { count: props.bookings.length })}</Link>
      </div>
    </div>
  );
}
