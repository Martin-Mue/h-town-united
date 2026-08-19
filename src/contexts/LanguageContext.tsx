import { createContext, useContext, useState, ReactNode } from "react";
import { translate, type Language } from "@/i18n/translations";

const LANGUAGE_PREF_KEY = "dart-language";

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
    return window.localStorage.getItem(LANGUAGE_PREF_KEY) === "en" ? "en" : "de";
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    if (typeof window !== "undefined") window.localStorage.setItem(LANGUAGE_PREF_KEY, lang);
  };

  const t = (key: string) => translate(key, language);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};
