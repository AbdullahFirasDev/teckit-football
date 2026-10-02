"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LOCALE_COOKIE, locales, type Locale } from "@/lib/i18n";
import { Button } from "@/components/ui";

/** Locale switch stub: stores the choice and re-renders server components. */
export function LanguageToggle({ locale }: { locale: Locale }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const switchTo = (next: Locale) => {
    if (next === locale) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => router.refresh());
  };

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Language">
      {locales.map((l) => (
        <Button
          key={l}
          variant={l === locale ? "primary" : "ghost"}
          className="px-2.5 py-1.5 text-xs uppercase"
          disabled={pending}
          onClick={() => switchTo(l)}
        >
          {l}
        </Button>
      ))}
    </div>
  );
}
