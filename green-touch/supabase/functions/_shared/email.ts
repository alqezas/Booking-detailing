/**
 * Order emails to the buyer (only when they gave an email at checkout).
 *
 * - «Замовлення №N прийнято» after checkout: items, total, how payment works,
 *   Nova Poshta point and a link to the order page;
 * - «Оплату отримано» after a confirmed mono payment.
 *
 * Sent from the outbox (background jobs), so a mail server hiccup never breaks
 * checkout: the event is retried and each email goes out once per order event.
 * The transport is injected (SMTP in the Edge Function, a fake in tests).
 */
import {formatUah} from './contracts.ts';

export type Mail = {to: string; subject: string; text: string; html: string};
export type Mailer = {send(mail: Mail): Promise<void>};

export type OrderForMail = {
  number: number;
  first_name: string;
  email: string;
  payment_method: 'full_online' | 'prepay_manual' | string;
  prepay_kop: number;
  subtotal_kop: number;
  discount_kop: number;
  total_kop: number;
  delivery_method: string;
  np_settlement_name: string;
  np_warehouse_name: string;
  lines: {name: string; volume: string | null; qty: number; line_total_kop: number}[];
};

export type MailKind = 'created' | 'paid';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function paymentText(o: OrderForMail, kind: MailKind): string {
  if (kind === 'paid') return `Оплату ${formatUah(o.total_kop)} отримано. Починаємо готувати ваше замовлення.`;
  if (o.payment_method === 'prepay_manual') {
    return `Ми напишемо вам у Viber і надішлемо реквізити для передоплати ${formatUah(o.prepay_kop)}. Решту ${formatUah(o.total_kop - o.prepay_kop)} ви сплатите при отриманні на Новій пошті. Виготовлення починається після передоплати.`;
  }
  return `Оплата онлайн через monobank. Якщо ви ще не оплатили, це можна зробити на сторінці замовлення за посиланням нижче.`;
}

export function buildOrderMail(o: OrderForMail, kind: MailKind, orderUrl: string): Mail {
  const subject = kind === 'paid' ? `Green Touch: оплату замовлення №${o.number} отримано` : `Green Touch: замовлення №${o.number} прийнято`;
  const title = kind === 'paid' ? `Дякуємо, оплату отримано!` : `Дякуємо за замовлення!`;
  const delivery = `${o.delivery_method === 'np_postomat' ? 'Поштомат' : 'Відділення'} Нової пошти: ${o.np_settlement_name}, ${o.np_warehouse_name}`;
  const pay = paymentText(o, kind);
  const lineText = (l: OrderForMail['lines'][number]) => `${l.name}${l.volume ? `, ${l.volume}` : ''} × ${l.qty} — ${formatUah(l.line_total_kop)}`;

  const text = [
    `${o.first_name}, ${title.toLowerCase()}`,
    '',
    `Замовлення №${o.number}`,
    ...o.lines.map(l => `• ${lineText(l)}`),
    o.discount_kop ? `Знижка: −${formatUah(o.discount_kop)}` : '',
    `Разом: ${formatUah(o.total_kop)}`,
    '',
    pay,
    '',
    `Доставка: ${delivery}. Вартість доставки — за тарифами Нової пошти при отриманні.`,
    '',
    `Статус замовлення: ${orderUrl}`,
    '',
    'Green Touch',
  ]
    .filter((s, i, a) => s !== '' || a[i - 1] !== '')
    .join('\n');

  // Plain table layout with inline styles: what mail apps (Gmail, Outlook, iOS Mail) render reliably.
  const td = 'padding:8px 0;border-bottom:1px solid #E7E2D6;font-size:15px;color:#1F2B1C';
  const rows = o.lines
    .map(
      l =>
        `<tr><td style="${td}">${esc(l.name)}${l.volume ? `<br><span style="color:#6B6B5E;font-size:13px">${esc(l.volume)}</span>` : ''}</td><td style="${td};text-align:center;white-space:nowrap">× ${l.qty}</td><td style="${td};text-align:right;white-space:nowrap">${esc(formatUah(l.line_total_kop))}</td></tr>`,
    )
    .join('');
  const html = `<!doctype html><html lang="uk"><body style="margin:0;background:#FBF8F1;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBF8F1"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;padding:24px">
<tr><td style="font-size:20px;font-weight:bold;color:#3E6B3A;padding-bottom:16px">Green Touch</td></tr>
<tr><td style="font-size:22px;font-weight:bold;color:#1F2B1C;padding-bottom:4px">${esc(title)}</td></tr>
<tr><td style="font-size:15px;color:#6B6B5E;padding-bottom:16px">${esc(o.first_name)}, ваше замовлення №${o.number}</td></tr>
<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}
${o.discount_kop ? `<tr><td colspan="2" style="${td}">Знижка</td><td style="${td};text-align:right;white-space:nowrap">−${esc(formatUah(o.discount_kop))}</td></tr>` : ''}
<tr><td colspan="2" style="padding:12px 0;font-size:17px;font-weight:bold;color:#1F2B1C">Разом</td><td style="padding:12px 0;font-size:17px;font-weight:bold;color:#1F2B1C;text-align:right;white-space:nowrap">${esc(formatUah(o.total_kop))}</td></tr>
</table></td></tr>
<tr><td style="font-size:15px;line-height:1.5;color:#1F2B1C;padding:12px 0">${esc(pay)}</td></tr>
<tr><td style="font-size:15px;line-height:1.5;color:#1F2B1C;padding-bottom:20px"><b>Доставка:</b> ${esc(delivery)}.<br><span style="color:#6B6B5E;font-size:13px">Вартість доставки — за тарифами Нової пошти при отриманні.</span></td></tr>
<tr><td style="padding-bottom:8px"><a href="${esc(orderUrl)}" style="display:inline-block;background:#3E6B3A;color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:bold;padding:12px 22px;border-radius:999px">Переглянути замовлення</a></td></tr>
</table>
<p style="font-size:12px;color:#8A877C;margin:16px 0 0">Ви отримали цей лист, бо вказали цю адресу при оформленні замовлення в Green Touch.</p>
</td></tr></table></body></html>`;

  return {to: o.email, subject, text, html};
}
