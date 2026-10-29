/**
 * The assistant and the car-wash price list: the `quote_wash` tool for the
 * model and the template answer of the no-model fallback for questions such as
 * «Kolik stojí kompletní mytí SUV s voskem?». Both read the studio's own list
 * (public_get_tenant → wash) and never invent a price.
 */
import type {Lang} from './lang.ts';
import {matchServices} from './router.ts';
import {duration, money} from './text.ts';
import {CAR_CLASSES, classOfText, extrasFor, extrasOfText, programFor, washLabelFor, washQuote, type CarClass, type WashConfig} from './wash.ts';

type Svc = {id: string; key?: string; name: string; category?: string; duration_minutes: number};
export type WashTenant = {currency: string; services: Svc[]; wash?: WashConfig | null};

const T: Record<Lang, {onRequest: string; approx: string; outro: string; which: string}> = {
  ru: {onRequest: 'цена по запросу', approx: 'около', outro: 'Точную цену и свободное время покажет калькулятор при записи.', which: 'Цены мойки:'},
  cs: {onRequest: 'cena na dotaz', approx: 'cca', outro: 'Přesnou cenu i volný termín ukáže kalkulačka při objednání.', which: 'Ceny mytí:'},
  pl: {onRequest: 'cena do ustalenia', approx: 'ok.', outro: 'Dokładną cenę i wolny termin pokaże kalkulator przy rezerwacji.', which: 'Ceny mycia:'},
  uk: {onRequest: 'ціна за запитом', approx: 'близько', outro: 'Точну ціну й вільний час покаже калькулятор під час запису.', which: 'Ціни мийки:'},
};

export const WASH_PROMPT: Record<Lang, string> = {
  ru: 'Цены мойки считай ТОЛЬКО инструментом quote_wash (class: small | medium | suv | van, extras — ключи дополнений). Не пересчитывай цены сам; price 0 с on_request = цена по запросу.',
  cs: 'Ceny mytí počítej POUZE nástrojem quote_wash (class: small | medium | suv | van, extras = klíče doplňků). Ceny sám nepřepočítávej; price 0 s on_request = cena na dotaz. Odpovídej česky.',
  pl: 'Ceny mycia licz WYŁĄCZNIE narzędziem quote_wash (class: small | medium | suv | van, extras = klucze dodatków). Nie przeliczaj cen sam; price 0 z on_request = cena do ustalenia.',
  uk: 'Ціни мийки рахуй ЛИШЕ інструментом quote_wash (class: small | medium | suv | van, extras — ключі доповнень). Не перераховуй ціни сам; price 0 з on_request = ціна за запитом.',
};

const programs = (t: WashTenant) =>
  t.services.flatMap(s => {
    const p = s.key ? programFor(t.wash, s.key) : undefined;
    return p ? [{service: s, program: p}] : [];
  });

export type WashArgs = {service_id?: string | null; class?: CarClass | null; extras?: string[] | null};

/** Tool result: quotes for the chosen program(s) and class(es), plus the extras offered with each. */
export function washQuoteTool(t: WashTenant, a: WashArgs) {
  if (!t.wash) return {error: 'no wash price list'};
  const wash = t.wash;
  const classes = a.class ? [a.class] : [...CAR_CLASSES];
  return {
    currency: t.currency,
    note: 'price 0 with on_request=true means «price on request»',
    quotes: programs(t)
      .filter(p => !a.service_id || p.service.id === a.service_id)
      .flatMap(({service, program}) =>
        classes.map(c => {
          const params = {class: c, extras: a.extras ?? []};
          const q = washQuote(wash, program, params, service.duration_minutes);
          return {service_id: service.id, label: washLabelFor(service.name, program.service, wash, params), price: q.price, on_request: q.onRequest, duration_minutes: q.durationMinutes};
        }),
      ),
    extras: Object.fromEntries(programs(t).map(p => [p.service.id, extrasFor(wash, p.program.service).map(e => ({key: e.key, name: e.name}))])),
  };
}

const PRICE_WORDS = /(kolik|cena|cen[uy]|stoj|cenik|сколько|цен|стоит|стоим|ile|koszt|cennik|скільки|варт|price|cost)/;
const deaccent = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Template answer to a wash price question, or null when the text is not one. */
export function washFallbackAnswer(t: WashTenant, text: string, lang: Lang): {text: string; data: unknown} | null {
  if (!t.wash || !PRICE_WORDS.test(deaccent(text))) return null;
  const wash = t.wash;
  const all = programs(t);
  const named = matchServices(text, all.map(p => p.service), lang, true).map(s => s.id);
  const cls = classOfText(text);
  const extras = extrasOfText(text, wash.extras, all.map(p => p.service.name));
  if (!named.length && !cls && !extras.length) return null;
  const say = T[lang];
  const chosen = named.length ? all.filter(p => p.service.id === named[0]) : all;
  const classes = cls ? [cls] : named.length ? [...CAR_CLASSES] : (['medium'] as CarClass[]);
  const lines = chosen.flatMap(({service, program}) =>
    classes.map(c => {
      const params = {class: c, extras};
      const q = washQuote(wash, program, params, service.duration_minutes);
      return `${washLabelFor(service.name, program.service, wash, params)}: ${q.onRequest ? say.onRequest : money(q.price, t.currency, lang)}, ${say.approx} ${duration(q.durationMinutes, lang)}`;
    }),
  );
  if (!lines.length) return null;
  const body = lines.length === 1 ? `${lines[0]}.` : `${say.which}\n${lines.slice(0, 8).join('\n')}`;
  return {text: `${body}\n${say.outro}`, data: {wash: {class: cls ?? null, extras}}};
}
