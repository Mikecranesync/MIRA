#!/usr/bin/env node
/**
 * mira-hub route sitemap generator + drift guard.
 *
 * The Next.js App Router makes the route table a pure function of the
 * filesystem: every `page.tsx` is a user-facing page, every `route.ts` is an
 * API endpoint. This script derives the canonical route inventory from
 * `src/app`, writes a human sitemap (`docs/SITEMAP.md`) and a machine snapshot
 * (`docs/sitemap.snapshot.json`), and — in `--check` mode — fails when the live
 * filesystem no longer matches the committed snapshot.
 *
 * That is the standard "golden file" pattern: routes can't be added or removed
 * without the snapshot (and the diff that documents it) changing, so we always
 * know when the surface area of the app changed.
 *
 *   node scripts/sitemap.mjs           # regenerate SITEMAP.md + snapshot
 *   node scripts/sitemap.mjs --check   # exit 1 if the FS drifted from snapshot
 *
 * URL mapping (App Router):
 *   - route groups `(group)` and private `_dirs` are stripped from the URL
 *   - `[id]` dynamic segment is kept verbatim (team vocabulary)
 *   - `[...slug]` / `[[...slug]]` catch-alls kept verbatim
 *   - live URL = `<basePath>` + route   (basePath defaults to `/hub`)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HUB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = path.join(HUB_ROOT, "src", "app");
const SNAPSHOT = path.join(HUB_ROOT, "docs", "sitemap.snapshot.json");
const SITEMAP_MD = path.join(HUB_ROOT, "docs", "SITEMAP.md");
const BASE_PATH = "/hub"; // next.config.ts: basePath ?? "/hub"

const PAGE_FILES = new Set(["page.tsx", "page.ts", "page.jsx", "page.js"]);
const ROUTE_FILES = new Set(["route.ts", "route.tsx", "route.js"]);

/** Convert an `src/app`-relative directory to its URL route. */
function dirToRoute(relDir) {
  const segs = relDir.split(path.sep).filter(Boolean);
  const urlSegs = [];
  for (const s of segs) {
    if (/^\(.*\)$/.test(s)) continue; // route group — not in URL
    if (s.startsWith("_")) continue; // private folder — not a route
    urlSegs.push(s); // [id], [...slug], [[...slug]] kept verbatim
  }
  return "/" + urlSegs.join("/");
}

const isDynamic = (route) => /\[.+\]/.test(route);

/** Walk `src/app`, classifying every page.tsx / route.ts. */
function discoverRoutes() {
  const pages = [];
  const apiRoutes = [];

  const walk = (absDir) => {
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      const abs = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      const rel = path.relative(APP_DIR, absDir);
      if (PAGE_FILES.has(entry.name)) {
        const route = dirToRoute(rel);
        pages.push({ route, dynamic: isDynamic(route), file: path.join(rel, entry.name).replaceAll(path.sep, "/") });
      } else if (ROUTE_FILES.has(entry.name)) {
        const route = dirToRoute(rel);
        apiRoutes.push({ route, dynamic: isDynamic(route), file: path.join(rel, entry.name).replaceAll(path.sep, "/") });
      }
    }
  };
  walk(APP_DIR);

  const byRoute = (a, b) => a.route.localeCompare(b.route);
  pages.sort(byRoute);
  apiRoutes.sort(byRoute);
  return { pages, apiRoutes };
}

/** Stable snapshot object — only the bits that define the route surface. */
function snapshotOf({ pages, apiRoutes }) {
  return {
    basePath: BASE_PATH,
    counts: { pages: pages.length, apiRoutes: apiRoutes.length },
    pages: pages.map((p) => p.route),
    apiRoutes: apiRoutes.map((r) => r.route),
  };
}

function renderMarkdown({ pages, apiRoutes }) {
  const live = (route) => `https://app.factorylm.com${BASE_PATH}${route === "/" ? "" : route}/`;
  const pageRows = pages
    .map((p) => `| \`${p.route}\` | ${p.dynamic ? "dynamic" : "static"} | \`${p.file}\` |`)
    .join("\n");
  const apiRows = apiRoutes
    .map((r) => `| \`${r.route}\` | ${r.dynamic ? "dynamic" : "static"} | \`${r.file}\` |`)
    .join("\n");

  return `# mira-hub — Route Sitemap

> **Generated** by \`scripts/sitemap.mjs\` from the \`src/app\` filesystem. Do not edit by hand.
> Regenerate with \`bun run sitemap\`; CI fails (\`bun run sitemap:check\`) if this drifts.
>
> **basePath:** \`${BASE_PATH}\` — live URL = \`https://app.factorylm.com${BASE_PATH}\` + route.
> Example: \`/command-center\` → ${live("/command-center")}

## Summary

| Surface | Count |
|---|---|
| Pages | **${pages.length}** (${pages.filter((p) => p.dynamic).length} dynamic) |
| API routes | **${apiRoutes.length}** (${apiRoutes.filter((r) => r.dynamic).length} dynamic) |

## Pages (${pages.length})

| Route | Kind | Source |
|---|---|---|
${pageRows}

## API routes (${apiRoutes.length})

| Route | Kind | Source |
|---|---|---|
${apiRows}

## Change history (the route changelog)

This file + \`docs/sitemap.snapshot.json\` are the recorded route surface. Their
**git history is the route changelog** — every add/remove of a page or API
route shows up as a diff to the snapshot, enforced by the \`sitemap-drift\` test:

\`\`\`
git log --oneline -p docs/sitemap.snapshot.json   # when did the surface change, and how
\`\`\`

A PR that adds or removes a route fails CI until \`bun run sitemap\` is re-run and
both files are committed — so the surface area can never change silently.

## Functionality check

Per-route health (HTTP status, console errors, unhandled exceptions, paint
time) is crawled by \`tests/e2e/hub-page-audit.spec.ts\` against the live hub;
reports land in \`docs/audits/<date>-audit.md\`. Run on demand:

\`\`\`
gh workflow run enforcement-audit.yml          # CI run against prod, uploads report
HUB_URL=https://app.factorylm.com npx playwright test tests/e2e/hub-page-audit.spec.ts
\`\`\`
`;
}

function arraysDiff(label, oldArr, newArr) {
  const oldSet = new Set(oldArr);
  const newSet = new Set(newArr);
  const added = newArr.filter((x) => !oldSet.has(x));
  const removed = oldArr.filter((x) => !newSet.has(x));
  const lines = [];
  for (const a of added) lines.push(`  + ${label}: ${a}`);
  for (const r of removed) lines.push(`  - ${label}: ${r}`);
  return lines;
}

function main() {
  const check = process.argv.includes("--check");
  const discovered = discoverRoutes();
  const snap = snapshotOf(discovered);

  if (check) {
    if (!fs.existsSync(SNAPSHOT)) {
      console.error("[sitemap] no snapshot found — run `bun run sitemap` and commit docs/sitemap.snapshot.json");
      process.exit(1);
    }
    const committed = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
    const diffs = [
      ...arraysDiff("page", committed.pages ?? [], snap.pages),
      ...arraysDiff("api", committed.apiRoutes ?? [], snap.apiRoutes),
    ];
    if (diffs.length > 0) {
      console.error("[sitemap] ROUTE DRIFT — the app's routes changed but docs/sitemap.snapshot.json was not updated:\n");
      console.error(diffs.join("\n"));
      console.error("\nIf this change is intentional, run `bun run sitemap` and commit");
      console.error("docs/SITEMAP.md + docs/sitemap.snapshot.json (the diff is your changelog entry).");
      process.exit(1);
    }
    console.log(`[sitemap] OK — ${snap.counts.pages} pages, ${snap.counts.apiRoutes} api routes match the snapshot.`);
    return;
  }

  fs.mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
  fs.writeFileSync(SNAPSHOT, JSON.stringify(snap, null, 2) + "\n");
  fs.writeFileSync(SITEMAP_MD, renderMarkdown(discovered));
  console.log(`[sitemap] wrote docs/SITEMAP.md + docs/sitemap.snapshot.json (${snap.counts.pages} pages, ${snap.counts.apiRoutes} api routes).`);
}

export { discoverRoutes, snapshotOf, SNAPSHOT };

// Only run the CLI when invoked directly (not when imported by the drift test).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
