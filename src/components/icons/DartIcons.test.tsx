// @vitest-environment jsdom
//
// Round 3 Rang 13: this project's first component render() test. `@testing-library/react` and
// `jsdom` were already devDependencies, but nothing actually wired up a jsdom test environment —
// there's no vitest.config.ts and no `test.environment` in vite.config.ts, so any earlier attempt
// at render() would have failed immediately with "document is not defined" (vitest defaults to
// the plain "node" environment). This file sets the environment locally via the per-file
// `@vitest-environment` docblock instead of touching the shared/global vitest config, so every
// other existing *.test.ts file (all pure-logic, no DOM) keeps running exactly as before — a
// deliberately scoped fix, not a global config change nobody could verify without a real test run.
//
// DartIcons.tsx (Round 3 Rang 6) is the target: eight small, stateless, prop-passthrough SVG
// components with zero context/hook dependencies — the lowest-risk, highest-value place to start
// actual component coverage from, unlike Game.tsx/Tournament.tsx which need a large web of
// provider mocks (auth, language, club branding, router, supabase) to render at all.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  HomeIcon,
  DartGameIcon,
  StatsIcon,
  TrainingIcon,
  DartTrophyIcon,
  ClubIcon,
  SeasonIcon,
  AdminIcon,
  DartLoaderIcon,
} from "./DartIcons";

// @testing-library/react's auto-cleanup relies on detecting global test hooks (vitest's
// `test.globals`), which this project doesn't enable (every existing test file explicitly
// imports describe/it/expect from "vitest" instead) — so cleanup is wired up by hand here to
// keep each test's render() isolated instead of silently relying on framework auto-registration.
afterEach(cleanup);

const ALL_ICONS = {
  HomeIcon, DartGameIcon, StatsIcon, TrainingIcon, DartTrophyIcon, ClubIcon, SeasonIcon, AdminIcon, DartLoaderIcon,
} as const;

describe("DartIcons", () => {
  it("renders every icon in the set as a single <svg> with no thrown error", () => {
    for (const [name, Icon] of Object.entries(ALL_ICONS)) {
      const { container, unmount } = render(<Icon />);
      const svgs = container.querySelectorAll("svg");
      expect(svgs.length, `${name} should render exactly one <svg>`).toBe(1);
      unmount();
    }
  });

  it("keeps every icon on the shared BASE_PROPS convention (drop-in lucide-react replacement contract)", () => {
    // This is the doc comment's actual promise: same 24x24 viewBox, stroke="currentColor",
    // fill="none" — so every existing call site's className-based sizing/coloring keeps working
    // unchanged. A future edit that drifts one icon off this convention would silently break
    // sizing/coloring only for that one nav item; this test turns that into a loud failure.
    for (const [name, Icon] of Object.entries(ALL_ICONS)) {
      const { container, unmount } = render(<Icon />);
      const svg = container.querySelector("svg");
      expect(svg, `${name} missing its <svg>`).toBeTruthy();
      expect(svg?.getAttribute("viewBox"), `${name} viewBox`).toBe("0 0 24 24");
      expect(svg?.getAttribute("stroke"), `${name} stroke`).toBe("currentColor");
      expect(svg?.getAttribute("fill"), `${name} fill`).toBe("none");
      unmount();
    }
  });

  it("passes through arbitrary SVG props (className, width/height overrides) like lucide-react icons do", () => {
    // The whole point of matching lucide's own prop shape: existing call sites do
    // `<HomeIcon className="w-5 h-5" />` and expect it to just work, same as swapping in any
    // lucide icon would. width/height are explicitly overridable too (not locked to BASE_PROPS'
    // own 24), since {...BASE_PROPS} is spread before {...props} in every icon.
    const { container } = render(<HomeIcon className="w-5 h-5 text-primary" width={32} height={32} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class")).toBe("w-5 h-5 text-primary");
    expect(svg?.getAttribute("width")).toBe("32");
    expect(svg?.getAttribute("height")).toBe("32");
  });

  it("gives every icon at least one drawn path/shape (never an empty <svg>)", () => {
    for (const [name, Icon] of Object.entries(ALL_ICONS)) {
      const { container, unmount } = render(<Icon />);
      const shapes = container.querySelectorAll("path, circle, rect");
      expect(shapes.length, `${name} should draw at least one shape`).toBeGreaterThan(0);
      unmount();
    }
  });
});
