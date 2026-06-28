# E4 remediation note — migration-tree CI coverage + doc hygiene

**Lens:** E (Promotion pipeline) · **Run:** E4 · **Audited:** `origin/main` @cb1be3fa (HEAD 69 behind)
**Status:** founder-gated doc-hygiene. **Zero code/runtime risk.** Not beta-blocking — closes ambiguity before strangers arrive.

## Why
The promotion pipeline is GREEN, but the audit surfaced one structural ambiguity and re-confirmed
three E3 cosmetics that have sat unactioned for 3 cycles. The single highest-value, lowest-risk
action is to make the migration story unambiguous in `docs/known-issues.md`:

1. **`docs/migrations` has no CI apply path.** Of 4 migration trees, only 2 are applied by a
   workflow — `mira-hub/db/migrations` (`apply-migrations.yml`, head 049, ledger 048) and
   `mira-core/mira-ingest/db/migrations` (`apply-ingest-migrations.yml`, head 012, incl. tenant
   RLS migs 009/010). `docs/migrations` (KG-core: `004_kg_entities`, `005_kg_relationships`,
   `008_kg_approval_state`) is applied by **no** workflow, and `mira-crawler/ingest/kg_writer.py:12`
   already documents `006_kg_bridge.sql` **"never landed in prod — see ADR-0013."** A reader can't
   tell which `docs/migrations` files are superseded-by-hub vs genuinely pending.
2. **040–042 gap.** `mira-hub/db/migrations` jumps 039→043; the source-preservation layer
   (`source_object_versions`, per #1677) was abandoned. Harmless to the filename-keyed ledger
   (non-contiguous numbering is fine) but undocumented.

## Apply (human / founder)
Append to `docs/known-issues.md` under **## Known Broken / Incomplete** (origin/main, ~L18):

```markdown
- **`docs/migrations/` is not applied by any CI workflow.** Only `mira-hub/db/migrations`
  (`apply-migrations.yml`) and `mira-core/mira-ingest/db/migrations` (`apply-ingest-migrations.yml`)
  are ledgered/applied in CI. `docs/migrations/*` (KG-core `004_kg_entities`, `005_kg_relationships`,
  `008_kg_approval_state`) is legacy/seed and largely superseded by hub migrations;
  `006_kg_bridge.sql` specifically **never landed in prod (ADR-0013)**. Before beta, mark each
  `docs/migrations` file `superseded-by: <hub-mig>` or `pending` in a header comment so no one
  hand-applies a superseded file against prod NeonDB.
- **`mira-hub/db/migrations` 040–042 gap is intentional.** The source-preservation layer
  (`source_object_versions`, #1677) was abandoned; numbering jumps 039→043. The filename-keyed
  `schema_migrations` ledger (048) tolerates the gap — no action needed, recorded here to stop
  future "missing migration" false alarms.
```

Then the cosmetic batch (separate trivial PRs, non-urgent):
- Refresh on-`main` `wiki/hot.md` head claim (line ~150 says `head=037`; actual hub head = **049**).
- Delete redundant `mira-hub/tests/e2e/signup-flow.spec.ts` (money-path coverage now lives in the
  CI-wired `playwright.smoke.config.ts`).
- (Optional) dedupe the 8 dup prefixes (006/008/021/025/026/027/032/033) — only worth it if a
  future reader trips on them; the ledger keys by full filename so they apply+record correctly today.

## Verify
```bash
# 1. The note exists and names the orphan tree
grep -q 'docs/migrations/.*not applied by any CI workflow' docs/known-issues.md && echo OK-note

# 2. Confirm the orphan claim still holds (no workflow references docs/migrations as an apply dir)
git grep -nE 'MIG_DIR=.*docs/migrations' -- '.github/workflows/*.yml' || echo OK-still-orphaned

# 3. Confirm the two covered trees still have their workflows
test -f .github/workflows/apply-migrations.yml && test -f .github/workflows/apply-ingest-migrations.yml && echo OK-covered
```

## Do NOT
- Do **not** add a CI workflow that applies `docs/migrations` against prod — these may be superseded;
  applying a superseded file is worse than the current documented gap. Classify first (the note),
  migrate-or-retire second (a deliberate follow-up).
