import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createTranslator, type Locale } from "@/lib/i18n";
import { LanguageToggle } from "@/components/language-toggle";
import { SignOutButton } from "@/components/sign-out-button";

export async function SiteHeader({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4">
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight text-slate-900">
          <span aria-hidden className="grid size-7 place-items-center rounded-lg bg-brand-600 text-sm text-white">E</span>
          <span className="hidden sm:inline">Eventra</span>
        </Link>

        <nav className="flex items-center gap-1 text-sm font-medium text-slate-700 sm:gap-2">
          <Link className="rounded-lg px-2.5 py-1.5 hover:bg-slate-100" href="/">
            {t("nav.events")}
          </Link>
          <Link className="rounded-lg px-2.5 py-1.5 hover:bg-slate-100" href="/tickets">
            {t("nav.myTickets")}
          </Link>
          {user ? (
            <>
              <Link className="rounded-lg px-2.5 py-1.5 hover:bg-slate-100" href="/dashboard">
                {t("nav.dashboard")}
              </Link>
              <SignOutButton />
            </>
          ) : (
            <Link className="rounded-lg px-2.5 py-1.5 hover:bg-slate-100" href="/login">
              {t("nav.login")}
            </Link>
          )}
          <LanguageToggle locale={locale} />
        </nav>
      </div>
    </header>
  );
}
