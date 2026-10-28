/**
 * Tyre service (pneuservis) price matrix: one dependency-free module shared by
 * the site (calculator), the assistants and the tests. The database mirrors
 * the same rules in private.tire_quote — the server price is what a booking
 * stores; tests/integration/tire-sql-check.ts compares both on a grid.
 *
 * A matrix row matches a vehicle type, a rim type and a diameter range. The
 * first matching row wins, so specific rows go before general ones.
 *   unit «set»: price and minutes are for a set of four wheels and scale with
 *               the number of wheels (2 wheels = half), minutes rounded up to 5;
 *   unit «job»: a fixed price and time (a puncture repair, storage of a set).
 * A row with price null, or no matching row, is «price on request»: the
 * booking stores 0 and the interface says so instead of a number.
 */
export const VEHICLES = ['car', 'suv', 'van'] as const;
export const RIMS = ['steel', 'alloy'] as const;
export const TIRE_SEASONS = ['summer', 'winter', 'all'] as const;
export const MOUNT_SEASONS = ['summer', 'winter'] as const;
export const TIRE_SOURCES = ['own', 'buy', 'storage'] as const;
export const MIN_DIAMETER = 13;
/** The last diameter means «22″ and larger». */
export const MAX_DIAMETER = 22;
export const MAX_WHEELS = 8;
export const SET_SIZE = 4;

export type Vehicle = (typeof VEHICLES)[number];
export type Rim = (typeof RIMS)[number];
export type TireSeason = (typeof TIRE_SEASONS)[number];
export type MountSeason = (typeof MOUNT_SEASONS)[number];
export type TireSource = (typeof TIRE_SOURCES)[number];

export type TireRow = {vehicles?: Vehicle[]; rims?: Rim[]; from: number; to: number; price: number | null; minutes: number};
export type TireOperation = {service: string; unit: 'set' | 'job'; rows: TireRow[]};
export type SeasonPeriod = {from: string; to: string; mount: MountSeason; horizonDays?: number | null};
export type TireNames = {vehicles: Record<Vehicle, string>; rims: Record<Rim, string>};
export type TireConfig = {operations: TireOperation[]; names: TireNames; defaultWheels: number; storage?: boolean};
export type TireParams = {vehicle: Vehicle; rim: Rim; diameter: number; wheels: number};
export type TireQuote = {price: number; onRequest: boolean; durationMinutes: number; wheels: number};

export const DIAMETERS: number[] = Array.from({length: MAX_DIAMETER - MIN_DIAMETER + 1}, (_, i) => MIN_DIAMETER + i);

export const operationFor = (config: TireConfig | null | undefined, serviceKey: string): TireOperation | undefined =>
  config?.operations.find(o => o.service === serviceKey);

export function matchRow(op: TireOperation, p: Pick<TireParams, 'vehicle' | 'rim' | 'diameter'>): TireRow | undefined {
  return op.rows.find(
    r => (!r.vehicles || r.vehicles.includes(p.vehicle)) && (!r.rims || r.rims.includes(p.rim)) && p.diameter >= r.from && p.diameter <= r.to,
  );
}

export const clampWheels = (n: number): number => Math.min(MAX_WHEELS, Math.max(1, Math.round(n) || SET_SIZE));

/** Price and duration of one operation; `baseMinutes` is the service's own duration, used when no row matches. */
export function quote(op: TireOperation, p: TireParams, baseMinutes: number): TireQuote {
  const wheels = clampWheels(p.wheels);
  const row = matchRow(op, p);
  if (!row) return {price: 0, onRequest: true, durationMinutes: Math.max(15, baseMinutes), wheels};
  const onRequest = row.price === null;
  if (op.unit === 'job') return {price: onRequest ? 0 : row.price!, onRequest, durationMinutes: Math.max(15, row.minutes), wheels};
  return {
    price: onRequest ? 0 : Math.round((row.price! * wheels) / SET_SIZE),
    onRequest,
    durationMinutes: Math.max(15, Math.ceil((row.minutes * wheels) / 20) * 5),
    wheels,
  };
}

/** «Přezutí kompletních kol — SUV, Alu R17, 4×»: the name a booking keeps. */
export function quoteLabel(serviceName: string, op: TireOperation, p: TireParams, names: TireNames): string {
  const d = `R${p.diameter}${p.diameter >= MAX_DIAMETER ? '+' : ''}`;
  const wheels = op.unit === 'set' ? `, ${clampWheels(p.wheels)}×` : '';
  return `${serviceName} — ${names.vehicles[p.vehicle]}, ${names.rims[p.rim]} ${d}${wheels}`;
}

/** Lowest and highest known price of an operation for one vehicle/rim (a full set), for «from … to …» lines. */
export function priceRange(op: TireOperation, vehicle?: Vehicle, rim?: Rim): {min: number; max: number; onRequest: boolean} | null {
  const rows = op.rows.filter(r => (!vehicle || !r.vehicles || r.vehicles.includes(vehicle)) && (!rim || !r.rims || r.rims.includes(rim)));
  const priced = rows.filter(r => r.price !== null).map(r => r.price!);
  if (!rows.length) return null;
  return {min: priced.length ? Math.min(...priced) : 0, max: priced.length ? Math.max(...priced) : 0, onRequest: priced.length < rows.length};
}

// ---------------------------------------------------------------------------
// Customer data
// ---------------------------------------------------------------------------

/** Registration plate as stored: letters and digits only, upper case («1T2 3456» → «1T23456»). */
export const normalizePlate = (raw: string): string => raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
export const PLATE_RE = /^[A-Z0-9]{2,10}$/;

/** «205/55 R16 91V», «205/55R16», «R16» → the rim diameter (16); null when there is none. */
export function diameterOfSize(size: string): number | null {
  const m = /(?:^|[\s/\d])Z?R\s?(\d{2})(?:[^\d]|$)/i.exec(size) ?? /^\s*(\d{2})\s*(?:"|″|''|palc|cal|inch)/i.exec(size);
  if (!m) return null;
  const d = Number(m[1]);
  return d >= 10 && d <= 30 ? Math.min(MAX_DIAMETER, Math.max(MIN_DIAMETER, d)) : null;
}

// ---------------------------------------------------------------------------
// Seasons: periods are «MM-DD»…«MM-DD» and may wrap the new year.
// ---------------------------------------------------------------------------
export const MONTH_DAY_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** «15.10», «15. 10.», «15/10» typed by an owner → «10-15»; null when it is not a date. */
export function parseDayMonth(raw: string): string | null {
  const m = /^\s*(\d{1,2})\s*[./-]\s*(\d{1,2})\s*\.?\s*$/.exec(raw);
  if (!m) return null;
  const md = `${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  return MONTH_DAY_RE.test(md) ? md : null;
}

const inPeriod = (s: SeasonPeriod, md: string) => (s.from <= s.to ? md >= s.from && md <= s.to : md >= s.from || md <= s.to);

/** The season covering a date (YYYY-MM-DD), if any. */
export const seasonOn = (seasons: SeasonPeriod[], isoDate: string): SeasonPeriod | null => seasons.find(s => inPeriod(s, isoDate.slice(5))) ?? null;

/** The booking horizon on a date: shortened while a season with its own horizon runs. */
export function effectiveHorizon(baseDays: number, seasons: SeasonPeriod[], isoDate: string): number {
  const s = seasonOn(seasons, isoDate);
  return s?.horizonDays ? Math.min(baseDays, s.horizonDays) : baseDays;
}

const addDaysIso = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** The running season or the next one: its start/end dates and days until it starts (0 while it runs). */
export function currentOrNextSeason(seasons: SeasonPeriod[], isoDate: string): {season: SeasonPeriod; start: string; end: string; startsInDays: number} | null {
  for (let i = 0; i <= 366; i++) {
    const day = addDaysIso(isoDate, i);
    const s = seasonOn(seasons, day);
    if (!s) continue;
    // Walk back to the first day of this period and forward to its last day.
    let start = day;
    while (seasonOn([s], addDaysIso(start, -1)) && start > addDaysIso(day, -366)) start = addDaysIso(start, -1);
    let end = day;
    while (seasonOn([s], addDaysIso(end, 1)) && end < addDaysIso(day, 366)) end = addDaysIso(end, 1);
    return {season: s, start, end, startsInDays: i};
  }
  return null;
}

// ---------------------------------------------------------------------------
// Assistant: price questions such as «Kolik stojí přezutí alu R17 na SUV?»
// ---------------------------------------------------------------------------
const deaccent = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l');

export type ParsedTireQuestion = {vehicle?: Vehicle; rim?: Rim; diameter?: number; wheels?: number};

export function parseTireQuestion(text: string): ParsedTireQuestion {
  const t = ` ${deaccent(text)} `;
  const out: ParsedTireQuestion = {};
  // `\b` does not see Cyrillic letters, so word starts are «not after a Latin letter or digit».
  if (/(?<![a-z0-9])(suv|4x4|4×4|terenn|offroad|crossover|внедорож|кроссовер|джип)/.test(t)) out.vehicle = 'suv';
  else if (/(?<![a-z0-9])(dodav|uzitk|van(?![a-z])|bus(?:ie|u|em|y|a)?(?![a-z])|transporter|dostawcz|бус|фургон|микроавтобус|коммерч)/.test(t)) out.vehicle = 'van';
  else if (/(?<![a-z0-9])(osobn|osobow|легков|car(?![a-z]))/.test(t)) out.vehicle = 'car';
  if (/(?<![a-z0-9])(alu|hlinik|liten|литы|алюм)/.test(t)) out.rim = 'alloy';
  else if (/(?<![a-z0-9])(plech|ocel|stal|штамп|желез|сталь)/.test(t)) out.rim = 'steel';
  const d = /(?<![a-z0-9])r\s?(\d{2})(?!\d)/.exec(t) ?? /(?<![a-z0-9])(\d{2})\s?(?:"|″|''|palc|cal|col|дюйм)/.exec(t);
  if (d) {
    const n = Number(d[1]);
    if (n >= 10 && n <= 30) out.diameter = Math.min(MAX_DIAMETER, Math.max(MIN_DIAMETER, n));
  }
  const w = /(?<![a-z0-9])([1-8])\s?(?:kol|pneu|kol|колес|шин|ks)/.exec(t);
  if (w) out.wheels = Number(w[1]);
  return out;
}

/** Does the text look like a tyre price question (diameter, rim or tyre words)? */
export const looksLikeTireQuestion = (text: string): boolean =>
  /(?<![a-z0-9])(r\s?\d{2}(?!\d)|\d{2}\s?(?:"|″|palc|cal|дюйм)|alu(?![a-z])|plech|pneu|kol[ao]?(?![a-z])|disk|prezut|prezout|vyvaz|defekt|uskladn|opon|felg|шин|колес|диск|переобув|балансир|wulkaniz)/.test(
    ` ${deaccent(text)} `,
  );
