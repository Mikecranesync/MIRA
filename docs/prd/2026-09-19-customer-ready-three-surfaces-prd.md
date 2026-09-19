# PRD — Customer-Ready on Three Surfaces (mobile · Hub/web · public demo)

**Date:** 2026-09-19 · **Owner:** Mike · **Author:** mira-2a-mq (CHARLIE) · **Status:** DRAFT for execution
**Governs:** the next level for each surface, split into four agent lanes: CHARLIE-A, CHARLIE-B, BRAVO-A, BRAVO-B.
**Supersedes nothing** — this sequences the existing contract (`pilot-2026-09-16/CONVERGENCE-ARCHITECTURE.md` §21/§22,
charter `docs/architecture/convergence/UNIFIED_UI_CUTOVER.md` Gate 3) into lane work. Live queue state: `pilot-2026-09-16/MERGE-SITTING-2026-09-19.md`.

## 1. Definition of done ("customer ready")

A stranger, with no help from Mike, can on each surface: sign up → upload their own equipment manual →
ask a real troubleshooting question → get a grounded, cited answer whose citation resolves to the real
passage. Proven by **one same-thread Golden Conversation** (charter §22) captured on:

| Surface | Host | Proof artifact |
|---|---|---|
| Mobile | Pixel 9a, release-signed 1.2.1 build | screenshots in `docs/promo-screenshots/` + `docs/proofs/2026-09-2x-pixel9a-golden-conversation.md` |
| Hub | `app.factorylm.com/v3` (prod, OVH) | Playwright screenshots desktop 1440×900 + mobile 412×915 + the chat POST trace |
| Public demo | `factorylm.com` SimLab conveyor | Playwright run + rate-limit/proxy test output |

Unit tests, CI badges and IR PASSes are **inputs**, not proof. The proof is the walk.

## 2. Where each surface is (2026-09-19 17:00Z)

- **Mobile:** #3833 + #3829 merged today (main `8ada774a3`). #3835 in merge (head `d3e0f50d4`, IR pending at tip).
  Open: #3837 P0 photo grounding (Codex BLOCKED @747c22f8d), #3854 photo-before-abstain (IR in flight),
  **#3852 security defect** (negated vision text trips `SAFETY_KEYWORDS_IMMEDIATE` → false SAFETY STOP), #3845 release 1.2.1 (draft).
- **Hub/web:** #3839 `/v3` shared-shell mount has IR PASS @c065fc2dd, queued after #3835. #3840 merged. #3721 composer fix behind main.
  09-07 beta-gate failures (no composer, `Chat unavailable (412)`, cold-launch stranding) unverified since.
  **Deploy blocker:** `deploy-vps.yml` on main SSHes to dead DO IP `165.245.138.91`; prod is OVH `40.160.141.61`. #3825 repoints it (open, guard red, body needs fix).
- **Public demo:** #3815 (SimLab conveyor) + #3828 (deploy) drafts, CI clean, container image never built.

## 3. Lanes

Rules for every lane: one worktree per lane; never touch another lane's branch; exact-SHA IR before any merge;
attestation comment on every merge (owner direction 2026-09-19); **no prod deploy, no OTA publish, no label** without
Mike's explicit go in the thread. Report with SHAs, not adjectives. Post lane status on issue #3626 at each checkpoint.

### CHARLIE-A — merge queue + Hub `/v3` proof (owner: mira-2a-mq / `uip267k1`)
Has: `gh` (allow rule `Bash(gh pr *)`), Docker/Colima, Playwright, staging deploy workflow.
1. Run the §21 queue to exhaustion: #3835 → #3839 → #3837 (after BRAVO-A/technician-pilot remediation) → #3721 → #3854 → #3825.
   Per PR: `gh pr update-branch` → six required contexts green → IR PASS at exact tip (alpha-remote / BRAVO-A) → attest → `gh pr merge --squash --match-head-commit`.
2. After #3839 lands: `deploy-staging.yml` with the main SHA; then the **Hub stranger walk on staging** — fresh tenant, upload a manual
   nobody has uploaded before, ask, cited answer, citation resolves. Capture desktop+mobile screenshots (Screenshot Rule) and the single canonical chat POST.
3. Re-verify the three 09-07 beta-gate failures explicitly (composer present on home; no 412 banner on first send; `New chat` enabled on cold launch).
**Accept:** every queue PR merged with attestation + SHA listed on #3626; staging walk artifacts committed; the three 09-07 failures each marked PASS/FAIL with evidence.
**Hand-off to Mike:** "#3825 merged; first OVH `deploy-vps.yml` dispatch is yours" with the exact `gh workflow run` line.

### CHARLIE-B — mobile release + Pixel Golden Conversation (owner: a second CHARLIE session; Pixel + emulator live here)
Has: adb, AVD `mira35`, Doppler prd release keystore, `tools/mobile-e2e/`, sideload recipe (memory `project_mobile_debug_apk_sideload_recipe`).
1. Claim #3845 (1.2.1 release) on its thread; rebase onto main once #3835/#3837/#3854 land; decide with technician-pilot which PR carries the #3852 fix (Mike's call if contested).
2. Emulator gate first: `bash tools/mobile-e2e/run.sh <manual.pdf> "<question>" <expected-page>` against staging — green means it cited the *right page*.
3. Build release-signed 1.2.1, sideload to the Pixel (never uninstall; shared adb server — announce before driving the phone), run the Golden Conversation:
   camera photo → grounded card → upload manual → ask → cited answer → citation viewer → cold restart → history survives. Screenshot every step.
4. OTA manifest prepared but **not published** (checksum hex, About-screen proof) — publish is Mike's go.
**Accept:** `docs/proofs/…golden-conversation.md` with ≥8 screenshots, the exact APK sha256 + versionCode, emulator run log green, OTA manifest staged unpublished.

### BRAVO-A — engine safety fix + eval truth + second reviewer (owner: `f7wg2tjp@bravo`)
Has: Ollama, Doppler, Python 3.12, `gh` (confirm auth first — reply to uip267k1).
1. **#3852 fix**, own branch `fix/3852-negated-vision-safety-stop`: red-first test in `mira-bots/tests/` proving a negated observation
   ("no exposed wiring, guards in place") does NOT trip `SAFETY_KEYWORDS_IMMEDIATE`, while a positive hazard still does (opposite-direction guard).
   Fix in `mira-bots/shared/guardrails.py` scoped to injected vision text (co-activates `mira-industrial-safety`; safety-reviewer agent pass required). Open PR, request IR.
2. **Eval timeout truth (#3085, unowned since 07-30):** set `MIRA_PROCESS_TIMEOUT=90` for `tests/eval` runs (harness config, not engine), run the offline suite
   once at post-queue main, post the scorecard with SHA stamped. One run; do not chase σ.
3. Second exact-tip IR reviewer for the queue when alpha-remote is busy — read-only, `[INDEPENDENT-REVIEW] PASS|FAIL` at the SHA.
**Accept:** #3852 PR open with red→green test evidence and safety-review comment; one eval scorecard at a named main SHA with timeout=90; ≥1 IR verdict posted.

### BRAVO-B — public demo + deploy readiness (owner: second BRAVO session)
Has: Docker, Doppler, `gh`, no Pixel.
1. **#3815/#3828 known gap:** build the demo container image from the PR head, boot it, run the proxy + rate-limit tests the PR body says were manual
   (reconstructed commands in the closeout checklist); post results on #3815. Do not undraft — report readiness.
2. **#3825 follow-ups** (read + PR on own branch, never Mike's branch): hard-fail the cmms preflight; purge the DO IP `165.245.138.91` from `docs/`, `tools/hooks/prod-guard.sh`, `CLAUDE.md`, `deployment/network.yml`; verify `ovh-preflight.yml` targets `40.160.141.61`.
3. Post-merge prod smoke plan: the exact `bash install/smoke_test.sh` + `curl` lines against `factorylm.com` / `app.factorylm.com` that CHARLIE-A runs after Mike's first dispatch.
**Accept:** demo image sha + boot log + test output on #3815; DO-IP purge PR open with grep-zero proof; smoke plan committed to `docs/runbooks/`.

## 4. Order and dependencies

```
CHARLIE-A queue: #3835 ─► #3839 ─► (#3837 ◄─ BRAVO-A/technician-pilot remediation) ─► #3721 ─► #3854 ─► #3825
                                │                                                          │
                                ▼                                                          ▼
                       staging deploy + Hub walk                        Mike: first OVH dispatch ─► prod smoke (BRAVO-B plan)
CHARLIE-B: emulator gate ─► 1.2.1 build (after #3837/#3854/#3852 land) ─► Pixel walk ─► OTA staged
BRAVO-A: #3852 fix PR (start now) ─► IR ─► joins queue before 1.2.1 build
BRAVO-B: demo image + tests (start now) ─► #3815 undraft readiness ─► #3828 after #3815 merges
```

## 5. Mike's decisions (only these)
1. First `deploy-vps.yml` dispatch to OVH after #3825 merges.
2. Which PR carries the #3852 fix if BRAVO-A and technician-pilot disagree.
3. OTA publish of 1.2.1 after the Pixel walk.
4. #3844 second GitHub identity (not on the critical path; attestation route stands until then).

## 6. Non-goals
No new features. No second chat store / evidence DB / shell fork. No engine cascade changes. No PLC/OT writes.
No work on `mira-sidecar`, `mira-connect`, SimLab scenarios beyond what #3815 already contains.

## 7. Reporting
Each lane posts a `[LANE-STATUS] <lane> @ <SHA>` comment on #3626 at every accept checkpoint and on any BLOCKED.
CHARLIE-A maintains `pilot-2026-09-16/MERGE-SITTING-2026-09-19.md` as the queue's source of truth.
