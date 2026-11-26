import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Empty, PageHeader } from "@/components/app/ui";
import { WorkCard, type WorkItem } from "./work-card";

// Tablet view for mechanics: big touch targets, no prices.
export default async function MyWorkPage({ params }: PageProps<"/app/[businessSlug]/my-work">) {
  const { businessSlug } = await params;
  const ctx = await requirePermission(businessSlug, "orders.work", "orders");
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_work", { p_business: ctx.id });
  const [t, tc] = await Promise.all([getTranslations("nav"), getTranslations("common")]);
  const items = (data ?? []) as unknown as WorkItem[];
  return (
    <>
      <PageHeader title={t("myWork")} />
      {items.length === 0 ? <div className="rounded-lg border bg-card"><Empty>{tc("empty")}</Empty></div> : (
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((w) => <WorkCard key={w.id} slug={ctx.slug} item={w} />)}
        </div>
      )}
    </>
  );
}
