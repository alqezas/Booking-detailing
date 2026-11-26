import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/ui";
import { NewOrderForm } from "./new-order-form";

export default async function NewOrderPage({ params, searchParams }: PageProps<"/app/[businessSlug]/orders/new">) {
  const { businessSlug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(businessSlug, "orders.manage", "orders");
  const supabase = await createClient();
  const [services, employees, posts, customer] = await Promise.all([
    supabase.from("services").select("id, name").eq("business_id", ctx.id).eq("is_active", true).is("deleted_at", null).order("sort_order"),
    supabase.from("employees").select("id, first_name, last_name").eq("business_id", ctx.id).eq("is_active", true).is("deleted_at", null),
    supabase.from("workstations").select("id, name, branch_id").eq("business_id", ctx.id).eq("is_active", true).is("deleted_at", null).order("sort_order"),
    typeof sp.customer === "string" ? supabase.from("customers").select("id, first_name, last_name").eq("id", sp.customer).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const t = await getTranslations("orders");
  return (
    <div className="max-w-2xl">
      <PageHeader title={t("new")} />
      <NewOrderForm
        slug={ctx.slug} businessId={ctx.id} branches={ctx.branches} services={services.data ?? []}
        employees={(employees.data ?? []).map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}` }))}
        posts={posts.data ?? []}
        presetCustomer={customer.data ? { id: customer.data.id, name: `${customer.data.first_name} ${customer.data.last_name}`.trim() } : null}
      />
    </div>
  );
}
