/**
 * Interface language of the current studio.
 *
 * The app shows one studio at a time, so the catalogue is a module-level live
 * binding: `msg.home.book` anywhere reads the active language. TenantRoot
 * switches it from the studio's `locale` before rendering anything below it;
 * screens shown before the studio is known follow the browser language.
 */
import {cs} from './cs.ts';
import {pl} from './pl.ts';
import {ru, type Messages} from './ru.ts';
import {uk} from './uk.ts';

export type {Messages};
export type Lang = Messages['lang'];

const CATALOGUES: Record<Lang, Messages> = {ru, cs, pl, uk};

export let msg: Messages = ru;

export const langOf = (locale: string | null | undefined): Lang => {
  const l = locale?.toLowerCase() ?? '';
  return l.startsWith('cs') ? 'cs' : l.startsWith('pl') ? 'pl' : l.startsWith('uk') ? 'uk' : 'ru';
};

export function setLang(lang: Lang): void {
  if (msg.lang === lang) return;
  msg = CATALOGUES[lang];
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}

/** Before a studio is loaded: the browser's language. */
export const browserLang = (): Lang => langOf(typeof navigator === 'undefined' ? null : navigator.language);
