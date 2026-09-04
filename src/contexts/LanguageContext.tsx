import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { LANGUAGES, type Language } from "@/i18n/translations";

const LANGUAGE_PREF_KEY = "dart-language";

// One flat key->string JSON per language, generated from src/i18n/translations.ts (the file to
// actually edit — see scripts/generate-locales.mjs) — dynamic-imported per language instead of
// bundling all 6 languages' text into the main chunk. An explicit map (not a template-literal
// import(`./generated/${lang}.json`)) so Vite's static analysis always finds exactly these 6
// chunks, nothing more.
const LOCALE_LOADERS: Record<Language, () => Promise<{ default: Record<string, string> }>> = {
  de: () => import("@/i18n/generated/de.json"),
  en: () => import("@/i18n/generated/en.json"),
  fr: () => import("@/i18n/generated/fr.json"),
  pl: () => import("@/i18n/generated/pl.json"),
  nl: () => import("@/i18n/generated/nl.json"),
  tr: () => import("@/i18n/generated/tr.json"),
};
// Module-level (outside the component) so switching back to an already-loaded language is
// instant and never triggers a second fetch of the same chunk for this page session.
const localeCache = new Map<Language, Record<string, string>>();

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType>({
  language: "de",
  setLanguage: () => {},
  t: (key: string) => key,
});

export const useLanguage = () => useContext(LanguageContext);

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    if (typeof window === "undefined") return "de";
    const stored = window.localStorage.getItem(LANGUAGE_PREF_KEY);
    return (LANGUAGES as string[]).includes(stored ?? "") ? (stored as Language) : "de";
  });
  // null until the CURRENT language's strings have loaded at least once — gates the initial
  // render so the app never flashes raw translation keys ("nav.tournament") before the real text
  // arrives. Only ever null very briefly (one small per-language JSON chunk, typically already
  // warm from the browser cache on a return visit).
  const [strings, setStrings] = useState<Record<string, string> | null>(() => localeCache.get(language) ?? null);

  useEffect(() => {
    let cancelled = false;
    const cached = localeCache.get(language);
    if (cached) { setStrings(cached); return; }
    LOCALE_LOADERS[language]().then((mod) => {
      if (cancelled) return;
      localeCache.set(language, mod.default);
      setStrings(mod.default);
    });
    return () => { cancelled = true; };
  }, [language]);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    if (typeof window !== "undefined") window.localStorage.setItem(LANGUAGE_PREF_KEY, lang);
  };

  const t = (key: string) => strings?.[key] ?? key;

  if (!strings) {
    return (
      <div role="status" aria-label="Loading" className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};
