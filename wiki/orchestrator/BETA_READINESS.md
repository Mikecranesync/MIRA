# MIRA Beta Readiness — Audit Lenses (compact scorecard)

**Updated:** 2026-06-17 (D9 run — Lens D eval & test health).

**Gate:** a stranger signs up on app.factorylm.com, uses MIRA's grounded chat, and nothing
breaks, leaks, or lies. Literal test: `tests/beta/beta_ready_upload_retrieval_citation.py`
— **xfail REMOVED 2026-06-17 (#2077); now a real assertion, ran GREEN end-to-end, CI-enforced
by `.github/workflows/beta-gate.yml`** (staging Neon, real stranger provisioning) +
`docs/plans/2026-06-07-path-to-beta.md`.

**Beta-readiness == production == `origin/main`.** Every lens audits `origin/main`, not the
working tree. ⚠️ This run: freshness-guard exit 3 (STALE) — HEAD `feat/hub-e2e-ci` is **7
commits behind** origin/main @14fe2732 and `tests/` DIFFERS from the tree, so the Lens D audit
read `git show origin/main:…` (deploy truth), not the working tree. origin/main unchanged since
C9 this morning (same @14fe2732). Findings below are vs origin/main.

| Lens | Status | Last audited | Top finding (1 line) | Next action (1 line) |
|---|---|---|---|---|
| **A** Hub security & auth | 🟢 GREEN | 2026-06-16 (A9) | 13 hub/web commits since A8, 0 new unguarded route, 0 weakened auth; only new external script-src origin = www.dropbox.com (Chooser triad behind nonce) | Keep Dropbox-only; no CDN-wildcard creep in `buildCsp`. |
| **B** Hub functional readiness | 🟡 YELLOW *(was GREEN @B8)* | 2026-06-17 (B9) | **P1 LEAK (beta-path):** `/api/knowledge/search` (#2044) reads `knowledge_entries` with no `is_private`/tenant filter → any tenant can full-text-search another tenant's private uploaded manuals (#1833 class). ADR-0017 clean; tsc clean. | Ship staged patch `patches/2026-06-17-B9-knowledge-search-isprivate-leak.patch` (adds `AND is_private = false` to both queries) via PR off main. |
| **C** Engine integrity | 🟢 GREEN | 2026-06-17 (C9) | NOT frozen this cycle: 2 commits since C8 — #2045 troubleshooting-session lifecycle (FIRST new engine NeonDB **write** surface) + #2075 PF-shorthand RAG expansion — both invariant-safe; all 5 invariants re-verified intact; new write path lands **tenant-safe** (explicit `AND tenant_id=CAST(:tenant_id AS UUID)` on every UPDATE + RLS dual-setting matched to mig-019 policy + fail-open + no read surface) → no write-leak | Re-verify after any `engine.py`/`troubleshooting_session.py` change; confirm nightly KG ingests the new write surface (absent @14fe2732 graph). |
| **D** Eval & test health | 🟡 YELLOW *(held, strengthened)* | 2026-06-17 (D9) | **HEADLINE:** #2077 flipped the literal North Star release gate `xfail→enforced` + it RAN GREEN end-to-end (stranger uploaded fixture manual via real `/files/` door → `[1]`-cited "GS10 oC = overcurrent", zero manual fixing) + CI-enforced by `beta-gate.yml` on **staging Neon** → **closes D8 blocker #3**. Still YELLOW: offline scorecard slipped 50/57→**49/57** (hot.md eval-fixer 2026-06-17, +1 ground-fault KB miss; 0 beta-critical fails) + #1858 vendor-strip replay seam still INERT (store `.gitignore:241` unrecorded, **6-cycle** founder carry). | Founder records replay store (6-cycle carry) OR ship D8 `replay-gate-require-both-stores` patch (re-verified `--check` clean); make `beta-gate.yml` cover engine-side citation paths (path-filter excludes `mira-bots/shared/`). |
| **E** Promotion pipeline | 🟢 GREEN | 2026-06-15 (E8) | Staging real (compose + `@MiraStaging_bot`); deploy-vps double-gated (staging-gate + smoke); migration head 053; #1970 version counter + rollback checkpoint | Make `version-gate.yml` a required branch-protection check; clear E-lens doc-drift. |
| **F** Beta-blocker ledger | 🟢 GREEN | 2026-06-15 (F8) | North Star YES on deploy truth; #1901 onboarding upload→ask gate merged + staging usable; sharpest residual = that gate has **NO CI regression test** (onboarding-validate config gates 0 workflows) | Wire onboarding-validate into deploy-blocking smoke (`patches/2026-06-15-F8-wire-onboarding-validate-ci.md`). |

**Overall:** 4 GREEN / 2 YELLOW (unchanged counts — D held YELLOW). **North Star event:** D9
found the literal beta-readiness gate flipped from `xfail` to an **enforced assertion that ran
GREEN end-to-end** (#2077) and is now a real CI job (`beta-gate.yml`, staging Neon, real stranger
provisioning + cleanup) — the central "can a stranger upload→ask→get a cited answer" claim is
now machine-proven on every beta-chain PR + weekly, not just asserted. D stays YELLOW because
that flip touches neither YELLOW reason: the offline scorecard slipped 1 (50→49/57, 0
beta-critical) and the #1858 vendor-strip replay seam is still inert. The #1 blocker remains the
B9 `/api/knowledge/search` cross-tenant READ leak (#2044) — patch staged, unmerged.

---

## Top 3 beta blockers right now

1. **[P1 LEAK · beta-path] `/api/knowledge/search` cross-tenant content leak.** Behind
   `sessionOr401` but ignores `ctx.tenantId`; both BM25 + ILIKE queries hit `knowledge_entries`
   with no `is_private` filter, returning `content` snippets across the hybrid corpus →
   leaks other tenants' private uploaded-manual snippets/titles/source_urls. Reachable from the
   `(hub)/knowledge/manuals` UI. **Next:** `git checkout -b fix/knowledge-search-isprivate-leak
   origin/main && git apply -p1 wiki/orchestrator/patches/2026-06-17-B9-knowledge-search-isprivate-leak.patch`
   (verified `--check` clean), add tenant-isolation route test, PR.
2. **[P2 · beta-path · NARROWED] Onboarding *UI walkthrough* still has 0 CI coverage.** The
   upload→ask→cite **functional chain** is now CI-covered by `beta-gate.yml` (#2077) — but the
   `onboarding-validate`/`onboarding-walkthrough`/`command-center` Playwright configs still gate
   **0 workflows on origin/main**; the `hub-e2e.yml` that would wire them is untracked
   `feat/hub-e2e-ci` WIP, not merged (the very branch this audit's HEAD sits on — do not trust the
   working tree). **Next:** ship `patches/2026-06-15-F8-wire-onboarding-validate-ci.md` or merge
   `hub-e2e.yml` so the onboarding UI flow regresses in CI, not just the chain.
3. **[P2 · eval] #1858 vendor-strip (`cp_citation_vendor_relevance`) is the one diagnostic
   invariant with no operable PR-time CI guard.** `eval-replay-gate.yml` single-file `hashFiles`
   skips because the replay store is `.gitignore`'d/unrecorded (`.gitignore:241`) → 6-cycle
   founder carry; offline scorecard also slipped 50→49/57 (a 2nd ground-fault KB miss, 0
   beta-critical). **Next (operator):** record the replay store (D4 runbook) — OR ship
   `patches/2026-06-15-D8-replay-gate-require-both-stores.patch` (re-verified `--check` clean).

**Closed since C9:** ~~[P1 · gate] Literal gate test can't flip without dev/staging env~~ —
**CLOSED 2026-06-17 (#2077)**: `beta-gate.yml` builds a Hub on staging Neon, provisions a real
stranger, runs the gate with `BETA_GATE_*` set, and it ran GREEN end-to-end. The old operator
step is now an automated CI job (Mon cron + dispatch + beta-chain PRs).

## Standing (non-stranger-reachable, tracked)
- Canary reverse-drift: `proposal_state_drift.sql` has only 2 forward-only checks; terminal-vs-stale-pending
  drift uncovered (**7-cycle stall**; staged `patches/2026-06-10-canary-reverse-drift-check.patch`).
- tsc nit: 2 stale `@ts-expect-error` (TS2578) in `rls-deny.integration.test.ts:55`,
  `sitemap-drift.test.ts:3` — would fail a strict `tsc`/`next build`; 2-line removal, test-only P3.
