import type { Locale } from "./config";
import en from "@/messages/en.json";

type Tree = { [k: string]: string | Tree };

function merge(base: Tree, over: Tree): Tree {
  const out: Tree = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = base[k];
    out[k] = typeof v === "object" && typeof b === "object" ? merge(b, v) : v;
  }
  return out;
}

const loaders: Record<Locale, () => Promise<{ default: Tree }>> = {
  en: async () => ({ default: en as Tree }),
  cs: () => import("@/messages/cs.json"),
  pl: () => import("@/messages/pl.json"),
  uk: () => import("@/messages/uk.json"),
  sk: () => import("@/messages/sk.json"),
  de: () => import("@/messages/de.json"),
  ru: () => import("@/messages/ru.json"),
};

/** Locale messages deep-merged over English, so a missing key never shows a raw id. */
export async function loadMessages(locale: Locale): Promise<Tree> {
  if (locale === "en") return en as Tree;
  const m = await loaders[locale]();
  return merge(en as Tree, m.default);
}

export type Messages = typeof en;
