import { execSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// Local Supabase only (`pnpm db:start`). Keys come from TEST_SUPABASE_* env vars
// (set in CI) or are read from the running local stack — never hardcoded.
function localStatus(): Record<string, string> {
  try {
    const out = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return Object.fromEntries(out.split(/\r?\n/).filter((l) => l.includes("=")).map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
    }));
  } catch {
    return {};
  }
}
const needLocal = !process.env.TEST_SUPABASE_PUBLISHABLE_KEY || !process.env.TEST_SUPABASE_SECRET_KEY;
const local = needLocal ? localStatus() : {};
export const URL = process.env.TEST_SUPABASE_URL ?? local.API_URL ?? "http://127.0.0.1:56321";
export const PUBLISHABLE = process.env.TEST_SUPABASE_PUBLISHABLE_KEY ?? local.PUBLISHABLE_KEY ?? "";
export const SECRET = process.env.TEST_SUPABASE_SECRET_KEY ?? local.SECRET_KEY ?? "";

// From supabase/seed.sql (local demo data)
export const DEMO = "10000000-0000-4000-a000-000000000001";
export const OTHER = "10000000-0000-4000-a000-000000000002";
const PASSWORD = "TireFlow-demo-2026";

export type Client = SupabaseClient<Database>;

export function anon(): Client {
  return createClient<Database>(URL, PUBLISHABLE, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function service(): Client {
  return createClient<Database>(URL, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function as(user: "admin" | "owner" | "manager" | "mechanic" | "accountant" | "other"): Promise<Client> {
  const c = anon();
  const { error } = await c.auth.signInWithPassword({ email: `${user}@tireflow.test`, password: PASSWORD });
  if (error) throw error;
  return c;
}

export async function firstId(c: Client, table: "branches" | "services" | "workstations" | "customers" | "payment_methods" | "warehouses", business = DEMO, filter?: (q: any) => any) {
  let q: any = c.from(table).select("id").eq("business_id", business).limit(1);
  if (filter) q = filter(q);
  const { data, error } = await q;
  if (error) throw error;
  return data![0].id as string;
}

/** A start time at least `days` ahead, on a weekday, at `hour`:00 Prague time. */
export function futureSlot(days: number, hour: number, minute = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  const ymd = d.toISOString().slice(0, 10);
  // Prague is UTC+1 in winter, UTC+2 in summer; pick via Intl
  const probe = new Date(`${ymd}T12:00:00Z`);
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Prague", timeZoneName: "shortOffset" })
    .formatToParts(probe).find((p) => p.type === "timeZoneName")!.value; // "GMT+1"
  const h = Number(offset.replace("GMT", "")) || 0;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour - h, minute)).toISOString();
}
