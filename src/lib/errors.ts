/**
 * Server functions raise a stable machine code in `message` and a ready
 * Russian sentence in `hint` (see private.fail in the migrations).
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

const FALLBACK: Record<string, string> = {
  RATE_LIMITED: 'Слишком много запросов. Попробуйте через несколько минут.',
  forbidden: 'Нет доступа к этой студии',
  'Failed to fetch': 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.',
  'Invalid login credentials': 'Неверная почта или пароль',
};

export function toApiError(error: unknown, status: number | null = null): ApiError {
  if (error instanceof ApiError) return error;
  const e = error as {message?: string; hint?: string; code?: string; status?: number} | null;
  const code = e?.message ?? 'UNKNOWN';
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  const text =
    (offline ? FALLBACK['Failed to fetch'] : null) ??
    (e?.hint && /[а-яё]/i.test(e.hint) ? e.hint : null) ??
    FALLBACK[code] ??
    (code.includes('fetch') ? FALLBACK['Failed to fetch'] : null) ??
    'Что-то пошло не так. Попробуйте ещё раз.';
  return new ApiError(code, text!, status ?? e?.status ?? null);
}

export const errorText = (error: unknown): string => toApiError(error).message;
