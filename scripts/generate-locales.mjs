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
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outDir = path.join(root, "src", "i18n", "generated");
const sourcePath = path.join(root, "src", "i18n", "translations.ts");

// Compiled via the `typescript` package's own transpileModule -- a pure-JS compiler with no
// native binary of its own. This used to go through esbuild.transform() instead (Vite's own
// bundler dependency, so "guaranteed present"), but esbuild ships a platform-specific NATIVE
// binary that has to exactly match its JS wrapper's version -- and this repo's mixed install
// history is a real risk for that: bun.lock, bun.lockb AND package-lock.json are all still
// present at the repo root (leftover from installing with different package managers at
// different times), and package.json's own `allowScripts` block lists TWO different esbuild
// versions as trusted (0.21.5 and 0.25.0) -- clear evidence more than one copy has been
// installed at once. Whenever Lovable's cloud build happens to end up with a JS wrapper next to
// the WRONG native binary, esbuild.transform() throws a version-mismatch error with nothing
// wrong in translations.ts itself -- which, before this script's own defensive checks further
// down existed, used to silently ship every locale file empty, and after them, would instead
// fail the whole build outright (see vite.config.ts's throwOnError). Either way, real users saw
// raw translation keys ("nav.home") in the shipped app for a cause that had nothing to do with
// the translations themselves. `typescript` is a plain-JS, already-required devDependency (this
// project also uses it for type-checking) with no native binary at all, so it can't fail this
// way regardless of which package manager actually populated node_modules this time.
const source = await readFile(sourcePath, "utf-8");
const { outputText: code } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const dataUrl = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const { translations, LANGUAGES } = await import(dataUrl);

// Defensive: fail loudly rather than silently writing empty/near-empty locale files if the
// dynamic import above somehow came back with nothing usable (a genuinely blank translations.ts,
// a transpile that produced a module with no exports, ...). Without this check, an empty
// `translations` object would still write out valid-but-empty JSON for every language -- which
// then makes every t(key) call in the app fall back to showing the raw key, with nothing in this
// script's own output flagging that anything went wrong.
if (!Array.isArray(LANGUAGES) || LANGUAGES.length === 0) {
  throw new Error("[i18n] translations.ts's LANGUAGES export came back empty -- refusing to write locale files.");
}
if (!translations || Object.keys(translations).length === 0) {
  throw new Error("[i18n] translations.ts's translations export came back empty -- refusing to write locale files.");
}

await mkdir(outDir, { recursive: true });

for (const lang of LANGUAGES) {
  const flat = {};
  for (const [key, byLang] of Object.entries(translations)) flat[key] = byLang[lang];
  await writeFile(path.join(outDir, `${lang}.json`), JSON.stringify(flat), "utf-8");
}

console.log(`[i18n] generated ${LANGUAGES.length} locale files (${Object.keys(translations).length} keys each) -> src/i18n/generated/`);
