"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isLocale, LOCALE_COOKIE } from "@/i18n/config";

export type FormState = { error?: string; ok?: string } | undefined;

const signInSchema = z.object({ email: z.email(), password: z.string().min(1), next: z.string().optional() });

function safeNext(next: string | undefined) {
  // only same-site relative paths, never protocol-relative or absolute URLs
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export async function signIn(_: FormState, form: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
  if (error) return { error: "invalid" };
  const { data: profile } = await supabase.from("profiles").select("locale").eq("id", data.user.id).single();
  if (profile && isLocale(profile.locale)) {
    (await cookies()).set(LOCALE_COOKIE, profile.locale, { path: "/", maxAge: 31536000, sameSite: "lax" });
  }
  redirect(safeNext(parsed.data.next));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function sendPasswordReset(_: FormState, form: FormData): Promise<FormState> {
  const email = z.email().safeParse(form.get("email"));
  if (!email.success) return { error: "invalid" };
  const supabase = await createClient();
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? (await headers()).get("origin") ?? "";
  await supabase.auth.resetPasswordForEmail(email.data, { redirectTo: `${origin}/auth/callback?next=/auth/update-password` });
  // same answer whether or not the address exists (no account enumeration)
  return { ok: "sent" };
}

export async function updatePassword(_: FormState, form: FormData): Promise<FormState> {
  const pw = z.string().min(10).max(200).safeParse(form.get("password"));
  if (!pw.success) return { error: "minLength" };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: pw.data });
  if (error) return { error: "generic" };
  redirect("/");
}

export async function setLocale(locale: string) {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 31536000, sameSite: "lax" });
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims?.sub) await supabase.from("profiles").update({ locale }).eq("id", data.claims.sub);
}
