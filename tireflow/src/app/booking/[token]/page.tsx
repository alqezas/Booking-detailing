import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { isLocale, type Locale } from "@/i18n/config";
import { loadMessages } from "@/i18n/messages";
import { ManageBooking, type ManagedBooking } from "./manage";

export const metadata: Metadata = { title: "Booking", robots: { index: false } };

export default async function BookingTokenPage({ params, searchParams }: PageProps<"/booking/[token]">) {
  const { token } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = /^[0-9a-f]{48}$/.test(token) ? await supabase.rpc("public_booking", { p_token: token }) : { data: null };
  const b = data as unknown as ManagedBooking | null;
  const fallback = await getLocale();
  const locale: Locale = isLocale(sp.lang) ? sp.lang : fallback;
  const t = await getTranslations({ locale, namespace: "public" });
  const messages = await loadMessages(locale);
  if (!b) {
    return <main className="flex min-h-svh items-center justify-center p-4 text-sm text-muted-foreground">{t("notFound")}</main>;
  }
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone={b.timezone}>
      <main className="min-h-svh bg-muted/30 p-4" style={{ ["--primary" as string]: b.business.brand_color, ["--primary-foreground" as string]: "#fff" }}>
        <div className="mx-auto max-w-lg">
          <h1 className="mb-4 text-xl font-semibold">{b.business.name}</h1>
          <ManageBooking token={token} booking={b} locale={locale} />
        </div>
      </main>
    </NextIntlClientProvider>
  );
}
