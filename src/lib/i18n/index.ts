import en from "./messages/en.json";
import ro from "./messages/ro.json";

export const LOCALES = ["en", "ro"] as const;
export type Locale = (typeof LOCALES)[number];
export type MessageKey = keyof typeof en;

const catalogs: Record<Locale, Partial<Record<MessageKey, string>>> = { en, ro };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Returns the English text for a key. Pages are drawn in English and shown in the language chosen
 * in the top bar by the in-browser translator (components/layout/ui-translator), so the argument is
 * kept only for older callers.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getTranslator(_locale?: string | null) {
  const lang: Locale = "en";
  return (key: MessageKey, vars?: Record<string, string | number>) => {
    let text = catalogs[lang][key] ?? en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, String(v));
    return text;
  };
}

export type Translator = ReturnType<typeof getTranslator>;
