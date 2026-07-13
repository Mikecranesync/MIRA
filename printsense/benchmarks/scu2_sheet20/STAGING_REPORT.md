# PrintSense — Controlled Staging Proof (report)

Scope executed exactly as directed. **Boundaries honored:** no merge, no production
deploy, no Doppler mutation, no gate bypass. Production remains a separate explicit
decision. Two items are inherently the operator's (see §4b): the agent has no
Telegram *user* session to drive `@Mira_stagong_bot`, and no local Tesseract to
validate in-container auto-rotate.

## 1. PR + commit SHAs
- **PR #2661** — https://github.com/Mikecranesync/MIRA/pull/2661 (OPEN, base `main`, MERGEABLE)
- Reviewed commits pushed this session:
  - `231040be` feat(printsense): Phase 0 accuracy unlocks + deterministic grader
  - `6bbe523d` test(printsense): sheet-20 Phase-0 re-run — D(6.7)→A(95.1), zero confident misreads
  - `1221aca9` merge `origin/main` (branch was 1 behind; VERSION conflict resolved to the higher **3.136.0**; no printsense files touched) — **PR head**
- The PR was CONFLICTING on push (the known branch-behind-main VERSION gotcha); the merge above is the documented, non-bypass fix that also triggered CI.

## 2. CI — required vs advisory (PR head `1221aca9`)
**Zero failures of either kind.**
- **Required** (branch protection): `staging-gate` ✅ · `Version Bump Check` ✅ · `Hub E2E (command-center + onboarding)` ✅ (reported pass this run — not phantom-blocked)
- **Advisory** (all others, all ✅): `Unit Tests` (carries the new hermetic `tests/printsense/` gate — interpreter + grader + tiling/verify, **no `anthropic` SDK in CI**), `Smoke Test` (live-site E2E), `AI Code Review`, `DeepEval`, `Enforcement Audit`, Security (Bandit/Semgrep/Semgrep-OSS), `License Check`, `Lint & Format`, `Enum Drift`, `Migration Order`, `Docker Build`, `actionlint`, …
- Skipped (conditional, not failures): `Hub Page Audit`, `Auto-fix on label`.

## 3. Staging deploy
- Workflow **`deploy-staging.yml`** run `29216736808` — `--ref feat/printsense-telegram`, `services=mira-bot-telegram`, `reset_volumes=false`.
- Conclusion **success**. Scope confirmed in the run log: `SERVICES: mira-bot-telegram` → `Rebuild targets: mira-bot-telegram` → `Container stg-mira-bot-telegram Recreated`. **Only the bot was rebuilt** (not the default full set). Now serving Phase-0 code on `@Mira_stagong_bot`.
- Bot health: container recreated cleanly; a Telegram poller has no HTTP endpoint, so live-reply health = the §4b phone test.

## 4a. Live evidence — rigorous off-bot acceptance eval
Run through the **identical Phase-0 code** the deployed bot uses (same `_SYSTEM`,
preprocess, `xhigh`, confidence gate), with every artifact preserved to
`printsense/benchmarks/_eval_outputs/` (orig+preprocessed dims, request metadata,
raw response, structured extraction, grade, misread count, latency, token cost,
UNREADABLE list). Deterministic grader (`printsense/grader.py`).

| Image | Result | Notes |
|---|---|---|
| **SCU2 sheet-20 upright** | **95.1/100 A**, **0 misreads** | wire F1 **1.0** (`-W5497`/`-W5469`), package 10/10, device `-21/A13`/`-21/A14` |
| **sheet-20 low-res (1100px)** | **86.3/100 B**, **0 misreads** | graceful degradation: *more* items → `unresolved` (6 vs 5), never guessed; wire tags still correct |
| **SCU2 sheet-5** (EK1100 PLC overview) | generalizes | reads `-5/A100`, `-5/A101/EL2008`, `-5/A102`… (matches gold fixture), 5 honest unresolved |
| **unrelated print** (a PLC module face) | **no SCU2 hallucination** | reads its own labels (COMM/ENET/FAULT…); forbid-token check passed |

Acceptance criteria (locally verifiable): SCU2 ≥90 ✅ (95.1) · zero confident misreads ✅ (all cases) · package/title-block ✅ · `-W####` grammar ✅ (no `-WK`) · device tags ✅ · uncertain-stays-unresolved ✅ (the low-res case proves it) · generalization ✅.

## 4b. Live evidence — the operator's phone test (delegated)
Cannot be done by the agent (no Telegram user session; no local Tesseract). Protocol:
**`printsense/benchmarks/scu2_sheet20/STAGING_PHONE_TEST.md`** — five sends through
`@Mira_stagong_bot` covering the two remaining criteria:
- **rotation-invariance** (send the rotated photo → in-container auto-rotate → same facts as upright), and
- **bot routing/reply + no-regression** (a print photo interprets; a nameplate photo still routes to the nameplate flow).

## 5. Before/after — full-page → tiled → verified (frozen grader, sheet-20)
Phases run **offline** on the upright sheet-20 (not deployed to staging). The frozen
grader was corrected once (before any phase) so `machine_verified` is a legitimate
Phase-3 state, not a violation — this does **not** change the full-page or tiled
scores (both all-`proposed`).

| Pass | Overall | Misreads | device F1 | wire F1 | xref F1 | machine_verified | is_A |
|---|---|---|---|---|---|---|---|
| **Full-page** | 95.1 / A | 0 | 0.80 | 1.0 | 0.941 | 0 | False |
| **Tiled (Phase 2)** | **96.0 / A** | 0 | 0.80 | 1.0 | **1.0** | 0 | False |
| **Verified (Phase 3)** | 96.0 / A | 0 | 0.80 | 1.0 | 1.0 | **23 / 27** | False |

- **Phase 2 (targeted tiling)** — located the top-left supply-reference region, cropped it hi-res, blindly reread it, and merged the one grammar-valid, evidence-backed, coordinate-traced improvement: `20.9` (xref F1 0.941→**1.0**). It did **not** indiscriminately re-tile; it touched only unresolved regions and merged only what the crop supported.
- **Phase 3 (independent blind reread)** — a second, fully independent full-page pass (never shown the first graph) confirmed **23 of 27 field-critical facts** → `machine_verified`, including `-21/A13`/`-21/A14`, `-W5497`/`-W5469`, `+SCU2-BEL`/`+SCU1-BEL`, `-X3.9`/`-X4.6`, and all module terminals. The 4 genuinely-ambiguous supply xrefs (`20.9`/`20.8`, `15.7`, `16.6`) were **correctly NOT promoted** — the blind pass read `20.8` for one rail, a real disagreement, so they stay `proposed`, not verified. `human_verified` count = **0** (the machine never claims tech sign-off).

**The A-gate (`is_A`) was NOT forced.** It stays `False` on one criterion — device-tag F1 0.80 (needs 0.85) — because the module **type** catalog code `ITS.LWL-K-01.2` is *read* but honestly hedged, and neither phase resolved it confidently (it is the smallest text on the sheet). No confidence was inflated to pass.

## 6. Token cost + latency
- Acceptance eval (4 images): ~$0.99 total; latency 54–112 s/image (`xhigh` — appropriate for an async Telegram flow).
- Phase 2 (locate + 1 crop): ~$0.07. Phase 3 (independent blind full-page pass): ~$0.28.
- Representative sheet-20 full-page: 8.6k input / 9.0k output tokens, ~90 s, ~$0.27.

## 7. Exact remaining misses
- **`ITS.LWL-K-01.2`** (the module type catalog code) — the *only* rubric tag still missed after tiling. It is **read** (present in `detail` + `unresolved`) but not confidently asserted as the structured `type`. This is the sole reason `is_A` is `False`.
- The supply cross-references `X24V.41 / 20.9` vs `X0V.41 / 20.8` are ambiguous between the two independent passes; Phase 3 correctly leaves them `proposed`, not verified.
- Everything else — package, both device tags, both wire tags, both DIG cross-refs, terminals — is correct and (for 23 of them) independently verified.

## 8. Production recommendation
**Recommend promoting #2661 to production AFTER the operator confirms the §4b phone
test** (rotation-invariance + bot-routing on staging). Rationale:
- Interpreter is **A-level with zero confident misreads** across every off-bot test, generalizes to other sheets/prints, and degrades honestly (uncertain → `unresolved`, never a guess). The one gate miss is a hedged catalog code, not a wrong answer.
- The design is **read-only and cited**; the worst failure mode is "unreadable — retake/meter," which carries no field risk. This is exactly the safety posture for a first prod ship.
- CI is fully green; staging is deployed and scoped to the bot only.
- The two unverified criteria (auto-rotate in-container, live bot reply) are low-risk but should be eyes-on before prod — hence the phone test as the gate.

Phase 2/3 are **not** part of this prod recommendation — they are offline-graded improvements on a separate branch, a follow-on decision.

## Artifacts
`printsense/benchmarks/scu2_sheet20/`: `rubric.json`, `response_b*.graph.json` (full/tiled/verified), `response_b.grade.json`, `phase23_summary.json`, `STAGING_PHONE_TEST.md`. Per-image acceptance records: `printsense/benchmarks/_eval_outputs/*.json`.
