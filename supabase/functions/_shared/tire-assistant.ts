/**
 * The assistant and the tyre price matrix: the `quote_tire` tool for the model
 * and the template answer of the no-model fallback for questions such as
 * «Kolik stojí přezutí alu R17 na SUV?». Both read the studio's own matrix
 * (public_get_tenant → tire) and never invent a price.
 */
import type {Lang} from './lang.ts';
import {matchServices} from './router.ts';
import {duration, money} from './text.ts';
import {
  DIAMETERS,
  RIMS,
  VEHICLES,
  looksLikeTireQuestion,
  operationFor,
  parseTireQuestion,
  priceRange,
  quote,
  quoteLabel,
  type Rim,
  type TireConfig,
  type TireOperation,
  type Vehicle,
} from './tire.ts';

type Svc = {id: string; key?: string; name: string; category?: string; duration_minutes: number};
export type TireTenant = {currency: string; services: Svc[]; tire?: TireConfig | null};

const T: Record<Lang, {onRequest: string; approx: string; forSet: string; perJob: string; outro: string; which: string; noTire: string}> = {
  ru: {onRequest: 'цена по запросу', approx: 'около', forSet: 'за комплект', perJob: 'за работу', outro: 'Точную цену и свободное время покажет калькулятор при записи.', which: 'Цены шиномонтажа (комплект из 4 колёс):', noTire: 'Калькулятора шиномонтажа в этой студии нет.'},
  cs: {onRequest: 'cena na dotaz', approx: 'cca', forSet: 'za sadu', perJob: 'za práci', outro: 'Přesnou cenu i volný termín ukáže kalkulačka při objednání.', which: 'Ceny pneuservisu (sada 4 kol):', noTire: 'Tento servis kalkulačku pneuservisu nemá.'},
  pl: {onRequest: 'cena do ustalenia', approx: 'ok.', forSet: 'za komplet', perJob: 'za usługę', outro: 'Dokładną cenę i wolny termin pokaże kalkulator przy rezerwacji.', which: 'Ceny wulkanizacji (komplet 4 kół):', noTire: 'Ten serwis nie ma kalkulatora wulkanizacji.'},
  de: {onRequest: 'Preis auf Anfrage', approx: 'ca.', forSet: 'pro Satz', perJob: 'pro Arbeit', outro: 'Den genauen Preis und freie Termine zeigt der Rechner bei der Buchung.', which: 'Preise Reifenservice (Satz mit 4 Rädern):', noTire: 'Dieses Studio hat keinen Reifenrechner.'},
  uk: {onRequest: 'ціна за запитом', approx: 'близько', forSet: 'за комплект', perJob: 'за роботу', outro: 'Точну ціну й вільний час покаже калькулятор під час запису.', which: 'Ціни шиномонтажу (комплект із 4 коліс):', noTire: 'Калькулятора шиномонтажу в цьому сервісі немає.'},
};

const ops = (t: TireTenant): {service: Svc; op: TireOperation}[] =>
  t.services.flatMap(s => {
    const op = s.key ? operationFor(t.tire, s.key) : undefined;
    return op ? [{service: s, op}] : [];
  });

export type QuoteArgs = {service_id?: string | null; vehicle?: Vehicle | null; rim?: Rim | null; diameter?: number | null; wheels?: number | null};

/**
 * Tool result: exact quotes when vehicle, rim and diameter are known, price
 * ranges over the diameters otherwise. Unknown dimensions are expanded (both
 * rim types, all vehicles) so the model never has to guess.
 */
export function tireQuoteTool(t: TireTenant, a: QuoteArgs) {
  if (!t.tire) return {error: 'no tyre price matrix'};
  const chosen = ops(t).filter(o => !a.service_id || o.service.id === a.service_id);
  const vehicles = a.vehicle ? [a.vehicle] : [...VEHICLES];
  const rims = a.rim ? [a.rim] : [...RIMS];
  const wheels = a.wheels ?? t.tire.defaultWheels;
  return {
    currency: t.currency,
    note: 'price 0 with on_request=true means «price on request»; set prices scale with the number of wheels',
    quotes: chosen.flatMap(({service, op}) =>
      vehicles.flatMap(vehicle =>
        (op.unit === 'job' && !a.rim ? (['steel'] as Rim[]) : rims).map(rim => {
          if (a.diameter) {
            const q = quote(op, {vehicle, rim, diameter: a.diameter, wheels}, service.duration_minutes);
            return {service_id: service.id, label: quoteLabel(service.name, op, {vehicle, rim, diameter: a.diameter, wheels}, t.tire!.names), price: q.price, on_request: q.onRequest, duration_minutes: q.durationMinutes};
          }
          const r = priceRange(op, vehicle, op.unit === 'job' && !a.rim ? undefined : rim);
          return {service_id: service.id, label: `${service.name} — ${t.tire!.names.vehicles[vehicle]}${op.unit === 'set' ? `, ${t.tire!.names.rims[rim]}` : ''}`, price_min: r?.min ?? 0, price_max: r?.max ?? 0, partly_on_request: r?.onRequest ?? true};
        }),
      ),
    ),
  };
}

/** One line for the system prompt of a studio with a tyre matrix, in its language. */
export const TIRE_PROMPT: Record<Lang, string> = {
  ru: 'Цены шиномонтажа считай ТОЛЬКО инструментом quote_tire (vehicle: car | suv | van, rim: steel | alloy, diameter 13–22, wheels). Не пересчитывай цены сам; price 0 с on_request = цена по запросу.',
  cs: 'Ceny pneuservisu počítej POUZE nástrojem quote_tire (vehicle: car | suv | van, rim: steel | alloy, diameter 13–22, wheels). Ceny sám nepřepočítávej; price 0 s on_request = cena na dotaz. Odpovídej česky.',
  pl: 'Ceny wulkanizacji licz WYŁĄCZNIE narzędziem quote_tire (vehicle: car | suv | van, rim: steel | alloy, diameter 13–22, wheels). Nie przeliczaj cen sam; price 0 z on_request = cena do ustalenia.',
  de: 'Preise für den Reifenservice berechnest du NUR mit quote_tire (vehicle: car | suv | van, rim: steel | alloy, diameter 13–22, wheels). Rechne Preise nicht selbst um; price 0 mit on_request = Preis auf Anfrage. Antworte auf Deutsch.',
  uk: 'Ціни шиномонтажу рахуй ЛИШЕ інструментом quote_tire (vehicle: car | suv | van, rim: steel | alloy, diameter 13–22, wheels). Не перераховуй ціни сам; price 0 з on_request = ціна за запитом.',
};

const PRICE_WORDS = /(kolik|cena|cen[uy]|stoj|cenik|сколько|цен|стоит|стоим|ile|koszt|cennik|скільки|варт|price|cost)/;
const TIME_WORDS = /(kdy |volno|volny|termin|когда|время|окно|kiedy|wolny|termin|коли|вільн)/;
const deaccent = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Template answer to a tyre price question, or null when the text is not one. */
export function tireFallbackAnswer(t: TireTenant, text: string, lang: Lang): {text: string; data: unknown} | null {
  if (!t.tire || !looksLikeTireQuestion(text)) return null;
  const n = deaccent(text);
  const p = parseTireQuestion(text);
  if (!PRICE_WORDS.test(n) && !(p.diameter && !TIME_WORDS.test(n))) return null;
  const say = T[lang];
  const all = ops(t);
  const named = matchServices(text, all.map(o => o.service), lang, true).map(s => s.id);
  // «přezutí» alone means the swap of complete wheels: the first operation of the matrix.
  const swap = /(prezut|prezout|переобу|wymian|перевзу)/.test(n) && !/(disk na disk|z disku|z felgi|с диска)/.test(n);
  const chosen = named.length ? all.filter(o => o.service.id === named[0]) : swap ? all.slice(0, 1) : all;
  const wheels = p.wheels ?? t.tire.defaultWheels;
  const fmt = (price: number, onRequest: boolean) => (onRequest ? say.onRequest : money(price, t.currency, lang));
  const lines: string[] = [];
  for (const {service, op} of chosen) {
    const vehicles = p.vehicle ? [p.vehicle] : chosen.length === 1 ? [...VEHICLES] : (['car'] as Vehicle[]);
    const rims = op.unit === 'job' ? (['steel'] as Rim[]) : p.rim ? [p.rim] : [...RIMS];
    for (const vehicle of vehicles)
      for (const rim of rims) {
        if (p.diameter) {
          const q = quote(op, {vehicle, rim, diameter: p.diameter, wheels}, service.duration_minutes);
          lines.push(`${quoteLabel(service.name, op, {vehicle, rim, diameter: p.diameter, wheels}, t.tire.names)}: ${fmt(q.price, q.onRequest)}, ${say.approx} ${duration(q.durationMinutes, lang)}`);
        } else {
          const r = priceRange(op, vehicle, op.unit === 'job' ? undefined : rim);
          const range = !r || (!r.min && !r.max) ? say.onRequest : r.min === r.max ? money(r.min, t.currency, lang) : `${money(r.min, t.currency, lang)} – ${money(r.max, t.currency, lang)}`;
          const what = op.unit === 'set' ? `${t.tire.names.vehicles[vehicle]}, ${t.tire.names.rims[rim]} R${DIAMETERS[0]}–R${DIAMETERS.at(-1)}` : t.tire.names.vehicles[vehicle];
          lines.push(`${service.name} — ${what}: ${range} ${op.unit === 'set' ? say.forSet : say.perJob}`);
        }
      }
  }
  if (!lines.length) return null;
  const body = lines.length === 1 ? `${lines[0]}.` : `${p.diameter ? '' : `${say.which}\n`}${lines.slice(0, 8).join('\n')}`;
  return {text: `${body}\n${say.outro}`, data: {tire: p}};
}
