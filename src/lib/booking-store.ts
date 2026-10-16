/**
 * The customer's own bookings, kept only on this device: booking id + the
 * capability token that opens it. Nothing personal is stored here beyond what
 * the server returns for that token.
 */
export type StoredBooking = {id: string; token: string; startAt: string; serviceName: string};

const key = (slug: string) => `studio:${slug}:bookings`;

function read(slug: string): StoredBooking[] {
  try {
    const raw = localStorage.getItem(key(slug));
    const list = raw ? (JSON.parse(raw) as StoredBooking[]) : [];
    return Array.isArray(list) ? list.filter(b => typeof b?.token === 'string' && typeof b?.id === 'string') : [];
  } catch {
    return [];
  }
}

function write(slug: string, list: StoredBooking[]): void {
  try {
    localStorage.setItem(key(slug), JSON.stringify(list.slice(0, 20)));
  } catch {
    /* private mode: the booking still works through the link */
  }
}

export const listBookings = (slug: string) => read(slug).sort((a, b) => b.startAt.localeCompare(a.startAt));

export function rememberBooking(slug: string, b: StoredBooking): void {
  write(slug, [b, ...read(slug).filter(x => x.id !== b.id)]);
}

export function forgetBooking(slug: string, id: string): void {
  write(slug, read(slug).filter(x => x.id !== id));
}

/**
 * One idempotency key per booking attempt. It survives a reload or a double
 * tap until the attempt succeeds, so a retry can never create a second booking.
 */
export function attemptKey(slug: string, fingerprint: string): string {
  const k = `studio:${slug}:attempt`;
  try {
    const saved = JSON.parse(sessionStorage.getItem(k) ?? 'null') as {fp: string; key: string} | null;
    if (saved?.fp === fingerprint) return saved.key;
    const fresh = randomKey();
    sessionStorage.setItem(k, JSON.stringify({fp: fingerprint, key: fresh}));
    return fresh;
  } catch {
    return randomKey();
  }
}

export function clearAttempt(slug: string): void {
  try {
    sessionStorage.removeItem(`studio:${slug}:attempt`);
  } catch {
    /* ignore */
  }
}

export function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
