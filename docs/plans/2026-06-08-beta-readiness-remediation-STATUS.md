# Beta-Readiness Remediation — Execution Status & Handoff

**Date:** 2026-06-09 · **Plan:** `docs/plans/2026-06-08-beta-readiness-remediation.md`
**Branches:** `security/beta-readiness-p0` (PR #1837) · `feat/beta-readiness-deep` (PR pending)

Two PRs were cut deliberately (advisor guidance): a **fast security/CI track** Mike can merge
without waiting on the deeper engine/migration work, and a **deep track** for the rest.

---

## Status by item

| Item | What shipped | State | Verified how |
|---|---|---|---|
| **P0-1** rate-limit public LLM door | `@/lib/ip-rate-limit` + quickstart/ask (20/min) + mira/ask (40/min, demo-token reachable) + prefer trusted `x-real-ip` | ✅ done | tsc clean; limiter unit-checked (blocks at #21); money-path 429 smoke |
| **P0-2** cross-tenant documents leak | `AND tenant_id=$2` on the cmms_equipment lookup | ✅ done | tsc clean; staged patch; smoke probe |
| **P1-1** money-path smoke gate | `money-path.spec.ts` + signup-flow wired into smoke deploy gate (grounded-chat answer, 429 flood, documents auth) | ✅ done | ran vs **prod**: grounded ✓, documents-rejected ✓, checkout-303 ✓; desktop+mobile proof in `docs/promo-screenshots/` |
| **P0-3** citation relevance (the "lie") | `evaluate_citation_relevance` (alias-aware, fail-open) + engine enforce + `cp_citation_vendor_relevance` grader checkpoint | ✅ done | **13 deterministic unit tests** (Siemens-on-Danfoss caught; alias not suppressed); ruff+pyright clean; decide-route + grader tests green |
| **P2-1** deterministic eval | record/replay seam (per-scenario LLM + content retrieval), env-gated, DB/key-free replay | ⚠️ **partial** — see below | replay needs no keys/DB, ~3-6× faster, variance 3-case→~1-case (40 vs 41), NOT yet bit-identical |
| **P3-1** PR #1657 idempotency | n/a | ✅ no-op | `gh pr view 1657` = **MERGED** 2026-06-04 (`ee7ba7b5`); plan's "red streak" was stale |
| **P3-2** migration ledger | `048_schema_migrations_ledger.sql` (reuses the legacy `schema_migrations` table) + apply-migrations skip/seed/record | ✅ done | verified vs **dev Neon** (rolled back): runs clean, idempotent, dup-prefixes distinct |
| **P3-3** migration-verify ↔ staging-gate ordering | wait step in staging-gate gated on migration-file changes | ✅ done | YAML reviewed; preserves required-check + deploy contract |
| **D-1** proposals contract (#9) | ADR-0017 transition helpers (TS + Py) + decide route routed through them | ✅ done (ADR already decided the architecture; canary pre-existed in #1723) | 8 vitest + 9 pytest; decide route test green |

---

## ⚠️ P2-1 — honest determinism status

The record/replay **seam is built, working, and committed** (`tests/eval/llm_replay.py`, env
`MIRA_EVAL_REPLAY=record|replay|live`, default `live` = no-op, zero production impact). It makes
replay **key-free and DB-free** and cuts variance substantially.

It does **NOT** yet produce a bit-identical pass count across runs. Per-scenario replay measured
**40 vs 41 / 57** (down from the original ~3-case 47/50/47 swing). Residual nondeterminism traces
to **engine-internal** sources, not the seam:
- `PYTHONHASHSEED`-sensitive set/dict iteration order changing which candidate/branch fires;
- time-based branching (`datetime.now()` age checks);
- the shared **dev** Neon KB mutating between runs (peer sessions/crons) — CI's isolated staging
  branch would be more stable.

**To finish (follow-up, ~½ day):** pin `PYTHONHASHSEED=0`, freeze time in the harness, also
record/replay `kb_has_coverage`/`kb_has_pair_coverage`, then record against an isolated KB and
re-baseline. Stores are gitignored until then.

**Important:** P0-3 (the actual beta-blocker P2-1 was meant to gate) is verified independently by
13 deterministic unit tests, so it is **not blocked** on P2-1 reaching bit-determinism.

---

## Human-gated / cannot-run-from-this-session

1. **Merge order.** Merge **PR #1837 (security)** first (closes the 3 stranger-reachable blockers).
   Then the deep-track PR after its staging-gate + reviews pass. Both per the careful pre-merge
   reviewer policy — nothing auto-merges.
2. **Security review.** Run `/security-review` on the P0-2 tenant-filter diff before merging #1837.
3. **Authed cross-tenant probe (P0-2).** Needs two seeded tenant sessions → runs on staging, encoded
   as a `test.skip` in `money-path.spec.ts` with the exact invocation. Verify there.
4. **Migration ledger seed (P3-2).** One-time per target:
   `gh workflow run apply-migrations.yml -f target=staging -f migrations=all -f mode=seed-ledger`
   then the same for `target=prod` (production environment gate). After that, `mode=apply` only runs new files.
5. **Engine/RAG staging gate (P0-3).** The citation-relevance change must pass `staging-gate.yml`
   + the eval regime before merge to main (env doctrine).
6. **Final orchestrator audit.** Re-run the Lens-F beta-readiness audit; expect 0 stranger-reachable
   blockers → F flips RED→GREEN.

## Optional follow-ups (noted, not blocking)
- `MIRA_CITATION_ENFORCE` kill-switch for the runtime citation strip, if a prod false-positive ever appears.
- Harden `/api/public/report` IP extraction to the same `x-real-ip`-first pattern.
- Finish P2-1 bit-determinism (above).

---

## Reproduce the key verifications

```bash
# P0-3 (the lie) — deterministic, no DB/keys:
cd <repo> && python -m pytest tests/eval/test_grader_citation.py -q              # 24 passed
python -m pytest mira-bots/tests/test_proposal_transition.py -q                  # D-1, 9 passed
cd mira-hub && npx vitest run src/lib/proposal-transition.test.ts                # D-1, 8 passed

# P2-1 seam (record needs Doppler dev keys + Neon; replay needs neither):
MIRA_EVAL_REPLAY=record doppler run -p factorylm -c dev -- python tests/eval/offline_run.py --suite text --replay record
python tests/eval/offline_run.py --suite text --replay replay   # serves from store, no keys/DB

# P3-2 ledger one-time seed (staging then prod):
gh workflow run apply-migrations.yml -f target=staging -f migrations=all -f mode=seed-ledger
```
