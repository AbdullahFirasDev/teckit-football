import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, dirFor, isLocale } from "@/lib/i18n";
import { Providers } from "@/components/providers";
import { LocaleProvider } from "@/components/locale-provider";
import { SiteHeader } from "@/components/site-header";
// @ts-expect-error Next.js processes this stylesheet import at build time.
import "./globals.css";

export const metadata: Metadata = {
  title: "Eventra — Events & Ticketing",
  description: "Discover events, buy tickets instantly, and check in with an in-browser QR scanner.",
};

export const viewport: Viewport = {
  themeColor: "#4f46e5",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;

  return (
    <html lang={locale} dir={dirFor(locale)}>
      <body className="flex min-h-screen flex-col font-sans">
        <Providers>
          <LocaleProvider locale={locale}>
            <SiteHeader locale={locale} />
            <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
            <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-500">
              Powered by Eventra · Payments by Wayl
            </footer>
          </LocaleProvider>
        </Providers>
      </body>
    </html>
  );
}
