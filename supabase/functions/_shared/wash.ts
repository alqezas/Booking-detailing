/**
 * Car wash price list: a program priced by car class plus optional extras,
 * shared by the site, the assistants and the tests. The database mirrors the
 * same rules in private.wash_quote (tests/integration/wash-sql-check.ts
 * compares both).
 *
 *   price    = program price for the class + every chosen extra for the class;
 *   duration = the same sum of minutes, rounded up to 5, at least 15;
 *   a class without a price (null or missing) in the program or in a chosen
 *   extra makes the whole quote «price on request» (stored as 0).
 *
 * Peak hours are a separate, generic rule (any studio): during a peak window
 * online booking is either closed (walk-ins only) or limited to N parallel
 * online bookings; the owner cabinet is never limited.
 */
export const CAR_CLASSES = ['small', 'medium', 'suv', 'van'] as const;
export type CarClass = (typeof CAR_CLASSES)[number];

export type ClassPrice = {price: number | null; minutes: number};
export type WashProgram = {service: string; prices: Partial<Record<CarClass, ClassPrice>>};
export type WashExtra = {key: string; name: string; prices: Partial<Record<CarClass, ClassPrice>>; programs?: string[]};
export type WashConfig = {classes: Record<CarClass, string>; programs: WashProgram[]; extras: WashExtra[]; plateRequired: boolean};
export type WashParams = {class: CarClass; extras: string[]};
export type WashQuote = {price: number; onRequest: boolean; durationMinutes: number};

export const programFor = (config: WashConfig | null | undefined, serviceKey: string): WashProgram | undefined =>
  config?.programs.find(p => p.service === serviceKey);

/** Extras offered with a program, in the order of the price list. */
export const extrasFor = (config: WashConfig, serviceKey: string): WashExtra[] =>
  config.extras.filter(e => !e.programs || e.programs.includes(serviceKey));

/** Keeps only known extras allowed with the program, once each, in price-list order. */
export function cleanExtras(config: WashConfig, serviceKey: string, extras: string[]): WashExtra[] {
  const wanted = new Set(extras);
  return extrasFor(config, serviceKey).filter(e => wanted.has(e.key));
}

export function washQuote(config: WashConfig, program: WashProgram, p: WashParams, baseMinutes: number): WashQuote {
  const row = program.prices[p.class];
  let onRequest = !row || row.price === null;
  let price = row?.price ?? 0;
  let minutes = row ? row.minutes : baseMinutes;
  for (const e of cleanExtras(config, program.service, p.extras)) {
    const x = e.prices[p.class];
    if (!x || x.price === null) onRequest = true;
    price += x?.price ?? 0;
    minutes += x?.minutes ?? 0;
  }
  return {price: onRequest ? 0 : price, onRequest, durationMinutes: Math.max(15, Math.ceil(minutes / 5) * 5)};
}

/** «Kompletní mytí — SUV / MPV + Tvrdý vosk, Ozon»: the name a booking keeps. */
export function washLabelFor(serviceName: string, serviceKey: string, config: WashConfig, p: WashParams): string {
  const names = cleanExtras(config, serviceKey, p.extras).map(e => e.name);
  return `${serviceName} — ${config.classes[p.class]}${names.length ? ` + ${names.join(', ')}` : ''}`.slice(0, 120);
}

/** Lowest and highest program price over the classes, for the price list. */
export function programRange(program: WashProgram): {min: number; max: number; onRequest: boolean} {
  const priced = CAR_CLASSES.map(c => program.prices[c]?.price).filter((x): x is number => typeof x === 'number');
  return {min: priced.length ? Math.min(...priced) : 0, max: priced.length ? Math.max(...priced) : 0, onRequest: priced.length < CAR_CLASSES.length};
}

// ---------------------------------------------------------------------------
// Peak hours (generic)
// ---------------------------------------------------------------------------
export type PeakRule = {days: number[]; from: string; to: string; mode: 'walkin' | 'limit'; posts?: number | null};

/** The peak rule for a local ISO weekday (1 = Monday) and «HH:MM» start time, if any. */
export const peakAt = (rules: PeakRule[], isoWeekday: number, hhmm: string): PeakRule | null =>
  rules.find(r => r.days.includes(isoWeekday) && hhmm >= r.from && hhmm < r.to) ?? null;

// ---------------------------------------------------------------------------
// Assistant: «Kolik stojí kompletní mytí SUV s voskem?»
// ---------------------------------------------------------------------------
const deaccent = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l');

/** The car class named in a question, if any. */
export function classOfText(text: string): CarClass | undefined {
  const t = ` ${deaccent(text)} `;
  if (/(?<![a-z0-9])(suv|mpv|4x4|kombi suv|terenn|crossover|внедорож|кроссовер|джип)/.test(t)) return 'suv';
  if (/(?<![a-z0-9])(dodav|uzitk|van(?![a-z])|bus(?:ie|u|em|y|a)?(?![a-z])|dostawcz|фургон|микроавтобус|бус)/.test(t)) return 'van';
  if (/(?<![a-z0-9])(stredn|sredni|kombi|sedan|средн|седан|середн)/.test(t)) return 'medium';
  if (/(?<![a-z0-9])(mal[eya]|male auto|mestsk|maly|small|мален|малый|малолит|мал[аеі]|малень)/.test(t)) return 'small';
  return undefined;
}

/**
 * Extras named in the question: a word of the extra's name (first four letters)
 * appears in the text. Words shared with program names («mytí», «čištění») do
 * not count, or «kompletní mytí» would add «mytí kol».
 */
export function extrasOfText(text: string, extras: WashExtra[], programNames: string[] = []): string[] {
  const t = deaccent(text);
  const stem4 = (w: string) => w.slice(0, 4);
  const generic = new Set(programNames.flatMap(n => deaccent(n).split(/[^a-z0-9а-яёіїєґ]+/)).filter(w => w.length >= 3).map(stem4));
  const words = t.split(/[^a-z0-9а-яёіїєґ]+/).filter(w => w.length >= 3);
  return extras
    .filter(e => {
      const nameWords = deaccent(e.name)
        .split(/[^a-z0-9а-яёіїєґ]+/)
        .filter(w => w.length >= 4 && !generic.has(stem4(w)));
      return nameWords.some(n => words.some(w => stem4(w) === stem4(n)));
    })
    .map(e => e.key);
}
