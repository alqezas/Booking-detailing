import { getTranslations } from "next-intl/server";
import { can, requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDays, minorToInput, zonedDay } from "@/lib/format";
import { PageHeader } from "@/components/app/ui";
import { CheckInForm } from "./check-in-form";

export default async function CheckInPage({ params, searchParams }: PageProps<"/app/[businessSlug]/tire-hotel/check-in">) {
  const { businessSlug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(businessSlug, "tire_hotel.manage", "tire_hotel");
  const supabase = await createClient();
  const [warehouses, methods, customer, t] = await Promise.all([
    supabase.from("warehouses").select("id, name").eq("business_id", ctx.id).eq("purpose", "tire_hotel"),
    supabase.from("payment_methods").select("id, name").eq("business_id", ctx.id).eq("is_active", true),
    typeof sp.customer === "string" ? supabase.from("customers").select("id, first_name, last_name").eq("id", sp.customer).maybeSingle() : Promise.resolve({ data: null }),
    getTranslations("hotel"),
  ]);
  return (
    <div className="max-w-3xl">
      <PageHeader title={t("checkIn")} />
      <CheckInForm
        slug={ctx.slug} businessId={ctx.id} warehouses={warehouses.data ?? []} methods={methods.data ?? []}
        currency={ctx.settings.currency} canPay={can(ctx, "finance.manage")}
        defaultPrice={minorToInput(ctx.settings.storage_price_per_season)}
        defaultEnd={addDays(zonedDay(new Date(), ctx.settings.timezone), 183)}
        presetCustomer={customer.data ? { id: customer.data.id, name: `${customer.data.first_name} ${customer.data.last_name}`.trim() } : null}
      />
    </div>
  );
}
