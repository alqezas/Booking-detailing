/**
 * The assistants and beauty studios: add-on prices («сколько стоит маникюр
 * со снятием?»), masters and free windows of the owner. Every number comes
 * from the studio data handed in (public card or SQL); nothing is invented.
 */
import {addonsQuote, type AddonDef} from './beauty.ts';
import type {Lang} from './lang.ts';
import {matchServices} from './router.ts';
import {duration, money, norm} from './text.ts';

type Svc = {id: string; name: string; category?: string; price: number; price_from: boolean; duration_minutes: number; addons?: AddonDef[]; resource_ids?: string[]};
type Master = {id: string; name: string; role: string; title: string};
export type BeautyTenant = {kind?: string; currency: string; services: Svc[]; resources?: Master[]};

export const isBeauty = (t: {kind?: string}) => t.kind === 'beauty';

export const BEAUTY_PROMPT: Record<Lang, string> = {
  ru: 'Это бьюти-студия. Цену услуги с дополнительными опциями считай ТОЛЬКО инструментом quote_beauty (addons — ключи опций из list_services). Мастеров узнавай через list_masters. В find_free_slots передавай addons и master_id, если клиент их назвал. Не говори про машины.',
  uk: 'Це бʼюті-студія. Ціну послуги з додатковими опціями рахуй ЛИШЕ інструментом quote_beauty (addons — ключі опцій із list_services). Майстрів дізнавайся через list_masters. У find_free_slots передавай addons і master_id, якщо клієнт їх назвав. Відповідай українською.',
  cs: 'Jde o kosmetické studio. Cenu služby s doplňky počítej POUZE nástrojem quote_beauty (addons = klíče doplňků z list_services). Mistry zjisti přes list_masters. Do find_free_slots předej addons a master_id, pokud je klient uvedl.',
  de: 'Das ist ein Beauty-Studio oder Barbershop. Den Preis einer Leistung mit Extras berechnest du NUR mit dem Werkzeug quote_beauty (addons = Schlüssel der Extras aus list_services). Das Team findest du über list_masters. Gib addons und master_id an find_free_slots weiter, wenn der Kunde sie genannt hat. Antworte auf Deutsch.',
  pl: 'To salon beauty. Cenę usługi z opcjami licz WYŁĄCZNIE narzędziem quote_beauty (addons = klucze opcji z list_services). Specjalistki sprawdzaj przez list_masters. Do find_free_slots przekaż addons i master_id, jeśli klient je podał.',
};

export const BEAUTY_OWNER_PROMPT: Record<Lang, string> = {
  ru: 'Это бьюти-студия: вместо машин — клиенты и визиты. Свободные окна считай только инструментом count_free_slots.',
  uk: 'Це бʼюті-студія: замість машин — клієнти й візити. Вільні вікна рахуй лише інструментом count_free_slots.',
  cs: 'Jde o kosmetické studio: místo aut jsou klienti a návštěvy. Volné termíny počítej jen nástrojem count_free_slots.',
  de: 'Das ist ein Beauty-Studio oder Barbershop: statt Autos gibt es Kunden und Besuche. Freie Termine zählst du nur mit dem Werkzeug count_free_slots.',
  pl: 'To salon beauty: zamiast aut są klienci i wizyty. Wolne okienka licz tylko narzędziem count_free_slots.',
};

const T: Record<Lang, {with: string; total: string; outro: string; free: (n: number, period: string) => string; first: (s: string, when: string) => string; none: (period: string) => string}> = {
  ru: {
    with: ' + ',
    total: 'итого',
    outro: 'Время и мастера — на шаге выбора времени при записи.',
    free: (n, p) => `Свободных окон ${p}: ${n} (по началу записи, с учётом смен мастеров и уже занятых часов).`,
    first: (s, w) => `${s}: ближайшее ${w}`,
    none: p => `Свободных окон ${p} нет.`,
  },
  uk: {
    with: ' + ',
    total: 'разом',
    outro: 'Час і майстрів оберете під час запису.',
    free: (n, p) => `Вільних вікон ${p}: ${n} (за часом початку запису, з урахуванням змін майстрів і зайнятих годин).`,
    first: (s, w) => `${s}: найближче ${w}`,
    none: p => `Вільних вікон ${p} немає.`,
  },
  cs: {
    with: ' + ',
    total: 'celkem',
    outro: 'Čas a mistra vyberete při rezervaci.',
    free: (n, p) => `Volných termínů ${p}: ${n} (podle začátku, se směnami mistrů a obsazenými hodinami).`,
    first: (s, w) => `${s}: nejbližší ${w}`,
    none: p => `${p} nejsou volné termíny.`,
  },
  pl: {
    with: ' + ',
    total: 'razem',
    outro: 'Godzinę i specjalistkę wybierzesz przy rezerwacji.',
    free: (n, p) => `Wolnych okienek ${p}: ${n} (według godziny rozpoczęcia, z grafikami i zajętymi godzinami).`,
    first: (s, w) => `${s}: najbliższe ${w}`,
    none: p => `Brak wolnych okienek ${p}.`,
  },
  de: {
    with: ' + ',
    total: 'gesamt',
    outro: 'Uhrzeit und Person wählen Sie bei der Buchung.',
    free: (n, p) => `Freie Termine ${p}: ${n} (nach Beginnzeit, mit Schichten und belegten Stunden).`,
    first: (s, w) => `${s}: nächster ${w}`,
    none: p => `${p} gibt es keine freien Termine.`,
  },
};

export type BeautyQuoteArgs = {service_id?: string | null; addons?: string[] | null};

/** Tool result: price and time of a service with the chosen options, and the options offered. */
export function beautyQuoteTool(t: BeautyTenant, a: BeautyQuoteArgs) {
  const list = t.services.filter(s => !a.service_id || s.id === a.service_id);
  return {
    currency: t.currency,
    quotes: list.map(s => {
      const q = addonsQuote({...s, addons: s.addons ?? []}, a.addons ?? []);
      return {
        service_id: s.id,
        service: s.name,
        options: q.addons.map(x => x.name),
        price: q.price,
        price_from: q.price_from,
        duration_minutes: q.duration_minutes,
        unknown_options: q.unknown,
        offered_options: (s.addons ?? []).map(x => ({key: x.key, name: x.name, price: x.price, minutes: x.duration_minutes})),
      };
    }),
  };
}

export function mastersList(t: BeautyTenant) {
  const masters = (t.resources ?? []).filter(r => r.role === 'master');
  return masters.map(m => ({
    id: m.id,
    name: m.name,
    title: m.title,
    services: t.services.filter(s => !s.resource_ids || s.resource_ids.includes(m.id)).map(s => s.name),
  }));
}

/** Options named in the text: every significant word of an option (stem of 5 letters) found in the text. */
export function addonsOfText(text: string, addons: AddonDef[], lang: Lang, ignore: string[] = []): string[] {
  const t = norm(text, lang);
  // Words of the service itself («покрытием» in «маникюр с покрытием») are not options.
  const skip = new Set(ignore.flatMap(x => norm(x, lang).split(/\s+/)).filter(w => w.length >= 4).map(w => w.slice(0, 5)));
  const words = t.split(/\s+/).filter(w => w && !skip.has(w.slice(0, 5)));
  return addons
    .filter(a => {
      const stems = norm(a.name, lang)
        .split(/\s+/)
        .filter(w => w.length >= 4)
        .map(w => w.slice(0, 5));
      return stems.length > 0 && stems.some(s => words.some(w => w.startsWith(s)));
    })
    .map(a => a.key);
}

const PRICE_WORDS = /(сколько|цен|стоит|стоим|скільки|варт|кошту|kolik|cena|stoj|ile|koszt|price|cost|kostet|kosten|preis|wie ?viel)/;

/** Template answer to a price question naming a service (and maybe options), or null. */
export function beautyFallbackAnswer(t: BeautyTenant, text: string, lang: Lang): {text: string; data: unknown} | null {
  if (!isBeauty(t) || !PRICE_WORDS.test(norm(text, lang))) return null;
  const named = matchServices(text, t.services, lang, true);
  if (!named.length) return null;
  const say = T[lang];
  const lines = named.slice(0, 4).map(ref => {
    const s = t.services.find(x => x.id === ref.id)!;
    const keys = addonsOfText(text, s.addons ?? [], lang, [s.name]);
    const q = addonsQuote({...s, addons: s.addons ?? []}, keys);
    const price = `${q.price_from ? '≥ ' : ''}${money(q.price, t.currency, lang)}`;
    const label = q.addons.length ? `${s.name}${say.with}${q.addons.map(a => a.name.toLowerCase()).join(', ')}` : s.name;
    return {line: `${label} — ${price}, ${duration(q.duration_minutes, lang)}`, service_id: s.id, addons: keys};
  });
  return {text: `${lines.map(l => l.line).join('\n')}\n${say.outro}`, data: {beauty: lines.map(l => ({service_id: l.service_id, addons: l.addons}))}};
}

export type FreeSummary = {from_date: string; to_date: string; timezone?: string; services: {service_id: string; service_name: string; free_starts: number; first_free: string | null}[]};

/** Owner: «how many free windows this week?» from owner_free_slot_summary. */
export function freeSlotsAnswer(s: FreeSummary, periodLabel: string, lang: Lang, when: (iso: string) => string): string {
  const say = T[lang];
  const total = s.services.reduce((n, x) => n + x.free_starts, 0);
  if (!total) return say.none(periodLabel);
  const lines = s.services
    .filter(x => x.free_starts > 0)
    .slice(0, 6)
    .map(x => `${say.first(x.service_name, x.first_free ? when(x.first_free) : '—')} (${x.free_starts})`);
  return `${say.free(total, periodLabel)}\n${lines.join('\n')}`;
}

export const FREE_WORDS = /(свободн|окон|окн|вільн|вікн|вікон|volnych|volne|termin|wolnych|wolne|okien|okienek)/;
