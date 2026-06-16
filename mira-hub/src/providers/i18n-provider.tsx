"use client";

import { createContext, useContext, useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import hi from "@/messages/hi.json";
import zh from "@/messages/zh.json";

export type Locale = "en" | "es" | "hi" | "zh";

export const LOCALE_META: Record<Locale, { flag: string; label: string }> = {
  en: { flag: "🇺🇸", label: "English" },
  es: { flag: "🇲🇽", label: "Español" },
  hi: { flag: "🇮🇳", label: "हिन्दी" },
  zh: { flag: "🇨🇳", label: "中文" },
};

const LOCALES: Locale[] = ["en", "es", "hi", "zh"];
const MESSAGES: Record<Locale, typeof en> = { en, es, hi, zh };

const SetLocaleContext = createContext<(l: Locale) => void>(() => {});
const ActiveLocaleContext = createContext<Locale>("en");

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window === "undefined") return "en";
    const stored = localStorage.getItem("hub_locale") as Locale | null;
    if (stored && LOCALES.includes(stored)) return stored;
    const sys = navigator.language.split("-")[0] as Locale;
    return LOCALES.includes(sys) ? sys : "en";
  });

  function setLocale(l: Locale) {
    setLocaleState(l);
    localStorage.setItem("hub_locale", l);
  }

  return (
    <ActiveLocaleContext.Provider value={locale}>
      <SetLocaleContext.Provider value={setLocale}>
        <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
          {children}
        </NextIntlClientProvider>
      </SetLocaleContext.Provider>
    </ActiveLocaleContext.Provider>
  );
}

export function useSetLocale() {
  return useContext(SetLocaleContext);
}

export function useActiveLocale() {
  return useContext(ActiveLocaleContext);
}
