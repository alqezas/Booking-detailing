import {msg} from '../i18n/index.ts';

/**
 * Server functions raise a stable machine code in `message` and a ready
 * Russian sentence in `hint` (see private.fail in the migrations). Russian
 * studios show the hint as is; other languages translate by code.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number | null;
  constructor(code: string, userMessage: string, status: number | null = null) {
    super(userMessage);
    this.code = code;
    this.status = status;
  }
}

export function toApiError(error: unknown, status: number | null = null): ApiError {
  if (error instanceof ApiError) return error;
  const e = error as {message?: string; hint?: string; code?: string; status?: number} | null;
  const code = e?.message ?? 'UNKNOWN';
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  const text =
    (offline ? msg.errors.offline : null) ??
    (msg.errors.useServerHint && e?.hint && /[а-яё]/i.test(e.hint) ? e.hint : null) ??
    msg.errors.codes[code] ??
    (code === 'Invalid login credentials' ? msg.errors.badLogin : null) ??
    (code.includes('fetch') ? msg.errors.offline : null) ??
    msg.errors.generic;
  return new ApiError(code, text, status ?? e?.status ?? null);
}

export const errorText = (error: unknown): string => toApiError(error).message;
