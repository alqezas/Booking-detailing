import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ShieldCheck } from "lucide-react";
import { getMemberships, isPlatformAdmin, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { Logo } from "@/components/app/logo";
import { PageHeader, Stat } from "@/components/app/ui";
import { signOut } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { AdminBusinesses } from "./businesses";
import { NewBusinessDialog } from "./new-business";

export const metadata: Metadata = { title: "Platform admin" };

export default async function AdminPage() {
  await requireUser();
  if (!(await isPlatformAdmin())) redirect("/");
  const supabase = await createClient();
  const [{ data }, t, tc, memberships, locale] = await Promise.all([
    supabase.rpc("admin_list_businesses"), getTranslations("admin"), getTranslations("common"), getMemberships(), getLocale(),
  ]);
  const list = data ?? [];
  return (
    <div className="min-h-svh bg-muted/30">
      <header className="flex h-14 items-center gap-3 border-b bg-background px-4">
        <Logo /><span className="font-semibold">TireFlow</span>
        <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs"><ShieldCheck className="size-3" />{t("title")}</span>
        <div className="ml-auto flex items-center gap-2">
          {memberships[0] && <Button size="sm" variant="ghost" render={<Link href={`/app/${memberships[0].slug}/dashboard`} />}>{memberships[0].name}</Button>}
          <form action={signOut}><Button size="sm" variant="outline" type="submit">{tc("signOut")}</Button></form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4 md:p-6">
        <PageHeader title={t("businesses")} description={t("privacy")} actions={<NewBusinessDialog />} />
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={t("businesses")} value={list.length} />
          <Stat label={t("active")} value={list.filter((b) => b.is_active).length} />
          <Stat label={t("members")} value={list.reduce((s, b) => s + b.members, 0)} />
          <Stat label={t("bookings30")} value={list.reduce((s, b) => s + b.bookings_30d, 0)} />
        </div>
        <AdminBusinesses rows={list.map((b) => ({ ...b, created: formatDate(b.created_at, "Europe/Prague", locale), valid: b.license_valid_until }))} />
      </main>
    </div>
  );
}
