"use client";

import { createContext, useContext, type ReactNode } from "react";
import { createTranslator, type Locale, type Translator } from "@/lib/i18n";

const LocaleContext = createContext<{ locale: Locale; t: Translator } | null>(null);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return (
    <LocaleContext.Provider value={{ locale, t: createTranslator(locale) }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used inside <LocaleProvider>.");
  return ctx;
}
