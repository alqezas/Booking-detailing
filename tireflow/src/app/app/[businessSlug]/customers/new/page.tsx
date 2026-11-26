import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/ui";
import { CustomerForm } from "../customer-form";

export default async function NewCustomerPage({ params }: PageProps<"/app/[businessSlug]/customers/new">) {
  const { businessSlug } = await params;
  const ctx = await requirePermission(businessSlug, "customers.manage", "customers");
  const t = await getTranslations("customers");
  const supabase = await createClient();
  const { data: corporates } = ctx.modules.includes("corporate")
    ? await supabase.from("corporate_customers").select("id, name").eq("business_id", ctx.id).is("deleted_at", null).order("name")
    : { data: [] };
  return (
    <div className="max-w-2xl">
      <PageHeader title={t("new")} />
      <div className="rounded-lg border bg-card p-4">
        <CustomerForm slug={ctx.slug} corporates={corporates ?? []} defaults={{ locale: ctx.settings.public_locale }} />
      </div>
    </div>
  );
}
