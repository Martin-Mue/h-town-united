import { describe, it, expect } from "vitest";
import { resolveClubTheme } from "./clubThemePresets";

describe("resolveClubTheme", () => {
  it("reproduces today's index.css light-mode values for the default preset", () => {
    const vars = resolveClubTheme("default", "light");
    expect(vars["--primary"]).toBe("185 85% 38%");
    expect(vars["--secondary"]).toBe("155 65% 34%");
    expect(vars["--accent"]).toBe("42 95% 45%");
    expect(vars["--ring"]).toBe("185 85% 38%");
    expect(vars["--dart-cyan"]).toBe("185 85% 38%");
    expect(vars["--dart-green"]).toBe("155 65% 34%");
    expect(vars["--dart-gold"]).toBe("42 95% 45%");
  });

  it("reproduces today's index.css dark-mode values for the default preset", () => {
    const vars = resolveClubTheme("default", "dark");
    expect(vars["--primary"]).toBe("185 85% 48%");
    expect(vars["--secondary"]).toBe("155 65% 42%");
    expect(vars["--accent"]).toBe("45 100% 58%");
    expect(vars["--ring"]).toBe("185 85% 48%");
  });

  it("falls back to the default preset for an unknown preset id", () => {
    const known = resolveClubTheme("default", "dark");
    const unknown = resolveClubTheme("does-not-exist", "dark");
    expect(unknown).toEqual(known);
  });

  it("produces a distinct hue for each preset", () => {
    const ids = ["default", "ozeanblau", "violett", "bordeaux"];
    const primaries = ids.map((id) => resolveClubTheme(id, "dark")["--primary"]);
    expect(new Set(primaries).size).toBe(ids.length);
  });
});
