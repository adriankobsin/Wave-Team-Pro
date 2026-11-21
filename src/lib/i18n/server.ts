import "server-only";
import { cookies } from "next/headers";
import { isUiLang, LANG_COOKIE, type UiLang } from "./languages";

/** The language chosen in the top bar (a cookie, so it applies before the page is drawn). */
export async function uiLang(): Promise<UiLang> {
  try {
    const v = (await cookies()).get(LANG_COOKIE)?.value;
    return isUiLang(v) ? v : "en";
  } catch {
    return "en";
  }
}
