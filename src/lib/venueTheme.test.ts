import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveVenueThemeVars } from "./venueTheme";
import { resolveClubTheme } from "./clubThemePresets";

describe("resolveVenueThemeVars", () => {
  it("gives Dartspot its yellow action color with black text, never the light-mode black", () => {
    const venue = resolveVenueThemeVars("dartspot");
    expect(venue["--venue-primary"]).toBe("47 98% 67%");
    expect(venue["--venue-primary-foreground"]).toBe("80 16% 4%");
    // The light-mode primary is the near-black that would vanish on the dark panel.
    expect(venue["--venue-primary"]).not.toBe(resolveClubTheme("dartspot", "light")["--primary"]);
  });

  it("keeps Cyan clubs exactly on today's dark cyan / green / gold", () => {
    const venue = resolveVenueThemeVars("default");
    expect(venue["--venue-primary"]).toBe("185 85% 48%");
    expect(venue["--venue-primary-foreground"]).toBe("222 30% 5%");
    expect(venue["--venue-secondary"]).toBe("155 65% 42%");
    expect(venue["--venue-accent"]).toBe("45 100% 58%");
  });

  it("maps every role of the dark preset, for every token the venue surface re-maps", () => {
    const dark = resolveClubTheme("violett", "dark");
    const venue = resolveVenueThemeVars("violett");
    for (const token of ["primary", "primary-foreground", "secondary", "secondary-foreground", "accent", "accent-foreground", "ring"]) {
      expect(venue[`--venue-${token}`]).toBe(dark[`--${token}`]);
    }
  });

  it("has CSS fallbacks in index.css that match the Cyan dark tones (cold start before the club loads)", () => {
    const css = readFileSync(resolve(__dirname, "../index.css"), "utf8");
    const cyan = resolveVenueThemeVars("default");
    for (const [name, value] of Object.entries(cyan)) {
      const uses = [...css.matchAll(new RegExp(`var\\(${name},\\s*([^)]+)\\)`, "g"))];
      expect(uses.length, `${name} is read in index.css`).toBeGreaterThan(0);
      for (const use of uses) expect(use[1].trim()).toBe(value);
    }
  });
});
