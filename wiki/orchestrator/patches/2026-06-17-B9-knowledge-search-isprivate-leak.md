# B9 staged fix — close cross-tenant LEAK in /api/knowledge/search (P1, beta-path: YES)

**Audited vs origin/main @5747e79e (HEAD feat/hub-e2e-ci was 3 behind; mira-hub byte-matches main).**

## What / why
`mira-hub/src/app/api/knowledge/search/route.ts` (GET, behind `sessionOr401`) full-text-searches
`knowledge_entries` with **NO `is_private` and NO `tenant_id` predicate** on BOTH queries (BM25
`content_tsv` L66-67 + ILIKE fallback L96-101), returning `LEFT(content,220) AS snippet` + title +
source_url. The route comment ("OEM manuals are universal; no tenant filter") predates the corpus
becoming **hybrid**: per-tenant `is_private = true` uploads now live in `knowledge_entries` (via
`/api/documents/upload` and onboarding upload→ask #1901). A universal full-text match therefore
returns **other tenants' private uploaded-manual snippets/titles/source_urls** to any signed-up
caller — the #1833 cross-tenant leak class, reachable from the user-facing `(hub)/knowledge/manuals`
page. `ctx = await sessionOr401()` is fetched but `ctx.tenantId` is never used.

Rule violated: `.claude/rules/knowledge-entries-tenant-scoping.md` — "an aggregate OEM-corpus
surface … must NOT surface per-tenant upload content"; prescribed fix for a shared-corpus surface is
`is_private = false` (NOT `tenant_id = $caller`, which would reintroduce the #1761 empty-corpus bug).

**Honest blast-radius note:** live exposure scales with the count of `is_private = true` rows, which
is nonzero today (`/api/documents/upload`, onboarding #1901) and GROWS as the write-path
privatization follow-up in the tenant-scoping rule ships. A correct reader is the durable guarantee;
do not rely on writers staying mislabeled.

## Apply (ship via PR on a fresh branch off origin/main — NOT an in-place edit here)
```
git fetch origin && git checkout -b fix/knowledge-search-isprivate-leak origin/main
git apply -p1 wiki/orchestrator/patches/2026-06-17-B9-knowledge-search-isprivate-leak.patch
```
Adds `AND is_private = false` to both queries. `git apply -p1 --check` verified CLEAN vs
origin/main @5747e79e this run.

## Verify (must pass before PR)
- `cd mira-hub && npx tsc --noEmit` — still clean (only the 2 pre-existing stale-`@ts-expect-error`
  test nits, unrelated).
- Add/adjust a route test asserting an `is_private = true` row owned by tenant B is NOT returned to
  tenant A's search (mirror `proposals/route.test.ts` tenant-isolation style).
- Manual SQL sanity on staging: `SELECT count(*) FROM knowledge_entries WHERE is_private = true` > 0
  confirms the leak surface is live; re-run the route, confirm those rows no longer appear.
- Consider `is_private IS NOT TRUE` only if NULLs exist in the column; migration 001 defaults
  `false`, so `is_private = false` matches the rule's canonical predicate.

## Scope discipline
Two-line change, both SQL WHERE clauses, same file. Do not also refactor the route to add tenant
scoping — keep it the shared-OEM-corpus search it is intended to be; `is_private = false` is correct
and sufficient.
