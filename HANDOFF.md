# HANDOFF — Technician Beta Recovery, Workstream A

**Date:** 2026-08-29
**Branch:** `codex/technician-beta-recovery-a` (worktree `C:/Users/hharp/.codex/worktrees/technician-beta-recovery-a`)
**Base:** `origin/main` @ `89adee90b3ebb31b5117a5cfa23341ce90ff239e`
**PRD:** `docs/prd/2026-08-29-technician-beta-recovery-prd.md` (copied verbatim — sha256 `712d6c7f…60cc0` identical to the approved source)
**Scope delivered:** Workstream A only (PRD §7, delivery-sequence PR 1). Workstreams B–E untouched.
**Status:** GREEN for the PR-1 slice. Human gates: PR review + merge (Mike), and the §7.5 disposable dev/staging end-to-end run.

---

## 1. Root cause (traced, not guessed)

Under `MIRA_ENFORCE_APPROVED_RETRIEVAL=true` (forwarded into mira-hub since #3416),
`retrieveNodeChunks` (`mira-hub/src/lib/manual-rag.ts`) appended `AND verified = true` to every
v2 chunk read. But:

- the v2 upload writer (`node-knowledge-ingest.ts`) never sets `knowledge_entries.verified`
  (column default `false`) — #3437;
- the technician's confirmation lives in `equipment_notebook_sources.match_state`
  (`user_confirmed` / `verified`, `enabled_by_default`, `superseded_at IS NULL`), which the
  chat route already proves via `validateChatSources` **before** retrieval — but that proof was
  never handed to the SQL boundary;
- #3440 only patched the nameplate lane by marking chunks `verified=true` at confirm time, so
  every source confirmed before it stayed `verified=false` and refused — #3468.

Three flags named "verified" were being conflated: shared-corpus trust (`knowledge_entries.verified`),
retention governance (`namespace_direct_uploads.verified`, admin `/verify` route), and
tenant-private retrieval admission (notebook confirmation). The PRD §7.2 model separates them.

## 2. The fix (smallest coherent diff)

| File | Change |
|---|---|
| `mira-hub/src/lib/manual-rag.ts` | New `retrieveNodeChunks` option `approvedSourceDocIds` (server-derived). Under the gate the approval predicate on BOTH lanes (BM25 pool + exact-token ILIKE) becomes `AND (verified = true OR (is_private = true AND doc_id = ANY($n::uuid[])))`, bound to `approvedSourceDocIds ∩ docIds`. Empty intersection / no set → the pre-existing `AND verified = true`. Gate off → no predicate (unchanged). Seam doc-comment defines the three "verified" meanings. |
| `mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts` | Passes `approvedSourceDocIds: docIds` — the **output** of `validateChatSources` (tenant-owned, notebook-linked, enabled, confirmed, not superseded), never `body.sourceDocIds`. 8 additive lines. |
| `tools/qa/security/knowledge_entries_read_allowlist.yml` | Re-keyed the two `retrieveNodeChunks` reads (`:504→:559`, `:540→:600`) with new full-context hashes + dated HASH MIGRATION notes; 7 individually-justified approvals for the new test-file sites (mock-regex assertions / disposable-DB fixture DML). No broad exemption. |

Isolation properties (why this equals or beats the PRD's preferred shape): the admission branch is
reachable only for rows that already satisfy `tenant_id = $1` AND `doc_id = ANY(validated scope)`
AND `is_private = true`; the approved set can only narrow; shared/OEM rows (`is_private=false`)
still require `verified = true`; nothing is written — no chunk becomes globally verified, no KG
relationship changes, no trust class is added. The NodeChat (`/api/namespace/node/[id]/chat`) and
asset-chat call sites pass no approved set and keep their byte-identical predicate.

## 3. Tests — the 11 PRD §7.4 cases

| # | Case | Test | Red → Green |
|---|---|---|---|
| 1 | fresh private PDF, confirmed+selected | integration "1." | `[]` → `[DOC_PDF]` |
| 2 | fresh private text | integration "2." | `[]` → `[DOC_TXT]` |
| 3 | confirmed OCR/nameplate doc (no verified mark) | integration "3." | `[]` → `[DOC_OCR]` |
| 4 | pre-fix confirmed, `verified=false`, **no data rewrite** | integration "4." (verified-count oracle 0→0) | `[]` → `[DOC_PREFIX]` |
| 5 | shared `is_private=false`, `verified=false` stays excluded | integration "5." | green before & after |
| 6 | private candidate excluded | integration "6." + unit intersection | positive half red → green |
| 7 | private disabled excluded | integration "7." | positive half red → green |
| 8 | same doc id from another tenant excluded | integration "8." | green before & after |
| 9 | forged client id not linked to notebook excluded | integration "9." + unit "narrow, never widen" | red → green |
| 10 | admin namespace verification keeps governance behaviour | `verify/__tests__/governance.test.ts` (UPDATE `namespace_direct_uploads` only, tenant-scoped, no `knowledge_entries`) | green before & after |
| 11 | Hub NodeChat beta path unchanged | unit "case 11" (predicate byte-identical, `$5` layout) + existing `namespace/node/[id]/chat` suite + `tests/beta` offline lane | green before & after |
| route | server-derived set is the authority (requested `DOC_A` → derived `DOC_B`) | `chat-approved-source-scope.test.ts` | red → green |

Files: `mira-hub/src/lib/__tests__/approved-source-admission.integration.test.ts`,
`mira-hub/src/lib/__tests__/approved-source-admission.test.ts`,
`mira-hub/src/app/api/equipment-notebooks/__tests__/chat-approved-source-scope.test.ts`,
`mira-hub/src/app/api/namespace/files/[id]/verify/__tests__/governance.test.ts`.

### Red evidence (before the fix, gate ON, disposable Postgres 16)
```
× 1. fresh tenant-private PDF upload, confirmed and selected → retrievable
    AssertionError: expected [] to deeply equal [ Array(1) ]
× 2. fresh tenant-private text upload … expected [] to deeply equal [ Array(1) ]
× 3. confirmed OCR/nameplate-derived document … expected [] to deeply equal [ Array(1) ]
× 4. #3468: source confirmed pre-fix with knowledge_entries.verified=false … expected [] …
× 6./7./9. (positive half: the confirmed doc alongside the excluded one) expected [] …
✓ 5. shared … excluded   ✓ 8. other tenant … excluded   ✓ no approved set ⇒ legacy rule
Tests  7 failed | 3 passed (10)
```
Unit/route before: `3 failed | 5 passed (8)` — missing option (`expected null to be truthy` on the
admission regex; route spy not called with `approvedSourceDocIds`).

### Green evidence (after)
```
approved-source-admission.integration.test.ts   10 passed (10)
approved-source-admission.test.ts                5 passed
chat-approved-source-scope.test.ts               2 passed
governance.test.ts                               1 passed
Regression (manual-rag, notebook-isolation, equipment-notebooks/*, namespace/node/[id]/chat,
  assets/[id]/chat, namespace/files/[id]/verify):  23 files, 332 passed
```

## 4. Verification commands (exact)

```bash
# from the worktree root; keep the shell cwd at the root (hooks resolve relative to it)
docker run -d --name mira-wsa-pg -e POSTGRES_PASSWORD=testpw -e POSTGRES_DB=mira_test -p 5601:5432 postgres:16
export TEST_DATABASE_URL="postgres://postgres:testpw@127.0.0.1:5601/mira_test" MIRA_TEST_DB_CONFIRM=DISPOSABLE
export MIRA_INTEGRATION_MIGRATIONS="001_knowledge_graph.sql,010_kg_uns_path.sql,026_kg_entities_dedupe_and_constraint.sql,027_ai_suggestions.sql,029_kg_approval_state.sql,055_contextualization.sql,056_contextualization_intake.sql,067_ctx_import_batches_approval_cols.sql,027_namespace_direct_uploads.sql,059_namespace_filing_cabinet.sql,068_hub_uploads.sql,072_hub_uploads_content_sha256.sql,073_equipment_notebooks.sql,075_workspace_file_links.sql,076_namespace_uploads_source_reconcile.sql,077_ingest_claim.sql,082_namespace_uploads_node_nullable.sql,084_notebook_turn_basis_and_source_origin.sql,085_notebook_source_canonical_provenance.sql"
(cd mira-hub && bun install --frozen-lockfile && node scripts/setup-integration-db.mjs)
(cd mira-hub && npx vitest run --config vitest.integration.config.ts src/lib/__tests__/approved-source-admission)
(cd mira-hub && npx vitest run src/lib/__tests__/approved-source-admission.test.ts "src/app/api/equipment-notebooks/__tests__/chat-approved-source-scope.test.ts" "src/app/api/namespace/files/[id]/verify/__tests__/governance.test.ts")
(cd mira-hub && npx vitest run src/lib/__tests__/manual-rag.test.ts src/lib/__tests__/notebook-isolation.test.ts src/app/api/equipment-notebooks "src/app/api/namespace/node/[id]/chat" "src/app/api/assets/[id]/chat" "src/app/api/namespace/files/[id]/verify")
(cd mira-hub && npx eslint src/lib/manual-rag.ts "src/app/api/equipment-notebooks/[id]/chat/route.ts" src/lib/__tests__/approved-source-admission*.ts)
(cd mira-hub && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json)   # see §6
PYTHONIOENCODING=utf-8 python tools/qa/security/check_knowledge_entries_filters.py  # ✅ 180 sites
python -m pytest tests/test_knowledge_entries_security_check.py tests/beta tests/test_architecture.py -q
PYTHONUTF8=1 python -m pytest tests/test_approved_retrieval_plumbing.py -q            # 11 passed
docker rm -f mira-wsa-pg
```

## 5. Historical repair (#3468) — PRD §7.3 decision

**No data rewrite is required.** Case 4 proves it on the disposable DB: a source with
`match_state='verified'`, `created_at = now() - 30 days`, and chunks `verified=false` becomes
retrievable purely through the corrected admission query while the tenant's
`verified=true` chunk count stays 0 before and after. Per §7.3 ("do not create a migration merely
to appear active") no backfill/migration ships in this PR. A read-only *detection* query for
PR 2's preflight (tenant-scoped by construction; never run against prod from a session):

```sql
-- affected = confirmed+enabled+visible notebook sources whose chunks are all verified=false
SELECT s.tenant_id, s.notebook_id, s.doc_id, s.match_state,
       count(k.*) AS chunks, bool_or(k.verified) AS any_verified
  FROM equipment_notebook_sources s
  LEFT JOIN knowledge_entries k ON k.doc_id = s.doc_id AND k.tenant_id = s.tenant_id
 WHERE s.tenant_id = $1::uuid            -- REQUIRED tenant predicate
   AND s.match_state IN ('user_confirmed','verified')
   AND s.enabled_by_default = true AND s.superseded_at IS NULL
 GROUP BY 1,2,3,4;
```
After this PR every such row reports admission = eligible without mutation; the #3440 confirm-time
`markNameplateDocVerified` becomes redundant-but-harmless (left untouched — it lives in the
#3477-owned file).

## 6. Pre-existing / environmental failures (precisely evidenced)

- `tsc --noEmit`: errors only in files this branch does not touch (`nameplate/__tests__/confirm.test.ts` ×15,
  `mira/ask/__tests__/route.test.ts` ×8, `assets/[id]/chat/__tests__/route.test.ts` ×2, `cmms/sso` ×2,
  `hub/status` ×1, `drive-pack-suggestion.test.ts` ×1, `tests/e2e/upload-probe.spec.ts` ×3). Zero errors in changed files.
- `tests/test_approved_retrieval_plumbing.py`: 6 failures under the default Windows console codepage
  (`UnicodeDecodeError: 'charmap'` reading compose YAML); **11/11 pass with `PYTHONUTF8=1`**. Compose files untouched.
- `tests/beta`: 2 skips by design (no dev/staging endpoint provisioned in this session) — the §7.5 live
  upload→confirm→ask→citation run is a human/staging gate (see §8).
- `git diff --check`: trailing double-spaces in `PLAN.md` header lines (operator-authored markdown hard breaks); left as-is.

## 7. Collision audit

- **PR #3477** (`fix/3442-superseded-chat-scope`, OPEN): owns `equipment-notebooks.ts` + its domain test +
  2 mira-mobile files. **Not edited here.** Integration note: #3477 makes `validateChatSources` return
  the *remapped* successor ids in `docIds`; because this PR passes `validated.docIds` (not the request)
  as `approvedSourceDocIds`, the remap composes cleanly — the successor is both the doc scope and the
  admission set. The `chat-approved-source-scope` test models exactly that shape (requested A → derived B).
  Deferred to #3477's file: the seam doc-comment on notebook confirmation semantics (written here at the
  retrieval seam + route instead).
- **PR #3300** (draft, idle since 2026-08-18): touches `chat/route.ts` only at the auth import
  (`sessionOr401` → `requestContextOr401`) — disjoint hunk; and the allowlist YAML (textual merge
  risk only; re-run the checker after either merge).
- No other open PR touches `manual-rag.ts`.

## 8. Remaining risks / human actions

1. **Merge = Mike.** PR is merge-ready, not merged. Merge auto-deploys mira-hub (docs-only merges don't).
2. **§7.5 exit gate half 2** — a disposable dev/staging tenant doing upload → confirm → supported
   question → correct citation with `MIRA_ENFORCE_APPROVED_RETRIEVAL=true`. Needs a staging endpoint
   (`BETA_GATE_*` env) — not available to this session. Workstream B makes CI do this.
3. Asset chat (`/api/assets/[id]/chat`) still calls `retrieveNodeChunks` with attached docs and no
   approved set, so its attached-doc lane remains subject to `verified=true` under the gate (its own
   comment already documents the limitation). Out of Workstream A scope; candidate for PR 2 if the
   `workspace_file_links` derivation is accepted as a server authority.
4. `.claude/rules/knowledge-entries-tenant-scoping.md` could cite the new admission predicate; left
   unchanged to keep the diff to the PRD scope (the seam comment in `manual-rag.ts` is the owning doc).

## 9. PLAN.md row-by-row

| PLAN step | Result |
|---|---|
| 1 Preflight/authority | ✅ worktree/branch/hooks/env verified; PRD copied byte-identical; seam documented (§1) |
| 2 Tests first | ✅ 11 cases + route authority; red evidence preserved (§3) |
| 3 Smallest fix | ✅ 2 source files + allowlist migration (§2) |
| 4 Historical repair | ✅ investigated — no mutation required; detection query provided (§5) |
| 5 Verify & hand off | ✅ focused + package regression + lint + checker; tsc/plumbing deltas evidenced (§6); this file |
