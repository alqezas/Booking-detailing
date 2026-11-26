import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { MapPin, Phone } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isLocale, type Locale } from "@/i18n/config";
import { loadMessages } from "@/i18n/messages";
import { BookingWizard, type PublicBusiness } from "./wizard";

async function getBusiness(slug: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("public_business", { p_slug: slug });
  return data as unknown as PublicBusiness | null;
}

export async function generateMetadata({ params }: PageProps<"/s/[businessSlug]">): Promise<Metadata> {
  const b = await getBusiness((await params).businessSlug);
  return { title: b ? b.name : "TireFlow", robots: { index: Boolean(b) } };
}

export default async function PublicBookingPage({ params, searchParams }: PageProps<"/s/[businessSlug]">) {
  const { businessSlug } = await params;
  const sp = await searchParams;
  const b = await getBusiness(businessSlug);
  if (!b) notFound();
  // booking page language is independent from the CRM language
  const locale: Locale = isLocale(sp.lang) ? sp.lang : isLocale(b.locale) ? b.locale : "en";
  const messages = await loadMessages(locale);
  const t = await getTranslations({ locale, namespace: "public" });
  const logo = b.logo_path ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/public-assets/${b.logo_path}` : null;

  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone={b.timezone}>
      <div className="min-h-svh bg-muted/30" style={{ ["--primary" as string]: b.brand_color, ["--ring" as string]: b.brand_color, ["--primary-foreground" as string]: "#ffffff" }}>
        <header className="border-b bg-background">
          <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="" className="size-10 rounded-md object-contain" />
            ) : (
              <span className="flex size-10 items-center justify-center rounded-md text-lg font-bold text-white" style={{ background: b.brand_color }}>{b.name.slice(0, 1)}</span>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold">{b.name}</h1>
              <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                {b.phone && <a href={`tel:${b.phone}`} className="inline-flex items-center gap-1 hover:underline"><Phone className="size-3" />{b.phone}</a>}
                {b.branches[0]?.address && <span className="inline-flex items-center gap-1"><MapPin className="size-3" />{b.branches[0].address}, {b.branches[0].city}</span>}
              </p>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-6">
          <h2 className="mb-4 text-xl font-semibold">{t("book")}</h2>
          <BookingWizard slug={b.slug} business={b} locale={locale} />
          <section className="mt-8 rounded-lg border bg-background p-4 text-sm">
            <h3 className="mb-2 font-medium">{t("hours")}</h3>
            {b.branches.map((br) => (
              <div key={br.id} className="mb-2">
                {b.branches.length > 1 && <div className="font-medium">{br.name}</div>}
                <ul className="grid grid-cols-2 gap-x-6 sm:grid-cols-4">
                  {(["1", "2", "3", "4", "5", "6", "7"] as const).map((d) => (
                    <li key={d} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{t(`weekdays.${d}`)}</span>
                      <span className="tabular">{(br.opening_hours[d] ?? []).map((r) => r.join("–")).join(", ") || "—"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
          <p className="mt-6 text-center text-xs text-muted-foreground">{t("poweredBy")}</p>
        </main>
      </div>
    </NextIntlClientProvider>
  );
}
