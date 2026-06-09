# Beta-Readiness Remediation — Execution Status & Handoff

**Date:** 2026-06-09 · **Plan:** `docs/plans/2026-06-08-beta-readiness-remediation.md`
**Branches:** `security/beta-readiness-p0` (PR #1837) · `feat/beta-readiness-deep` (PR #1845)

Two PRs were cut deliberately (advisor guidance): a **fast security/CI track** Mike can merge
without waiting on the deeper engine/migration work, and a **deep track** for the rest.

> **2026-06-09 coordination rebuild.** Both branches were rebuilt on current `main` after a
> cluster-coordination review found parallel work had landed/opened for several items. The
> "merged closes the item; open does not" rule decided each (see **Reconciliation** below).

---

## Status by item

| Item | What shipped | State | Verified how |
|---|---|---|---|
| **P0-1** rate-limit public LLM door | quickstart/ask (fully-public door) shipped in **#1838 MERGED**; this PR adds the **semi-public** door it missed: `@/lib/ip-rate-limit` on mira/ask (40/min, demo-token reachable), prefers trusted `x-real-ip` | ✅ done | #1838 merged on main; mira/ask limiter blocks at #41; money-path 429 smoke (gated) |
| **P0-2** cross-tenant documents leak | **Deferred to #1841 (OPEN)** — the dedicated, fuller #1833 fix (same `AND tenant_id=$2` cmms_equipment hunk + hybrid-corpus read filter + mig 045 + upload route + tests). My one-liner was a strict subset → dropped to avoid racing the same file | ⏳ **closes on #1841 merge** | #1841 diff confirmed to fix the exact IDOR lookup; IDOR still LIVE on main until #1841 lands |
| **P1-1** money-path smoke gate | `money-path.spec.ts` + signup-flow wired into smoke deploy gate (grounded-chat answer, 429 flood, documents auth) | ✅ done — **with 2 honesty caveats** (see below) | ran vs **prod**: grounded ✓, documents-rejected ✓, checkout-303 ✓; desktop+mobile proof in `docs/promo-screenshots/` |
| **P0-3** citation relevance (the "lie") | `evaluate_citation_relevance` (alias-aware, fail-open) + engine strip at both reply sites, gated by `citation_enforce_enabled()` (`MIRA_CITATION_ENFORCE` kill-switch, default ON) + `cp_citation_vendor_relevance` grader checkpoint | ✅ done | **24 deterministic unit tests** (Siemens-on-Danfoss caught; alias not suppressed); ruff clean; grader tests green. Complementary to #1840 (adds uncited citations — different angle, may conflict in engine.py if it merges first) |
| **P2-1** deterministic eval | record/replay seam (per-scenario LLM + content retrieval), env-gated, DB/key-free replay | ⚠️ **partial** — see below | replay needs no keys/DB, ~3-6× faster, variance 3-case→~1-case (40 vs 41), NOT yet bit-identical |
| **P3-1** PR #1657 idempotency | n/a | ✅ no-op | `gh pr view 1657` = **MERGED** 2026-06-04 (`ee7ba7b5`); plan's "red streak" was stale |
| **P3-2** migration ledger | `048_schema_migrations_ledger.sql` (reuses the legacy `schema_migrations` table) + apply-migrations skip/seed/record | ✅ done | verified vs **dev Neon** (rolled back): runs clean, idempotent, dup-prefixes distinct |
| **P3-3** migration-verify ↔ staging-gate ordering | wait step in staging-gate gated on migration-file changes | ✅ done | YAML reviewed; preserves required-check + deploy contract |
| **D-1** proposals contract (#9) | ADR-0017 transition helpers (TS + Py) + decide route routed through them | ✅ done (ADR already decided the architecture; canary pre-existed in #1723) | 8 vitest + 9 pytest; decide route test green |

---

## Reconciliation (2026-06-09) — what parallel work changed

A coordination review before declaring done found other PRs had landed/opened for several items.
Decisions follow the **"merged closes the item; open does not"** rule:

| Item | Parallel PR | State | Decision |
|---|---|---|---|
| P0-1 quickstart/ask limiter | **#1838** (closes #1832) | **MERGED** | Dropped my duplicate quickstart hunk; kept only the mira/ask door #1838 didn't cover. |
| P0-2 documents tenant scope | **#1841** (closes #1833) | OPEN | Dropped my one-liner (strict subset of #1841); P0-2 now **closes when #1841 merges**. IDOR is live on main meanwhile. |
| P0-3 citation | **#1840** (#1659) | OPEN | Different angle (salvages uncited replies vs. strips wrong-vendor). Kept mine; flagged engine.py conflict risk if #1840 lands first. |
| graphology lockfile | **#1848** | MERGED | Dropped my duplicate `package-lock.json` from both branches; took main's. |
| reranking test (`test_reranking`) | **#1786** | MERGED | Was the only red Python check; rebuilding both branches on main picked up the fix. |

Both branches were **rebuilt on current `main`** (reset + re-apply only the kept files) rather than
merged-with-conflicts, so the diffs are minimal and carry no stale/duplicate hunks.

---

## ⚠️ P1-1 — two honesty caveats on the money-path gate

The gate is real and wired into `smoke-test.yml`, but two things are weaker than "a broken PR turns
the gate red":

1. **The smoke gate tests *deployed prod*, not the PR build.** `smoke-test.yml` runs against
   `factorylm.com` / `app.factorylm.com` (a post-deploy health gate), so a regression in a PR's
   *code* is caught only after it deploys — not on the PR itself. The original plan's "broken PR
   turns the gate red" is **not** met by this gate alone. To get pre-merge protection, the
   money-path spec would need to run against a PR-built preview/ephemeral hub (follow-up).
2. **The 429 flood assertion is verified nowhere automated.** It is gated behind
   `SMOKE_RATE_LIMIT_CHECK=1` (skipped by default) so it can't deadlock a merge by asserting
   behavior the PR hasn't deployed yet. Net effect: the rate-limit 429 is exercised only when run
   manually / post-deploy. **Follow-up:** wire a post-deploy step in `deploy-vps.yml` that runs the
   spec with `SMOKE_RATE_LIMIT_CHECK=1` against the freshly-deployed hub.

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
24 deterministic unit tests, so it is **not blocked** on P2-1 reaching bit-determinism.

---

## Human-gated / cannot-run-from-this-session

1. **Merge order.** **#1841** closes the documents IDOR (P0-2) — merge it for the stranger-leak fix.
   Then **#1837 (security)** for the mira/ask door + money-path gate, then **#1845 (deep)** after its
   staging-gate + reviews pass. All per the careful pre-merge reviewer policy — nothing auto-merges.
2. **Security review.** Run `/security-review` on **#1841**'s documents diff (P0-2 now lives there,
   not #1837).
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
- ~~`MIRA_CITATION_ENFORCE` kill-switch~~ — **DONE** (`citation_enforce_enabled()`, default ON).
- **Drive #1841 to merge** — this is what actually closes P0-2.
- **Pre-merge money-path gate** — run `money-path.spec.ts` against a PR-built preview hub (caveat 1).
- **Automated 429 check** — post-deploy `deploy-vps.yml` step with `SMOKE_RATE_LIMIT_CHECK=1` (caveat 2).
- Quickstart could adopt the shared `@/lib/ip-rate-limit` lib later (left #1838's inline impl as-is).
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
