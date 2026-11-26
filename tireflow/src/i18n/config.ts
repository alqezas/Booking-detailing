export const locales = ["en", "cs", "pl", "uk", "sk", "de", "ru"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";
export const LOCALE_COOKIE = "tf_locale";

export const localeNames: Record<Locale, string> = {
  en: "English", cs: "Čeština", pl: "Polski", uk: "Українська", sk: "Slovenčina", de: "Deutsch", ru: "Русский",
};

/** BCP-47 tags for Intl formatting (dates, numbers, currency). */
export const intlLocale: Record<Locale, string> = {
  en: "en-GB", cs: "cs-CZ", pl: "pl-PL", uk: "uk-UA", sk: "sk-SK", de: "de-AT", ru: "ru-RU",
};

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (locales as readonly string[]).includes(v);
}

export function matchAcceptLanguage(header: string | null): Locale | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const tag = part.split(";")[0].trim().toLowerCase().slice(0, 2);
    if (isLocale(tag)) return tag;
  }
  return null;
}
