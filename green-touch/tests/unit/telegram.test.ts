import {describe, expect, it} from 'vitest';
import {orderMessage, type OrderForTg} from '../../supabase/functions/_shared/telegram.ts';

const norm = (s: string) => s.replace(/ /g, ' ');
const o: OrderForTg = {
  id: 'abc',
  number: 12,
  first_name: 'Олена',
  last_name: 'Коваль<script>',
  phone: '+380671112233',
  total_kop: 155000,
  payment_method: 'prepay_manual',
  prepay_kop: 15000,
  delivery_method: 'np_postomat',
  np_settlement_name: 'Київ',
  np_warehouse_name: 'Поштомат №5',
  comment: 'Подзвоніть',
  lines: [
    {name: 'Крем з бакучіолом', volume: '50 мл', qty: 1},
    {name: 'Тонік', volume: null, qty: 2},
  ],
};

describe('Telegram order notifications', () => {
  it('a prepaid order lists the buyer, payment, delivery, items and the admin link', () => {
    const t = norm(orderMessage('order.prepaid', o, 'https://admin.example/admin'));
    expect(t).toContain('Нове оплачене замовлення №12');
    expect(t).toContain('Коваль&lt;script&gt;'); // shop data is escaped for parse_mode HTML
    expect(t).toContain('передоплату 150 грн отримано, решта 1 400 грн');
    expect(t).toContain('поштомат НП, Київ, Поштомат №5');
    expect(t).toContain('• Крем з бакучіолом, 50 мл × 1');
    expect(t).toContain('• Тонік × 2');
    expect(t).toContain('Коментар: Подзвоніть');
    expect(t).toContain('href="https://admin.example/admin/zamovlennia/abc"');
  });
  it('a paid online order comes with the full details', () => {
    const t = norm(orderMessage('order.paid', {...o, payment_method: 'full_online', prepay_kop: 0}, 'https://a/admin'));
    expect(t).toContain('Нове оплачене замовлення №12');
    expect(t).toContain('оплачено повністю через monobank');
    expect(t).toContain('• Тонік × 2');
  });
});
