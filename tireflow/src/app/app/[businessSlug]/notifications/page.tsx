import { getLocale, getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { Empty, PageHeader, Section, StatusBadge } from "@/components/app/ui";

export default async function NotificationsPage({ params }: PageProps<"/app/[businessSlug]/notifications">) {
  const { businessSlug } = await params;
  const ctx = await requirePermission(businessSlug, "notifications.manage", "notifications");
  const supabase = await createClient();
  const [jobs, channels, templates, t, locale] = await Promise.all([
    supabase.from("notification_jobs").select("id, event, channel, recipient, status, attempts, run_at, sent_at, last_error, is_marketing").eq("business_id", ctx.id).order("run_at", { ascending: false }).limit(100),
    supabase.from("notification_channels").select("*").eq("business_id", ctx.id),
    supabase.from("notification_templates").select("id, event, channel, locale, body, is_marketing").eq("business_id", ctx.id).order("event"),
    getTranslations("notifications"), getLocale(),
  ]);
  const tz = ctx.settings.timezone;
  const mask = (r: string) => (r.includes("@") ? r.replace(/^(.).+(@.*)$/, "$1***$2") : r.replace(/\d(?=\d{3})/g, "•"));
  const all = ["email", "sms", "whatsapp", "telegram", "web_push", "in_app"];
  return (
    <>
      <PageHeader title={t("title")} />
      <div className="grid gap-4 xl:grid-cols-3">
        <Section title={t("queue")} className="xl:col-span-2">
          {(jobs.data ?? []).length === 0 ? <Empty>—</Empty> : (
            <ul className="divide-y text-sm">
              {jobs.data!.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center gap-x-3 px-4 py-1.5">
                  <span className="tabular w-36 text-muted-foreground">{formatDateTime(j.run_at, tz, locale)}</span>
                  <span className="w-40 truncate">{j.event}{j.is_marketing && " ★"}</span>
                  <span className="w-16 text-muted-foreground">{j.channel}</span>
                  <span className="font-mono text-xs">{mask(j.recipient)}</span>
                  <span className="ml-auto"><StatusBadge status={j.status} label={t(`jobStatus.${j.status as "queued"}`)} /></span>
                  {j.last_error && <span className="w-full text-xs text-destructive">{j.last_error}</span>}
                </li>
              ))}
            </ul>
          )}
        </Section>
        <div className="space-y-4">
          <Section title={t("channels")}>
            <ul className="divide-y text-sm">
              {all.map((ch) => {
                const c = channels.data?.find((x) => x.channel === ch);
                return (
                  <li key={ch} className="px-4 py-2">
                    <div className="flex justify-between"><span className="font-medium">{ch}</span>
                      <StatusBadge status={c?.is_enabled ? (c.provider === "test" ? "pending" : "paid") : "cancelled"} label={c?.is_enabled ? (c.provider === "test" ? "test" : t("connected")) : t("notConnected")} /></div>
                    {c?.provider === "test" && <p className="text-xs text-muted-foreground">{t("testAdapter")}</p>}
                    {c?.last_error && <p className="text-xs text-destructive">{c.last_error}</p>}
                  </li>
                );
              })}
            </ul>
          </Section>
          <Section title={t("templates")}>
            <ul className="divide-y text-sm">
              {(templates.data ?? []).map((tp) => (
                <li key={tp.id} className="px-4 py-2">
                  <div className="flex justify-between text-xs text-muted-foreground"><span>{tp.event}{tp.is_marketing && " ★"}</span><span>{tp.channel} · {tp.locale}</span></div>
                  <div className="truncate">{tp.body}</div>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </>
  );
}
