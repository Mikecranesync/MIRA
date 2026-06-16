# Pulse → Issues → Work-off Plan

**Source:** orchestrator E8 scorecard (`BETA_READINESS.md`, audited `origin/main` @64e156c9).
**Tracker:** GitHub Issues `Mikecranesync/MIRA` (`gh` CLI). **Labels (Pocock):** `needs-triage`,
`ready-for-agent`, `ready-for-human`, `needs-info`, `wontfix`.
**Mission lens:** every item below is on the path to a stranger signing up and getting a grounded
answer without anything breaking, leaking, or lying — i.e. first-dollar beta-readiness.

## Guardrails (repo doctrine — non-negotiable)
- Branch from **`origin/main`** (the deploy truth), never the current 164-behind feature branch.
- Conventional Commits; one issue → one branch → one PR. **Never merge** (your approval gate).
- Verify on **staging**, never prod. No prod `psql`, no `doppler … prd` from a code session.
- Code marked `# SAFETY` / `# PLC` / `# CRITICAL` is untouched.

## The pulse items (7)

| # | Title | Lens | Priority | Fix mechanism | Track |
|---|-------|------|----------|---------------|-------|
| 1 | Replay seam inert — no deterministic CI guard on the vendor-citation invariant | D | **P1** | D8 patch (keyless) + founder records replay store | split |
| 2 | ADR-0017 reverse-drift canary missing (terminal proposal vs stale `pending` suggestion) | B | P2 | `canary-reverse-drift` patch (zero runtime risk) | agent |
| 3 | 3 Playwright configs ungated (command-center has live code, no e2e) | B | P2 | write smoke-test wiring | agent |
| 4 | Doc drift — staging Gap-1/Gap-3 marked TODO but both shipped | E | P3 | `e8-staging-docdrift` patch | agent |
| 5 | `version-gate.yml` not yet a required branch-protection check | E | P2 | GitHub branch-protection setting | human |
| 6 | `deploy-vps.yml` ships `main` HEAD, not the `v<VERSION>` tag #1970 built | F/E | P2 | deploy-by-tag change (needs design) | agent |
| 7 | `COMMAND_CENTER_DISPLAY_HOST_ALLOWLIST` unset in `factorylm/prd` | A | P3 | Doppler prd var | human |

## Per-issue specs

### #1 — Activate the eval replay seam (P1, split) `ready-for-agent` + `ready-for-human`
**Body:** `cp_citation_vendor_relevance` (the #1858/#1877 cross-vendor citation-strip) has no operable
deterministic PR guard: `eval-replay-gate.yml` `hashFiles`-skips because the replay store is `.gitignore`'d.
Two sub-tasks: **(a, agent, keyless)** apply `2026-06-15-D8-replay-gate-require-both-stores.patch` so the
gate's activation predicate checks BOTH `cascade.json` + `retrieval.json` (else a half-record flips it
active-but-broken). **(b, founder)** record the store per `2026-06-11-D4-replay-seam-activation.md`
(`MIRA_EVAL_REPLAY=record` w/ live keys → PII eyeball → un-gitignore `.gitignore:241` → commit). When both
land, the only YELLOW lens (D) flips GREEN. **Branch:** `fix/eval-replay-gate-require-both-stores`.

### #2 — Add ADR-0017 reverse-drift canary (P2, agent) `ready-for-agent`
**Body:** The engine helper `proposal_transition.py` writes `relationship_proposals.status` but disowns
`ai_suggestions`, while `/api/proposals` GET now reads `ai_suggestions` (×6, #1845) — so an engine-side
accept/reject can surface a stale `pending` suggestion for a terminal proposal (a review-state "lie").
Existing 2 canary checks are forward-only. Patch adds a 3rd read-only `@check`. **Patch:**
`2026-06-10-canary-reverse-drift-check.patch`. **Verify:** `grep -c '@check:' …` = 3; canary harness vs
staging = 0 rows. **Branch:** `test/canary-reverse-drift`.

### #3 — Gate the 3 orphan Playwright configs (P2, agent) `ready-for-agent`
**Body:** `command-center` now has live code with no e2e gate; 3 `playwright.*.config.ts` exist but aren't
run by any workflow. Fold them into `smoke-test.yml` (signup config is the template). Command-center first.
**Verify:** workflow runs the config on PR; failing selector fails the job. **Branch:** `ci/gate-playwright-configs`.

### #4 — Fix staging doc drift (P3, agent) `ready-for-agent`
**Body:** `docker-compose.staging.yml` (+ `staging-vps.yml`) and `@MiraStaging_bot` all exist on main, but
`CLAUDE.md` L45/L47 and `environment-quick-ref.md` still mark them `(TODO)` / "Gap-1 does not exist yet".
**Patch:** `e8-staging-docdrift.patch` (applies clean to origin/main; residual L17/L96 sweep noted in its
README). **Branch:** `docs/e8-staging-docdrift`.

### #5 — Require "Version Bump Check" in branch protection (P2, human) `ready-for-human`
**Body:** #1970 shipped `version-gate.yml` (fails a code PR with no `/VERSION` bump) + `version-tag.yml`
(auto-tag + rollback checkpoint per merge). The gate must be added to `main` branch-protection required
checks once it's reported green once. Until then a code PR can merge with no rollback point. **Action:**
GitHub → Settings → Branches → `main` → add "Version Bump Check".

### #6 — Make deploy reproducible: deploy-by-tag (P2, agent) `ready-for-agent`
**Body:** #1970 built the rollback target (`v<VERSION>` + `rollback/<date>`), but `deploy-vps.yml` still
checks out `main` HEAD. Change the deploy to check out the tag, so a deploy is reproducible and a rollback
is a re-deploy of the previous tag. Needs a short design note first (tag-selection + hotfix path). **Branch:**
`ci/deploy-by-tag`.

### #7 — Set `COMMAND_CENTER_DISPLAY_HOST_ALLOWLIST` in prd (P3, human) `ready-for-human`
**Body:** Before multi-tenant Command-Center display registration, set the allowlist in `factorylm/prd`
(Doppler). Agent can't touch prd Doppler; founder action. (From Lens A next-action.)

## Execution order (work-off)

**Agent track (branch → patch/edit → verify → PR, no merge):**
1. **#4 doc-drift** — patch ready, applies clean → fastest first PR.
2. **#2 canary** — zero runtime risk, patch ready, verify vs staging → PR.
3. **#1a D8 gate** — keyless, mergeable today → PR (leaves #1b for you).
4. **#3 Playwright wiring** — write + verify → PR.
5. **#6 deploy-by-tag** — design note → implement → PR.

**Human track (you, in parallel — none block the agent track):**
- **#1b** record the replay store (~30 min, live keys) → flips D GREEN.
- **#5** add the version-gate to branch protection (~2 min).
- **#7** set the prd allowlist var (~2 min).

## Open mechanism question
`gh` is not installed in this sandbox and no GitHub MCP connector is authenticated, so I have no automated
path to create the issues right now. Resolution options are in the question accompanying this plan.
