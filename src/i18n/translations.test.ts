import { describe, it, expect } from "vitest";
import { translate, translations, LANGUAGES } from "./translations";

describe("translate", () => {
  it("returns the German string for a known key", () => {
    expect(translate("nav.tournament", "de")).toBe("Turnier");
  });

  it("returns the correct string for the same known key across every supported language", () => {
    expect(translate("nav.tournament", "en")).toBe("Tournament");
    expect(translate("nav.tournament", "fr")).toBe("Tournoi");
    expect(translate("nav.tournament", "pl")).toBe("Turniej");
    expect(translate("nav.tournament", "nl")).toBe("Toernooi");
    expect(translate("nav.tournament", "tr")).toBe("Turnuva");
  });

  it("falls back to the key itself for an unknown key, in every language", () => {
    for (const lang of LANGUAGES) {
      expect(translate("nonexistent.key", lang)).toBe("nonexistent.key");
    }
  });
});

describe("translations completeness", () => {
  it("has a non-empty string for every language on every key (no silently-missing entry)", () => {
    const missing: string[] = [];
    for (const [key, byLang] of Object.entries(translations)) {
      for (const lang of LANGUAGES) {
        if (!byLang[lang] || byLang[lang].trim() === "") missing.push(`${key}.${lang}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
