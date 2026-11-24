/**
 * Interface language of the current studio.
 *
 * The app shows one studio at a time, so the catalogue is a module-level live
 * binding: `msg.home.book` anywhere reads the active language. TenantRoot
 * switches it from the studio's `locale` before rendering anything below it;
 * screens shown before the studio is known follow the browser language.
 */
import {cs} from './cs.ts';
import {de} from './de.ts';
import {pl} from './pl.ts';
import {ru, type Messages} from './ru.ts';
import {uk} from './uk.ts';
import {BEAUTY_OVERRIDES, mergeMessages} from './beauty-overrides.ts';
import {BARBER_MAIN} from './barber.ts';

export type {Messages};
export type Lang = Messages['lang'];

const CATALOGUES: Record<Lang, Messages> = {ru, cs, pl, uk, de};

export let msg: Messages = ru;

export const langOf = (locale: string | null | undefined): Lang => {
  const l = locale?.toLowerCase() ?? '';
  return l.startsWith('cs') ? 'cs' : l.startsWith('pl') ? 'pl' : l.startsWith('uk') ? 'uk' : l.startsWith('de') ? 'de' : 'ru';
};

let current = 'ru';
const beautyCache = new Map<string, Messages>();
/** Studio vocabulary on top of the kind: 'barber' for barbershops (beauty kind). */
export let vocabulary: 'barber' | null = null;

/**
 * Switches the catalogue. `kind` = studio kind: beauty studios get their own
 * words (master instead of bay, client instead of car) merged over the language.
 */
export function setLang(lang: Lang, kind?: string, vocab?: string | null): void {
  const barber = kind === 'beauty' && vocab === 'barber';
  const id = kind === 'beauty' ? `${lang}:beauty${barber ? ':barber' : ''}` : lang;
  if (current === id) return;
  current = id;
  vocabulary = barber ? 'barber' : null;
  if (kind === 'beauty') {
    let m = beautyCache.get(id);
    if (!m) {
      m = mergeMessages(CATALOGUES[lang], BEAUTY_OVERRIDES[lang]);
      if (barber) m = mergeMessages(m, BARBER_MAIN[lang]);
      beautyCache.set(id, m);
    }
    msg = m;
  } else {
    msg = CATALOGUES[lang];
  }
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}

/** Before a studio is loaded: the browser's language. */
export const browserLang = (): Lang => langOf(typeof navigator === 'undefined' ? null : navigator.language);

const PHONE_HINTS: Record<string, string> = {
  '380': '+380 50 123 4567',
  '420': '+420 777 123 456',
  '43': '+43 664 123 4567',
  '48': '+48 512 345 678',
  '7': '+7 999 123-45-67',
};

/**
 * Beauty studios serve one city: numbers typed without a country code get the
 * studio's own country (a Russian-language studio in Prague expects +420).
 */
export function setPhoneCountry(studioPhone: string): void {
  const cc = Object.keys(PHONE_HINTS)
    .sort((a, b) => b.length - a.length)
    .find(c => studioPhone.startsWith(`+${c}`));
  if (!cc || msg.phoneCountry === cc) return;
  msg = {...msg, phoneCountry: cc, phonePlaceholder: PHONE_HINTS[cc]!};
}
