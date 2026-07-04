# HANDOFF — Path to Beta Testers (2026-06-07)

**Branch:** `feat/path-to-beta` · **Worktree:** `.claude/worktrees/path-to-beta` · **Base:** origin/main `4b9778c8`
**Commits:** 5 (all on-scope, docs + tests only — no engine/prod changes)

## North Star
A stranger uploads their own equipment manual, asks a real question, and MIRA returns a grounded
answer **citing that manual — without Mike manually fixing anything.** Enforced by
`tests/beta/beta_ready_upload_retrieval_citation.py` (xfail-strict until met).

## What was done (vs PLAN, row by row)

| Lane | Status | Evidence |
|---|---|---|
| 1 — North Star / memory alignment | ✅ DONE | BETA GATE in `CLAUDE.md` + `.claude/CLAUDE.md`; 4-week plan in `NORTH_STAR.md`; phase doc `docs/plans/2026-06-07-path-to-beta.md`; blockers in `wiki/hot.md`; memory `project_path_to_beta.md` + index |
| 2 — Upload→retrieval gap + failing test | ✅ DONE | `docs/research/2026-06-07-upload-retrieval-gap-and-beta-path.md`; `tests/beta/test_upload_retrieval_citation.py` (1 anchor PASS + 1 xfail) |
| 3 — Demo tenant seed + empty state | ✅ DONE (design) | `tools/seeds/beta-demo-tenant.md` (reuse manifest + known-good Q/A + empty-state copy). No new seed data; composing was unsafe + untestable here |
| 4 — Graph stability (#1742) | ✅ DONE | #1742 merged `63c9b8e1`; regression test `mira-hub/src/components/kg/__tests__/GraphCanvas.test.ts` — **verified 4/4 pass** against the fixed component |
| 5 — Ignition Ask MIRA readiness | ✅ DONE | `docs/runbooks/activate-ignition-ask-mira.md`; HMAC key now PRESENT in Doppler prd; endpoint wired w/ `source=direct_connection` |
| 6 — Beta release gate | ✅ DONE | `tests/beta/beta_ready_upload_retrieval_citation.py` (xfail-strict, real upload door) + GS10 PDF fixture |

## Verification (ran myself)
- `ruff check` on all touched `.py` → **All checks passed.**
- `pytest tests/beta/...` → **1 passed, 2 xfailed** (anchor passes; both gates xfail on the open gap).
- GraphCanvas regression → **4/4 pass** (run via main checkout's vitest; temp copy removed).
- `git diff --name-only base..HEAD` → nothing OUT-of-scope (no `engine.py`, no prod, no PR merges, no secret values).

## What's still BLOCKED (needs Mike / ops — not doable in this session)
1. **THE blocker — upload→retrieval gap.** Close **PR #1592** (`feat/hub-folder-brain`, DRAFT, needs
   rebase on main). It adds `node-knowledge-ingest.ts` + migration 030 (chunk anchors) so uploads
   write `knowledge_entries`. Until merged + deployed, no uploaded manual is citable. *(out of scope
   this session — engine/ingest rewrites were excluded; the failing test is the artifact.)*
2. **Deploy confirmation for #1742.** Graph NaN fix is merged to main; confirm deployed to prod
   (`/knowledge/map` on app.factorylm.com). I can't deploy.
3. **Ignition WebDev deploy.** Run `ignition/deploy_ignition.ps1` on the PLC laptop (last known 404 =
   not deployed, 2026-06-06). HMAC key is now in Doppler prd. See the new runbook.
4. **WO/PM Hub-render seed** (`demo-hub-tenant.sql`) is only on `origin/chore/demo-hub-seed`, not main
   — merge/cherry-pick before the Week-1 demo or `/workorders`/`/feed` render empty.
5. **Run the gate for real.** Point `BETA_GATE_*` env at **staging** and run the release-gate test
   after #1592 lands.

## Decisions made (flag if you disagree)
- Created the worktree myself (main checkout has concurrent writers per memory) rather than editing main.
- Did NOT write a composite seed runner — on-main seeds use incompatible tenant mechanisms + embedding
  requirements + partial idempotency, and there's no DB here to validate against. Shipped an accurate
  manifest instead (the honest "full solution"; an untested composite would be the shortcut).
- Gate tests are `xfail(strict=True)` and enter through the real upload door (never seed
  `knowledge_entries` directly) so they can't become theater.

## Next 3 actions for Mike
1. Rebase + finish + merge **PR #1592** (the one gate-closing change). Then deploy.
2. On the PLC laptop: `git pull` + run `ignition/deploy_ignition.ps1`; verify Ask MIRA per the new runbook.
3. Merge `chore/demo-hub-seed`, seed the demo tenant per `tools/seeds/beta-demo-tenant.md` on
   dev→staging, then run `tests/beta/beta_ready_upload_retrieval_citation.py` against staging.

## Readiness assessment
- **Internal demo:** ✅ today, on a pre-seeded tenant.
- **Design partner:** ❌ blocked on #1592 (a partner's own manual must be citable).
- **Public beta:** ❌ gate test red until #1592 ships + the gate passes on staging.
