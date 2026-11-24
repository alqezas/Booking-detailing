/**
 * Telegram notices for the studio owner (new booking, move, cancellation by a
 * client). Pure text building here — sending is in notify-dispatch, with the
 * bot token from the server secret TELEGRAM_BOT_TOKEN only.
 */
import type {Lang} from './lang.ts';
import {money, when} from './text.ts';

export type TgJob = {
  kind: 'tg_new' | 'tg_cancel' | 'tg_moved';
  booking: {
    id: string;
    start_at: string;
    end_at?: string;
    service_name: string;
    price: number;
    price_from?: boolean;
    addons?: {name: string; price: number}[];
    master_choice?: string | null;
    resource_name: string;
    customer_name: string | null;
    customer_phone: string | null;
    comment: string | null;
    cancel_reason?: string | null;
  };
  tenant: {slug: string; name: string; timezone: string; currency: string};
};

const T: Record<Lang, {new: string; cancel: string; moved: string; options: string; master: string; any: string; client: string; wish: string; reason: string; open: string}> = {
  ru: {new: '🆕 Новая запись', cancel: '❌ Клиент отменил запись', moved: '🔁 Клиент перенёс запись', options: 'Опции', master: 'Мастер', any: 'любой свободный', client: 'Клиент', wish: 'Пожелание', reason: 'Причина', open: 'Открыть кабинет'},
  uk: {new: '🆕 Новий запис', cancel: '❌ Клієнт скасував запис', moved: '🔁 Клієнт переніс запис', options: 'Опції', master: 'Майстер', any: 'будь-який вільний', client: 'Клієнт', wish: 'Побажання', reason: 'Причина', open: 'Відкрити кабінет'},
  cs: {new: '🆕 Nová rezervace', cancel: '❌ Klient zrušil rezervaci', moved: '🔁 Klient přesunul rezervaci', options: 'Doplňky', master: 'Mistr', any: 'kdokoli volný', client: 'Klient', wish: 'Přání', reason: 'Důvod', open: 'Otevřít administraci'},
  de: {new: '🆕 Neue Buchung', cancel: '❌ Kunde hat storniert', moved: '🔁 Kunde hat verschoben', options: 'Extras', master: 'Bei', any: 'wer frei ist', client: 'Kunde', wish: 'Wunsch', reason: 'Grund', open: 'Verwaltung öffnen'},
  pl: {new: '🆕 Nowa rezerwacja', cancel: '❌ Klient odwołał wizytę', moved: '🔁 Klient przełożył wizytę', options: 'Opcje', master: 'Specjalistka', any: 'dowolna wolna', client: 'Klient', wish: 'Życzenie', reason: 'Powód', open: 'Otwórz panel'},
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** HTML message (Telegram parse_mode=HTML). Customer data goes only to the owner's own chat. */
export function telegramText(job: TgJob, lang: Lang, siteUrl: string | null): string {
  const say = T[lang];
  const b = job.booking;
  const head = job.kind === 'tg_new' ? say.new : job.kind === 'tg_cancel' ? say.cancel : say.moved;
  const lines = [
    `<b>${esc(head)}</b> · ${esc(job.tenant.name)}`,
    `<b>${esc(b.service_name)}</b>`,
    `🗓 ${esc(when(b.start_at, job.tenant.timezone, undefined, lang))}`,
    `💳 ${esc(`${b.price_from ? '≥ ' : ''}${money(b.price, job.tenant.currency, lang)}`)}`,
  ];
  if (b.addons?.length) lines.push(`${say.options}: ${esc(b.addons.map(a => a.name).join(', '))}`);
  lines.push(`${say.master}: ${esc(b.resource_name)}${b.master_choice === 'any' ? ` (${say.any})` : ''}`);
  if (b.customer_name) lines.push(`${say.client}: ${esc(b.customer_name)}${b.customer_phone ? `, ${esc(b.customer_phone)}` : ''}`);
  if (b.comment) lines.push(`${say.wish}: ${esc(b.comment)}`);
  if (job.kind === 'tg_cancel' && b.cancel_reason) lines.push(`${say.reason}: ${esc(b.cancel_reason)}`);
  if (siteUrl) lines.push(`<a href="${esc(`${siteUrl.replace(/\/$/, '')}/s/${job.tenant.slug}/owner/`)}">${esc(say.open)}</a>`);
  return lines.join('\n');
}

/** Bot API outcome → outbox outcome: 4xx (bad chat, bot blocked) will not heal by retrying. */
export function telegramOutcome(status: number): 'sent' | 'failed' | 'retry' {
  if (status >= 200 && status < 300) return 'sent';
  if (status === 429 || status >= 500 || status === 0) return 'retry';
  return 'failed';
}
