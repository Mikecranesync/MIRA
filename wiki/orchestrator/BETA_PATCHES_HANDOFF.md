# Beta-readiness staged patches — engineer hand-off

**Prepared:** 2026-06-15 · **Base:** `origin/main` @`64e156c9` · **Branch:** `fix/beta-readiness-staged-patches`

Three apply-ready, low-risk patches verified clean against deploy truth (`git apply --check` passed
on all three). Committed on a branch and exported as a git bundle (the sandbox can't push, so the
branch ships as a bundle file you pull from). None touches product runtime or `# SAFETY/# PLC/# CRITICAL` code.

| Commit | Type | File(s) | What | Risk |
|---|---|---|---|---|
| `024e3267` | test | `tests/canary/proposal_state_drift.sql` (+33) | Adds the ADR-0017 **reverse-drift** `@check`: catches an engine-triggered terminal proposal whose paired `ai_suggestions` row is stuck at `pending` (a stale "pending" lie in the admin queue). Legacy-safe join; healthy DB = 0 rows. | Detective-only SQL; can't break runtime |
| `6bc3837f` | docs | `CLAUDE.md`, `docs/architecture/environment-quick-ref.md` | Marks staging **Gap-1** (compose) and **Gap-3** (`@MiraStaging_bot`) as CLOSED — both exist on `origin/main`; docs still said TODO. | Documentation only |
| `71abb484` | ci | `.github/workflows/eval-replay-gate.yml` (+10/-1) | Replay gate now requires **both** `cascade.json` AND `retrieval.json` before it activates, so a half-recorded store can't flip it active and red engine PRs on the first retrieval call. | Gate stays inert until the store is recorded; hardening only |

## How to consume (on a Mac dev node — CHARLIE)

**Option A — pull the branch from the bundle (preserves the 3 commits):**
```bash
cd ~/MIRA
git fetch origin main
git fetch wiki/orchestrator/beta-readiness-staged-patches.bundle \
  fix/beta-readiness-staged-patches:fix/beta-readiness-staged-patches
git checkout fix/beta-readiness-staged-patches      # review the diff
git push -u origin fix/beta-readiness-staged-patches # then open a PR (gate runs)
```

**Option B — apply the raw patches onto a fresh branch (same result):**
```bash
cd ~/MIRA && git fetch origin main
git checkout -b fix/beta-readiness-staged-patches origin/main
git apply wiki/orchestrator/patches/2026-06-10-canary-reverse-drift-check.patch
git apply wiki/orchestrator/patches/e8-staging-docdrift.patch
git apply wiki/orchestrator/patches/2026-06-15-D8-replay-gate-require-both-stores.patch
```

Open a normal PR so the Staging Gate + Smoke checks run before merge (never push to `main`).

---

## The one founder step that flips the last lens (D) GREEN — keys you need on hand

Record the deterministic eval "replay store." One-time, ~30 min, run on a **Mac** (NeonDB SSL
fails from Windows). Everything is meant to live in **Doppler `factorylm/dev`**, so if Doppler is
set up you run the command and never touch raw keys:

```bash
doppler run -p factorylm -c dev -- env MIRA_EVAL_REPLAY=record python tests/eval/offline_run.py
# verify: tests/eval/fixtures/llm_replay/ now has cascade.json + retrieval.json (non-empty)
# then un-gitignore line 241 and: git add -f those two files; eyeball once for PII (already sanitized); commit
```

Secrets that must be present in `factorylm/dev` for that command to succeed:

| Secret | Why | Required? |
|---|---|---|
| `GROQ_API_KEY` | Cascade provider #1 — records `cascade.json` | **Yes** (at least one cascade key must work) |
| `CEREBRAS_API_KEY` | Cascade provider #2 (fallback) | **Yes** (recommended; covers Groq rate-limits) |
| `GEMINI_API_KEY` | Cascade provider #3 | Optional — currently 403-blocked per known-issues; cascade falls through, so not strictly needed |
| NeonDB dev URL (`DATABASE_URL` / `NEON_DATABASE_URL`) | Retrieval (`neon_recall`) — records `retrieval.json` | **Yes** — without it only half the store records and the gate (post-patch) correctly stays inert |

After recording + committing the store, apply commit `71abb484` (already in this branch) and make the
replay gate a **required** branch-protection check. D flips YELLOW → GREEN — all six lenses green.

## NOT included (no staged patch yet — needs an engineer to write)
- Wire the 3 orphan Playwright configs into `smoke-test.yml` (command-center first) — B-lens.
- Make `deploy-vps.yml` deploy the new `v<VERSION>` tag instead of `main` HEAD — F-lens.
- Flip on the "Version Bump Check" required status in `main` branch protection (#1970) — human, ~2 min.
