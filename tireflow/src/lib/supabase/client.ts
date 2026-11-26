"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";

/** Browser client: publishable key only, RLS applies to every query. */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
