import { describe, it, expect } from "vitest";
import { translate } from "./translations";

describe("translate", () => {
  it("returns the German string for a known key", () => {
    expect(translate("nav.tournament", "de")).toBe("Turnier");
  });

  it("returns the English string for the same known key", () => {
    expect(translate("nav.tournament", "en")).toBe("Tournament");
  });

  it("falls back to the key itself for an unknown key, in either language", () => {
    expect(translate("nonexistent.key", "de")).toBe("nonexistent.key");
    expect(translate("nonexistent.key", "en")).toBe("nonexistent.key");
  });
});
