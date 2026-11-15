import {formatInTimeZone} from 'date-fns-tz';
import {uk} from 'date-fns/locale';

export {formatUah} from '../../supabase/functions/_shared/contracts.ts';

/** Stored in UTC, shown in Kyiv time. */
export const KYIV = 'Europe/Kyiv';
export const kyivDateTime = (iso: string) => formatInTimeZone(iso, KYIV, 'd MMMM yyyy, HH:mm', {locale: uk});
export const kyivDate = (iso: string) => formatInTimeZone(iso, KYIV, 'd MMMM yyyy', {locale: uk});

export const PAYMENT_LABEL: Record<string, {label: string; variant: 'success' | 'warning' | 'error' | 'neutral' | 'info'}> = {
  unpaid: {label: 'Не оплачено', variant: 'neutral'},
  awaiting: {label: 'Очікує оплати', variant: 'warning'},
  processing: {label: 'Оплата обробляється', variant: 'info'},
  paid: {label: 'Оплачено (підтверджено LiqPay)', variant: 'success'},
  failed: {label: 'Оплата не пройшла', variant: 'error'},
  expired: {label: 'Час на оплату минув', variant: 'error'},
  reversed: {label: 'Оплату повернуто', variant: 'error'},
};
export const FULFILLMENT_LABEL: Record<string, string> = {
  new: 'Нове',
  processing: 'Комплектується',
  packed: 'Зібрано',
  shipped: 'Відправлено',
  delivered: 'Отримано',
  cancelled: 'Скасовано',
};
export const REVIEW_LABEL: Record<string, string> = {
  payment_amount_mismatch: 'Сума або валюта платежу не збігається',
  double_payment: 'Можлива подвійна оплата',
  payment_reversed: 'Банк повернув платіж',
  paid_after_cancel: 'Оплата надійшла після скасування',
  cancelled_after_payment: 'Скасовано після оплати — потрібне повернення коштів',
};
