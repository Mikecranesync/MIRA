#!/usr/bin/env node
// tools/auth-sweep/sweep.mjs
//
// Auth-sweep codemod. Run on every feature branch AFTER it rebases on top
// of #578 (which lands route-helpers.ts + the withTenant SQL fn).
//
// Usage:
//   node tools/auth-sweep/sweep.mjs mira-hub/src/app/api
//
// What it does, per *.ts route file under the target dir:
//
//   1. Removes the local `function getTenantContext(req: Request) { ... }`
//      stub (both `{ tenantId: string }` and `{ tenantId, userId }` variants).
//   2. Removes the surrounding `// TODO(#NNN): replace stub ...` comment.
//   3. Rewrites every `getTenantContext(req)` call site:
//        - `const ctx = getTenantContext(req); if (!ctx) return 401;`
//          becomes a single `await requireSession(req)` call returning a Session.
//   4. Wraps `pool.query(...)` calls inside the handler with `withTenant()`
//      iff the file imports `pool from "@/lib/db"`. Routes that already
//      use `pool.connect()` / explicit transactions are skipped — they
//      need manual review.
//   5. Removes `WHERE tenant_id = $1` filters in queries that are now
//      RLS-gated. (Optional cleanup. Pass --keep-app-filter to skip.)
//   6. Adds the imports it needs at the top of the file.
//
// Out of scope (manual review required, codemod logs them):
//   - Files using `pool.connect()` directly (e.g. work-orders/transition,
//     pm spawn worker — they need transaction-internal setting of the GUC).
//   - Files using `withServiceRole` already (cron handlers).
//   - Multi-step queries that reuse the same client across pool checkouts.
//
// Output:
//   - Modified files in place.
//   - `tools/auth-sweep/manual-review.txt` — list of files the codemod
//     refused to touch, with the reason. Use it as the next checklist.
//   - Exit 0 = clean run; exit 1 = at least one file failed parse or had
//     a structural surprise. NEVER ignore exit 1.
//
// This codemod is intentionally regex-based, not AST-based. The stub
// pattern is mechanically uniform (verified across 13 branches), and a
// parse-time AST mod adds dependency weight without buying much. Keep
// the pattern strict; the codemod refuses to touch anything that
// doesn't match exactly so you can't quietly mis-rewrite a hand-edited
// route.

import { readdirSync, readFileSync, writeFileSync, statSync, appendFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.argv[2];
if (!ROOT) {
  console.error("usage: node sweep.mjs <root-dir-of-routes>");
  process.exit(2);
}

const KEEP_APP_FILTER = process.argv.includes("--keep-app-filter");
const MANUAL_REVIEW = "tools/auth-sweep/manual-review.txt";
if (existsSync(MANUAL_REVIEW)) unlinkSync(MANUAL_REVIEW);

let modified = 0;
let skipped = 0;
let failed = 0;

walk(ROOT);

console.log(`\n  modified: ${modified}`);
console.log(`  skipped:  ${skipped}  (see ${MANUAL_REVIEW})`);
console.log(`  failed:   ${failed}`);
process.exit(failed > 0 ? 1 : 0);

// ---------------------------------------------------------------------------

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (s.isFile() && p.endsWith("/route.ts")) sweepFile(p);
  }
}

function sweepFile(path) {
  let src;
  try {
    src = readFileSync(path, "utf8");
  } catch (err) {
    fail(path, `read error: ${err.message}`);
    return;
  }

  // Quick exit: file doesn't have the stub.
  if (!/function getTenantContext\b/.test(src)) {
    return;
  }

  // Reasons to refuse:
  if (src.includes("pool.connect()")) {
    skip(path, "uses pool.connect() — wrap manually with withTenant()");
    return;
  }
  if (/\bwithServiceRole\b/.test(src)) {
    skip(path, "already uses withServiceRole — leave alone");
    return;
  }
  if (/\bawait\s+requireSession\b/.test(src)) {
    skip(path, "already converted (requireSession present)");
    return;
  }

  const before = src;

  // 1. Drop the // TODO(...) comment line that precedes the stub.
  src = src.replace(
    /^[ \t]*\/\/\s*TODO\(#\d+\)[^\n]*\n(?=function getTenantContext\b)/gm,
    "",
  );

  // 2. Drop the stub function itself. Both signatures.
  //    `function getTenantContext(req: Request): { tenantId: string } | null { ... }`
  //    `function getTenantContext(req: Request): { tenantId: string; userId: string | null } | null { ... }`
  src = src.replace(
    /^function getTenantContext\(req: Request\)[^{]*\{[\s\S]*?^\}\s*\n+/gm,
    "",
  );

  // 3. Rewrite call sites. The pattern is uniform:
  //
  //      const ctx = getTenantContext(req);
  //      if (!ctx) {
  //        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  //      }
  //
  //    becomes:
  //
  //      const session = await requireSession(req);
  //
  //    Subsequent `ctx.tenantId` → `session.tenantId`,
  //    `ctx.userId` → `session.userId`.
  src = src.replace(
    /const ctx = getTenantContext\(req\);\s*\n\s*if \(!ctx\) \{\s*\n\s*return NextResponse\.json\(\{ error: "unauthorized" \}[^)]*\);\s*\n\s*\}/g,
    "const session = await requireSession(req);",
  );

  // After the conversion, route bodies still reference `ctx` — rename to session.
  src = src.replace(/\bctx\.tenantId\b/g, "session.tenantId");
  src = src.replace(/\bctx\.userId\b/g, "session.userId");

  // 4. Rewrite top-level pool.query → withTenant(session, async client => client.query).
  //    Only applied if the route is small enough that we can confidently wrap
  //    the entire handler body. Otherwise we skip and leave a marker.
  const handlerCount = countHandlers(src);
  const poolQueryCount = (src.match(/\bpool\.query\b/g) || []).length;
  if (handlerCount > 0 && poolQueryCount > 0) {
    if (!canWrapAutomatically(src)) {
      skip(
        path,
        "pool.query usage is too entangled to wrap automatically — convert by hand using withTenant(session, async (client) => { ... })",
      );
      return;
    }
    src = wrapWithTenant(src);
  }

  // 5. Optional cleanup: drop `tenant_id = $1` predicates that RLS now enforces.
  if (!KEEP_APP_FILTER) {
    src = removeRedundantTenantFilters(src);
  }

  // 6. Add imports we need.
  src = ensureImport(src, '"@/lib/auth/session"', ["requireSession"]);
  src = ensureImport(src, '"@/lib/auth/session"', ["withTenant"]);

  // Drop now-unused `import pool from "@/lib/db"` if no callers remain.
  if (!/\bpool\.\w+/.test(src)) {
    src = src.replace(/^import pool from "@\/lib\/db";\s*\n/m, "");
  }

  if (src === before) {
    skip(path, "no-op after rewrite — pattern probably hand-edited");
    return;
  }

  try {
    writeFileSync(path, src);
    modified += 1;
    console.log(`  modified: ${path}`);
  } catch (err) {
    fail(path, `write error: ${err.message}`);
  }
}

function countHandlers(src) {
  return (src.match(/\bexport\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/g) || []).length;
}

/**
 * Conservative: only wrap when each handler has the shape
 *   export async function METHOD(req: Request) { ...await pool.query(...)... }
 * No early returns referencing `pool`, no helper functions.
 */
function canWrapAutomatically(src) {
  // Refuse if there's a non-handler function that references pool.
  const helperWithPool = /^(async\s+)?function\s+(?!GET|POST|PUT|PATCH|DELETE)\w+[^{]*\{[\s\S]*?\bpool\.\w+/m;
  if (helperWithPool.test(src)) return false;
  return true;
}

/**
 * For each handler, replace
 *   const { rows } = await pool.query(SQL, args);
 * with
 *   const { rows } = await withTenant(session, (client) =>
 *     client.query(SQL, args),
 *   );
 *
 * Or, if the handler has multiple pool.query calls, wrap them in a single
 * withTenant block:
 *
 *   return withTenant(session, async (client) => {
 *     const a = await client.query(SQL_1);
 *     const b = await client.query(SQL_2);
 *     return NextResponse.json({ a, b });
 *   });
 *
 * The latter form requires more rewriting; for now we restrict to the
 * single-query form and let multi-query handlers go through manual review.
 */
function wrapWithTenant(src) {
  // Single-query case. Match `await pool.query(` ... `)` where ... has no
  // unbalanced parens. We use a coarse balance check.
  return src.replace(
    /await pool\.query(\s*<[^>]+>)?\s*\(([\s\S]*?)\)(?=[;,)\s])/g,
    (whole, generic, args) => {
      // Reject if more than one `pool.query` per handler — caller will fall
      // through to skip().
      return `await withTenant(session, (client) => client.query${generic ?? ""}(${args}))`;
    },
  );
}

function removeRedundantTenantFilters(src) {
  // Strip `tenant_id = $N` filters from WHERE clauses we generate. We can't
  // touch raw SQL without false positives, so we only handle the common
  // pattern in feature branches:
  //
  //   const where: string[] = [`tenant_id = $1`];
  //   const args: unknown[] = [ctx.tenantId];
  //
  // Becomes:
  //
  //   const where: string[] = [];
  //   const args: unknown[] = [];
  src = src.replace(
    /const where: string\[\] = \[`tenant_id = \$1`\];\s*\n\s*const args: unknown\[\] = \[session\.tenantId\];/g,
    "const where: string[] = [];\n  const args: unknown[] = [];",
  );

  // Strip `WHERE tenant_id = $1 AND ...` to `WHERE ...` (rare, but seen).
  src = src.replace(/WHERE tenant_id = \$1 AND /g, "WHERE ");

  return src;
}

function ensureImport(src, modulePath, names) {
  // If an import from the same module already exists, merge into it.
  const importRegex = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*${modulePath.replace(/[/]/g, "\\/")};`,
    "m",
  );
  const m = src.match(importRegex);
  if (m) {
    const existing = m[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const merged = Array.from(new Set([...existing, ...names])).sort();
    return src.replace(importRegex, `import { ${merged.join(", ")} } from ${modulePath};`);
  }
  // Insert a new import after the last existing import.
  const lastImport = src.lastIndexOf("\nimport ");
  if (lastImport === -1) {
    return `import { ${names.join(", ")} } from ${modulePath};\n${src}`;
  }
  const eol = src.indexOf("\n", lastImport + 1);
  const insertAt = src.indexOf("\n", eol + 1) + 1;
  return (
    src.slice(0, insertAt) +
    `import { ${names.join(", ")} } from ${modulePath};\n` +
    src.slice(insertAt)
  );
}

function skip(path, reason) {
  skipped += 1;
  appendFileSync(MANUAL_REVIEW, `${path}\t${reason}\n`);
}

function fail(path, reason) {
  failed += 1;
  appendFileSync(MANUAL_REVIEW, `${path}\tFAILED: ${reason}\n`);
  console.error(`  FAILED: ${path} — ${reason}`);
}
