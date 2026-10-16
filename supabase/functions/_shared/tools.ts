/**
 * Tools the models may call. Two disjoint scopes:
 *   client — public studio data only (no customers, no bookings of others);
 *   owner  — read-only views of the owner's own studio.
 * The tenant is fixed by the server for each request; no tool takes a tenant
 * id, a SQL string or a write action.
 */
import {z} from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const CLIENT_TOOLS = {
  get_studio_info: {
    description: 'Адрес, телефон, ссылка на карту, часы работы и ближайшие выходные студии.',
    args: z.object({}).strict(),
  },
  list_services: {
    description: 'Список услуг студии с ценами (price, price_from = «от») и длительностью в минутах.',
    args: z.object({}).strict(),
  },
  find_free_slots: {
    description:
      'Ближайшее свободное время для услуги. service_id — из list_services. date_from — дата YYYY-MM-DD в часовом поясе студии (необязательно). Возвращает время начала свободных окон.',
    args: z
      .object({
        service_id: z.string().uuid(),
        date_from: isoDate.nullish(),
        limit: z.number().int().min(1).max(8).nullish(),
      })
      .strict(),
  },
} as const;

export const OWNER_TOOLS = {
  get_bookings: {
    description:
      'Записи студии за период: period = day | week | month, anchor_date — любая дата внутри периода (YYYY-MM-DD, часовой пояс студии). Только чтение.',
    args: z.object({period: z.enum(['day', 'week', 'month']), anchor_date: isoDate}).strict(),
  },
  get_stats: {
    description:
      'Показатели за период: заезды (машины приняты), завершённые работы, полученные деньги (оплаты минус возвраты) и ожидаемая стоимость записей (это прогноз, не выручка). period = day | week | month, anchor_date — дата внутри периода.',
    args: z.object({period: z.enum(['day', 'week', 'month']), anchor_date: isoDate}).strict(),
  },
} as const;

export type Scope = 'client' | 'owner';
export type ToolName<S extends Scope> = S extends 'client' ? keyof typeof CLIENT_TOOLS : keyof typeof OWNER_TOOLS;
export type Executor = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export function toolSet(scope: Scope): Record<string, {description: string; args: z.ZodType}> {
  return scope === 'client' ? CLIENT_TOOLS : OWNER_TOOLS;
}

/** OpenAI-compatible function definitions generated from the zod schemas. */
export function toolDefinitions(scope: Scope) {
  return Object.entries(toolSet(scope)).map(([name, t]) => ({
    type: 'function' as const,
    function: {name, description: t.description, parameters: z.toJSONSchema(t.args) as Record<string, unknown>},
  }));
}

/** Rejects unknown tools (e.g. an owner tool requested in the client scope) and bad arguments. */
export function validateCall(scope: Scope, name: string, rawArgs: unknown): {ok: true; args: Record<string, unknown>} | {ok: false; error: string} {
  const spec = toolSet(scope)[name];
  if (!spec) return {ok: false, error: `Инструмент «${name}» недоступен`};
  let parsedJson = rawArgs;
  if (typeof rawArgs === 'string') {
    try {
      parsedJson = rawArgs.trim() ? JSON.parse(rawArgs) : {};
    } catch {
      return {ok: false, error: 'Аргументы не являются JSON'};
    }
  }
  const r = spec.args.safeParse(parsedJson ?? {});
  if (!r.success) return {ok: false, error: `Неверные аргументы: ${r.error.issues.map(i => i.path.join('.') || i.message).join(', ')}`};
  return {ok: true, args: r.data as Record<string, unknown>};
}
