// Derives src/i18n/generated/<lang>.json (flat key -> string, one file per language) from the
// single authoring source src/i18n/translations.ts, so LanguageContext.tsx can lazy-load only the
// ACTIVE language at runtime instead of shipping all 6 languages' text in the main bundle.
// translations.ts itself is untouched -- still the one file to edit when adding a translation key,
// still what translations.test.ts imports directly for its cross-language completeness check.
// Run automatically (see the i18nGeneratedLocales plugin in vite.config.ts) on both `npm run dev`
// and `npm run build`, and again whenever translations.ts changes during dev -- never a manual
// step, so the generated files can't silently drift out of sync.
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outDir = path.join(root, "src", "i18n", "generated");
const sourcePath = path.join(root, "src", "i18n", "translations.ts");

// Compiled via esbuild rather than relying on Node's own native TypeScript stripping
// (`--experimental-strip-types`) -- that flag is a genuinely recent Node addition, and this
// script also runs inside whatever Node version Lovable's own cloud build happens to use, not
// just this machine's (deliberately kept current for Capacitor tooling, per club-identity.ts's
// own history -- no guarantee a build environment matches). esbuild is guaranteed present
// regardless, since it's Vite's own bundler dependency, and needs no special flags to run.
const source = await readFile(sourcePath, "utf-8");
const { code } = await esbuild.transform(source, { loader: "ts", format: "esm" });
const dataUrl = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const { translations, LANGUAGES } = await import(dataUrl);

await mkdir(outDir, { recursive: true });

for (const lang of LANGUAGES) {
  const flat = {};
  for (const [key, byLang] of Object.entries(translations)) flat[key] = byLang[lang];
  await writeFile(path.join(outDir, `${lang}.json`), JSON.stringify(flat), "utf-8");
}

console.log(`[i18n] generated ${LANGUAGES.length} locale files (${Object.keys(translations).length} keys each) -> src/i18n/generated/`);
