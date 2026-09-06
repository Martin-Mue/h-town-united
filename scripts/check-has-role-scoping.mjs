/**
 * Round 3 backend/security audit: static lint over the migration history for the exact bug class
 * that let the `clubs` UPDATE policy stay unscoped (any admin of any club could overwrite any
 * other club's branding) — a `has_role(auth.uid(), '<role>')` check with no accompanying
 * `<column> = public.current_club_id()` condition, on a policy or SECURITY DEFINER function that
 * survives as the CURRENT definition (last CREATE POLICY / CREATE [OR REPLACE] FUNCTION for that
 * name, in migration filename order — an earlier version later dropped/replaced doesn't count).
 *
 * `has_role()` itself has no `club_id` parameter (documented, deliberately-accepted structural
 * risk in 20260905090000_scope_has_role_checks_to_club.sql — that migration's own comment notes
 * this exact class of bug had ALREADY caused two prior regressions from copying a stale function
 * body instead of the live one), so nothing stops a new policy from forgetting the scoping
 * condition again. This script is the cheap backstop for that until/unless has_role() itself
 * grows a club_id parameter — no live DB access needed, just the migration files.
 *
 * Run: node scripts/check-has-role-scoping.mjs [migrationsDir]  (defaults to supabase/migrations)
 * Exit code 1 and a list of offenders if anything is found; run it after adding any new RLS
 * policy or SECURITY DEFINER function that calls has_role(), and periodically otherwise. Not
 * wired into CI (this project has none) — a manual check, same spirit as an eslint rule you run
 * by hand. A real positive here needs one of two fixes: add the missing
 * `<column> = public.current_club_id()` condition, or — only when the check is genuinely meant to
 * span every club, verified against that table's own migration comments the way
 * training_samples's exclusion is documented in 20260830140000_add_club_id_columns.sql — add it
 * to the ALLOWLIST below with the reason written out.
 */
import fs from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = process.argv[2] || "supabase/migrations";

/** Splits a SQL file into top-level statements, respecting dollar-quoted bodies ($$ / $tag$) so a
 *  semicolon inside a PL/pgSQL function body doesn't get mistaken for a statement boundary. */
function splitStatements(sql) {
  const statements = [];
  let dollarTag = null;
  let start = 0;
  for (let i = 0; i < sql.length; i++) {
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        i += dollarTag.length - 1;
        dollarTag = null;
      }
      continue;
    }
    if (sql[i] === "$") {
      const m = /^\$[a-zA-Z_]*\$/.exec(sql.slice(i));
      if (m) {
        dollarTag = m[0];
        i += m[0].length - 1;
        continue;
      }
    }
    if (sql[i] === ";") {
      statements.push(sql.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (sql.slice(start).trim()) statements.push(sql.slice(start));
  return statements;
}

const POLICY_RE = /create\s+policy\s+"([^"]+)"\s+on\s+([a-z0-9_.]+)/i;
const FUNCTION_RE = /create\s+(?:or\s+replace\s+)?function\s+([a-z0-9_.]+)/i;
const DROP_POLICY_RE = /drop\s+policy\s+(?:if\s+exists\s+)?"([^"]+)"\s+on\s+([a-z0-9_.]+)/i;
/** Marks where a function's BODY starts (as/language), so has_role()/current_club_id() checks
 *  only look at the body, not the signature — otherwise `create function public.has_role(...)`
 *  always "contains has_role(" simply by naming itself, a guaranteed false positive. */
const FUNCTION_BODY_START_RE = /\b(?:as\s+\$|language\s+\w+)/i;

/** Explicit exceptions: a has_role() call with no club_id/current_club_id() scoping that is
 *  intentional, with the reason documented right here so a reviewer doesn't have to go dig it up
 *  again. Add to this list ONLY with a real, verified reason — the whole point of this script is
 *  that a silent, UNDOCUMENTED unscoped has_role() is exactly the bug class Round 3 found in the
 *  wild (the `clubs` UPDATE policy). Verify against the table's own schema/migration comments
 *  before allowlisting, the way 20260830140000_add_club_id_columns.sql documents this one.
 */
const ALLOWLIST = new Set([
  // training_samples / dart-training storage: 20260830140000_add_club_id_columns.sql explicitly
  // excludes this table from the club_id backfill with its own documented reason — "camera ML
  // training data stays pooled across clubs, not competitive/private content". Admin-only
  // visibility here is an extra precaution against regular members browsing/wiping it, not meant
  // to be club-scoped at all. Genuinely intentional, not an oversight.
  "policy:public.training_samples.Admins can view training samples",
  "policy:public.training_samples.Admins can delete training samples",
  "policy:storage.objects.Admins can read training images",
  "policy:storage.objects.Admins can delete training images",
]);

function scan(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  /** name -> { hasRole: boolean, scoped: boolean, file: string, kind: 'policy'|'function' } */
  const current = new Map();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    for (const stmt of splitStatements(sql)) {
      const dropPolicy = DROP_POLICY_RE.exec(stmt);
      if (dropPolicy) {
        current.delete(`policy:${dropPolicy[2]}.${dropPolicy[1]}`);
        continue;
      }
      const policy = POLICY_RE.exec(stmt);
      if (policy) {
        const key = `policy:${policy[2]}.${policy[1]}`;
        const hasRole = /has_role\s*\(/i.test(stmt);
        const scoped = /current_club_id\s*\(\s*\)/i.test(stmt);
        current.set(key, { hasRole, scoped, file, kind: "policy" });
        continue;
      }
      const fn = FUNCTION_RE.exec(stmt);
      if (fn) {
        const key = `function:${fn[1]}`;
        const bodyStart = FUNCTION_BODY_START_RE.exec(stmt);
        const body = bodyStart ? stmt.slice(bodyStart.index) : stmt;
        const hasRole = /has_role\s*\(/i.test(body);
        const scoped = /current_club_id\s*\(\s*\)/i.test(body);
        current.set(key, { hasRole, scoped, file, kind: "function" });
        continue;
      }
    }
  }
  return current;
}

function main() {
  const current = scan(MIGRATIONS_DIR);
  const flagged = [];
  const ok = [];
  for (const [key, info] of current) {
    if (!info.hasRole) continue;
    if (info.scoped || ALLOWLIST.has(key)) {
      ok.push(key);
      continue;
    }
    flagged.push({ key, ...info });
  }

  console.log(`Checked ${current.size} current policy/function definitions, ${ok.length + flagged.length} reference has_role().`);
  if (flagged.length === 0) {
    console.log("OK: every current has_role() check is club-scoped (or explicitly allowlisted).");
    return 0;
  }
  console.log(`\nFOUND ${flagged.length} unscoped has_role() check(s) — same bug class as the Round 3 clubs UPDATE policy finding:\n`);
  for (const f of flagged) {
    console.log(`  [${f.kind}] ${f.key}  (last defined in ${f.file})`);
  }
  console.log("\nEach of these should either gain a `<club column> = public.current_club_id()` condition,");
  console.log("or be added to ALLOWLIST in this script with a documented reason.");
  return 1;
}

process.exit(main());
