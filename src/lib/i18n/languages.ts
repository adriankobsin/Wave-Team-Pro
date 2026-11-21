/** Languages offered in the top bar. The platform is written in English; the others are applied in the browser. */
export const UI_LANGUAGES = [
  { code: "en", name: "English", short: "EN" },
  { code: "th", name: "ไทย", short: "TH" },
  { code: "ro", name: "Română", short: "RO" },
  { code: "fi", name: "Suomi", short: "FI" },
] as const;
export type UiLang = (typeof UI_LANGUAGES)[number]["code"];
export const LANG_COOKIE = "wbh-lang";
export const isUiLang = (v: unknown): v is UiLang => typeof v === "string" && UI_LANGUAGES.some((l) => l.code === v);
