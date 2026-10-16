import {savePushSubscription} from './api/public.ts';
import {env} from './env.ts';
import {isIOS, isStandalone, tenantWorker} from './pwa.ts';
import type {PublicBooking} from './types.ts';

/**
 * Honest push availability. iPhone Safari delivers Web Push only to a site
 * installed to the Home Screen (iOS 16.4+), so a plain tab gets 'needs-install'.
 */
export type PushSupport = 'available' | 'granted' | 'denied' | 'needs-install' | 'unsupported' | 'not-configured';

export function pushSupport(): PushSupport {
  if (!env.vapidPublicKey) return 'not-configured';
  if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return isIOS() && !isStandalone() ? 'needs-install' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  return 'available';
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function enableReminder(slug: string, token: string): Promise<PublicBooking> {
  if (!env.vapidPublicKey) throw new Error('Напоминания не настроены');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Уведомления запрещены в настройках браузера');
  const reg = (await tenantWorker(slug)) ?? (await navigator.serviceWorker.ready);
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(env.vapidPublicKey)}));
  return savePushSubscription(slug, token, sub.toJSON());
}
