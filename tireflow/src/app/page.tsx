import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getMemberships, getUser, isPlatformAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";

// Entry point: sends each user where they belong.
export default async function Home() {
  const user = await getUser();
  if (!user) redirect("/login");
  const [memberships, admin] = await Promise.all([getMemberships(), isPlatformAdmin()]);
  if (memberships.length === 1 && !admin) redirect(`/app/${memberships[0].slug}/dashboard`);
  if (memberships.length === 0 && admin) redirect("/admin");
  if (memberships.length > 1 && !admin) {
    const supabase = await createClient();
    const { data: profile } = await supabase.from("profiles").select("last_business_id").eq("id", user.id).single();
    const last = memberships.find((m) => m.id === profile?.last_business_id);
    if (last) redirect(`/app/${last.slug}/dashboard`);
  }
  const t = await getTranslations("auth");
  const tn = await getTranslations("nav");
  const tc = await getTranslations("common");
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-6">
        <h1 className="text-lg font-semibold">{memberships.length ? t("chooseBusiness") : t("noBusiness")}</h1>
        <ul className="divide-y rounded-lg border">
          {memberships.map((m) => (
            <li key={m.id}>
              <Link className="block px-4 py-3 text-sm hover:bg-muted" href={`/app/${m.slug}/dashboard`}>{m.name}</Link>
            </li>
          ))}
          {admin && (
            <li><Link className="block px-4 py-3 text-sm font-medium hover:bg-muted" href="/admin">{tn("admin")}</Link></li>
          )}
        </ul>
        <form action={signOut}><Button variant="outline" className="w-full" type="submit">{tc("signOut")}</Button></form>
      </div>
    </main>
  );
}
