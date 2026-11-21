import { BRAND } from "@/lib/brand";
import { LanguagePicker } from "@/components/layout/language-picker";
import { uiLang } from "@/lib/i18n/server";
export async function AuthFrame({ children }: { children: React.ReactNode }) {
  const lang = await uiLang();
  return (
    <div className="flex min-h-dvh flex-col bg-hull lg:flex-row">
      <div className="px-6 pb-8 pt-[calc(2rem+env(safe-area-inset-top))] text-hull-ink lg:flex lg:w-[42%] lg:flex-col lg:justify-between lg:p-14">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-hull-muted">{BRAND.product}</p>
          <LanguagePicker current={lang} className="text-hull-ink [&_select]:border-white/20" />
        </div>
        <div className="mt-6 hidden max-w-sm lg:block">
          <p className="display text-4xl font-semibold leading-tight">{BRAND.demo ? "Every company. One team." : "Crew, office and projects on one deck."}</p>
          <p className="mt-4 text-hull-muted">{BRAND.demo ? "Clock-ins, tasks, timesheets, leave, expenses and company communications for every company in your group, on phone or desktop." : `Messages, time, leave and expenses for everyone at ${BRAND.group} — on your phone or at your desk.`}</p>
        </div>
        <svg aria-hidden viewBox="0 0 400 40" className="mt-6 hidden h-8 w-full text-brass/70 lg:block" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M0 20 Q 25 5 50 20 T 100 20 T 150 20 T 200 20 T 250 20 T 300 20 T 350 20 T 400 20" />
        </svg>
      </div>
      <main id="main" className="flex flex-1 items-start justify-center rounded-t-2xl bg-bg px-5 py-10 lg:items-center lg:rounded-none">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
