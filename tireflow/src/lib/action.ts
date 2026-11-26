import type { PostgrestError } from "@supabase/supabase-js";
import { rpcErrorKey } from "./format";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fields?: Record<string, string> };

export function fail(error: PostgrestError | { message?: string } | null | undefined): ActionResult<never> {
  if (error && "code" in error && error.code === "23505") return { ok: false, error: "duplicate" };
  return { ok: false, error: rpcErrorKey(error?.message) };
}

export function zodFail(issues: { path: PropertyKey[]; message: string }[]): ActionResult<never> {
  const fields: Record<string, string> = {};
  for (const i of issues) fields[String(i.path[0] ?? "_")] = i.message;
  return { ok: false, error: "validation", fields };
}

/** Empty strings and missing fields become null. */
export const nullish = (v: unknown) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v);
