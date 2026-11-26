import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { defaultLocale, isLocale, LOCALE_COOKIE, matchAcceptLanguage, type Locale } from "./config";
import { loadMessages } from "./messages";

// CRM locale: the user's choice (cookie, set from the profile). The public booking
// page passes its own locale explicitly, independent of the CRM language.
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  let locale: Locale = defaultLocale;
  if (isLocale(requested)) {
    locale = requested;
  } else {
    const c = (await cookies()).get(LOCALE_COOKIE)?.value;
    locale = isLocale(c) ? c : matchAcceptLanguage((await headers()).get("accept-language")) ?? defaultLocale;
  }
  return { locale, messages: await loadMessages(locale), timeZone: "Europe/Prague" };
});
