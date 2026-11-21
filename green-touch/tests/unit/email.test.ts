import {describe, expect, it} from 'vitest';
import {buildOrderMail, type OrderForMail} from '../../supabase/functions/_shared/email.ts';

const order: OrderForMail = {
  number: 42,
  first_name: 'Олена',
  email: 'buyer@example.com',
  payment_method: 'prepay_manual',
  prepay_kop: 15000,
  subtotal_kop: 210000,
  discount_kop: 0,
  total_kop: 210000,
  delivery_method: 'np_branch',
  np_settlement_name: 'Київ',
  np_warehouse_name: 'Відділення №5 <вул. Хрещатик>',
  lines: [
    {name: 'Крем із церамідами', volume: '50 мл', qty: 1, line_total_kop: 110000},
    {name: 'Тонік', volume: null, qty: 2, line_total_kop: 100000},
  ],
};
// prices use non-breaking spaces between digit groups
const norm = (s: string) => s.replace(/[  ]/g, ' ');
const url = 'https://shop.test/zamovlennia/abc#t=tok';

describe('order emails', () => {
  it('confirmation lists items, total, prepayment terms, delivery and the order link', () => {
    const m = buildOrderMail(order, 'created', url);
    expect(m.to).toBe('buyer@example.com');
    expect(m.subject).toBe('Green Touch: замовлення №42 прийнято');
    expect(norm(m.text)).toContain('• Крем із церамідами, 50 мл × 1 — 1 100 грн');
    expect(norm(m.text)).toContain('• Тонік × 2 — 1 000 грн');
    expect(norm(m.text)).toContain('Разом: 2 100 грн');
    expect(norm(m.text)).toContain('передоплати 150 грн');
    expect(norm(m.text)).toContain('Решту 1 950 грн');
    expect(norm(m.text)).toContain(url);
    expect(m.html).toContain(`href="${url}"`);
  });

  it('online payment and paid emails say the right thing', () => {
    const online = {...order, payment_method: 'full_online'};
    expect(norm(buildOrderMail(online, 'created', url).text)).toContain('Оплата онлайн через monobank');
    const paid = buildOrderMail(online, 'paid', url);
    expect(paid.subject).toBe('Green Touch: оплату замовлення №42 отримано');
    expect(norm(paid.text)).toContain('Оплату 2 100 грн отримано');
  });

  it('escapes shop data in the HTML version', () => {
    const m = buildOrderMail(order, 'created', url);
    expect(m.html).toContain('&lt;вул. Хрещатик&gt;');
    expect(m.html).not.toContain('<вул.');
  });
});
