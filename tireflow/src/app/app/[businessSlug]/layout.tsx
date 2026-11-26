import { getMemberships, isPlatformAdmin, requireBusiness, requireUser } from "@/lib/auth";
import { buildNav } from "@/lib/nav";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app/shell";

export default async function BusinessLayout({ children, params }: LayoutProps<"/app/[businessSlug]">) {
  const { businessSlug } = await params;
  const [user, ctx, memberships, admin] = await Promise.all([
    requireUser(), requireBusiness(businessSlug), getMemberships(), isPlatformAdmin(),
  ]);
  // remember the last business for the next sign-in (fire and forget)
  const supabase = await createClient();
  void supabase.from("profiles").update({ last_business_id: ctx.id }).eq("id", user.id).then(() => {});

  return (
    <AppShell
      nav={buildNav(ctx)}
      business={{ id: ctx.id, slug: ctx.slug, name: ctx.name }}
      businesses={memberships.map((m) => ({ id: m.id, slug: m.slug, name: m.name }))}
      isAdmin={admin}
      user={{ email: user.email }}
    >
      {children}
    </AppShell>
  );
}
