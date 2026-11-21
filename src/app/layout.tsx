import { AuthHashForwarder } from "@/components/layout/auth-hash-forwarder";
import { VersionWatcher } from "@/components/layout/version-watcher";
import type { Metadata, Viewport } from "next";
import "@fontsource-variable/ibm-plex-sans/wdth.css";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/layout/sw-register";
import { BRAND } from "@/lib/brand";
import { uiLang } from "@/lib/i18n/server";
import { UiTranslator } from "@/components/layout/ui-translator";
import { CATALOG_VERSION } from "@/lib/i18n/ui/version";

export const metadata: Metadata = {
  title: { default: BRAND.product, template: `%s · ${BRAND.product}` },
  description: BRAND.demo ? `${BRAND.product}: people, time, projects and expenses for multi-company teams.` : "Internal workspace for your teams.",
  applicationName: BRAND.product,
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: BRAND.hub, statusBarStyle: "default" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0e2a3b" },
    { media: "(prefers-color-scheme: dark)", color: "#081720" },
  ],
};

// Applies the saved or system theme before first paint to avoid a flash.
const themeScript = `(function(){try{var t=localStorage.getItem('wbh-theme');var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);if(localStorage.getItem('wbh-menu')==='hidden')document.documentElement.classList.add('menu-hidden');}catch(e){}})();`;

// In another language, keep the page hidden until it is translated (at most 2.5 s) to avoid a flash of English.
const langScript = `(function(){var h=document.documentElement;if(h.lang&&h.lang!=='en'){h.classList.add('i18n-wait');setTimeout(function(){h.classList.remove('i18n-wait')},2500);}})();`;

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const lang = await uiLang();
  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: langScript }} />
      </head>
      <body className="antialiased">
        <AuthHashForwarder />
        <VersionWatcher />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-panel focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        {BRAND.demo ? (
          <div className="bg-brass px-4 py-1 text-center text-xs font-medium text-[#1c140a]">
            {BRAND.product} demo · fictional company and data · changes you make may be seen by other visitors
          </div>
        ) : null}
        {children}
        <UiTranslator lang={lang} version={CATALOG_VERSION} />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
