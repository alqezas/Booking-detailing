import { intlLocale, type Locale } from "@/i18n/config";

export type Currency = "CZK" | "EUR" | "PLN" | "UAH";

/** Amounts are integers in minor units (haléř, cent, grosz, kopiyka). */
export function formatMoney(minor: number | null | undefined, currency: Currency, locale: Locale = "en") {
  if (minor == null) return "—";
  return new Intl.NumberFormat(intlLocale[locale], {
    style: "currency",
    currency,
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

/** "1 234,50" → 123450. Accepts comma or dot as decimal separator. Returns null when invalid. */
export function parseMoney(input: string): number | null {
  const s = input.replace(/[\s ]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function minorToInput(minor: number) {
  return (minor / 100).toFixed(2).replace(/\.00$/, "");
}

export function formatDateTime(iso: string | Date, timeZone: string, locale: Locale = "en", opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }) {
  return new Intl.DateTimeFormat(intlLocale[locale], { timeZone, ...opts }).format(new Date(iso));
}

export function formatTime(iso: string | Date, timeZone: string, locale: Locale = "en") {
  return new Intl.DateTimeFormat(intlLocale[locale], { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function formatDate(iso: string | Date, timeZone: string, locale: Locale = "en") {
  return new Intl.DateTimeFormat(intlLocale[locale], { timeZone, dateStyle: "medium" }).format(new Date(iso));
}

/** Wall-clock date (YYYY-MM-DD) of an instant in a time zone. */
export function zonedDay(d: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Instant for a wall-clock date + minutes-after-midnight in a time zone (DST-safe). */
export function zonedInstant(day: string, minutes: number, timeZone: string) {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  const offset = tzOffsetMinutes(new Date(guess), timeZone);
  const first = new Date(guess - offset * 60000);
  const offset2 = tzOffsetMinutes(first, timeZone);
  return offset2 === offset ? first : new Date(guess - offset2 * 60000);
}

export function tzOffsetMinutes(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** Minutes since local midnight of an instant. */
export function zonedMinutes(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(at);
  return Number(parts.find((p) => p.type === "hour")!.value) * 60 + Number(parts.find((p) => p.type === "minute")!.value);
}

export function addDays(day: string, n: number) {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** Map Postgres/RPC error codes raised by our functions to translation keys. */
export function rpcErrorKey(message: string | undefined) {
  const known = [
    "slot_taken", "forbidden", "insufficient_stock", "location_full", "warehouse_full", "storage_unpaid",
    "refund_exceeds_payment", "order_closed", "booking_closed", "pending_approvals", "rate_limited",
    "outside_hours", "employee_absent", "workstation_incompatible", "too_late_to_change", "invalid_phone",
    "service_not_bookable", "user_limit_reached", "module_disabled", "invalid_amount", "no_services",
  ];
  const hit = known.find((k) => message?.includes(k));
  return hit ?? "generic";
}
