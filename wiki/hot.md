# Hot Cache — 2026-04-18 — CHARLIE

## eval-fixer run — 2026-04-18
- Scorecard: 43/56 passing (77%) — parsed from `tests/eval/runs/2026-04-18T0459-offline-text.md`
- Action: issue-filed (GitHub #382)
- 13 patchable failures across 3 file clusters (engine.py 5, guardrails.py 9, prompts/diagnose/active.yaml 9) → multi-file hard stop triggered. Three sub-patterns: (A) 5 fixtures FSM stuck before DIAGNOSIS (Q1→Q2/Q3→DIAG progression); (B) 7 fixtures missing expected vendor vocabulary in response (likely downstream of A); (C) 2 Yaskawa fixtures leaking PowerFlex/Allen-Bradley text — regression in v2.4.0 cross-vendor guard for A1000 + GA500. Net +8 fixtures vs. 2026-04-17 (35→43) — citation-gate fixes landed, but new FSM + cross-vendor regressions surfaced.

## eval-fixer run — 2026-04-17
- Scorecard: 35/56 passing (62%) — parsed from `tests/eval/runs/2026-04-15-v0.8-final.md`
- Action: issue-filed (GitHub #376)
- 21 failures across 3 file clusters (engine.py 12, guardrails.py 17, prompts/diagnose/active.yaml 17); 20 patchable exceeded 15-fixture ceiling + multi-file hard stops both triggered. Dominant patterns: (1) 13 fixtures with no honesty signal — out-of-KB vendors hallucinating through DIAGNOSIS; (2) 10 fixtures with FSM stuck at Q1-Q3 instead of DIAGNOSIS/IDLE; (3) 1 safety escalation missing; (4) 1 cp_pipeline_active infra skip. Root cause likely: citation gate `_compute_kb_status()` 🟡 PROCEED threshold too permissive for zero-chunk vendors.

## Just Finished (this session)

- **Autonomous eval-fixer agent** — ADR-0010 Enhancement 5 implemented
  - `tests/eval/eval_watchdog.py` — parses latest scorecard into structured JSON failure report
  - `.claude/agents/eval-fixer-instructions.md` — agent instructions: watchdog → classify → patch → offline verify → draft PR (or file issue)
  - `.claude/agents/run-eval-fixer.sh` — launchd wrapper, `--max-budget-usd 1.00`
  - `~/Library/LaunchAgents/com.mira.eval-fixer.plist` — fires at 01:00 local (≈05:00 UTC daily)
  - Hard limits: ≤1 file changed, ≤50 lines, allowed targets only, NEVER touch fixtures/grader/SAFETY
  - Scope gates: skip if >15 patchable failures or >1 file cluster → file GitHub issue instead
  - E2E verified: watchdog parses both scorecard formats, claude CLI flags accepted, Bash tool works

- **Citation gate implemented** (commit 02dbf50, PR #345 → feat/training-loop-v1)
  - Hard block at DIAGNOSIS/FIX_STEP when KB coverage is UNCOVERED (0 high-quality chunks sim ≥0.65)
  - 🟢/🟡/🔴 banners injected deterministically in engine.py — not relying on LLM
  - PROCEED override: tech types PROCEED → override_mode=True in FSM context → ⚠️ BEST-GUESS MODE
  - Auto-ingest: `_fire_scrape_trigger()` fires on every 🔴 gate + 🟡 partial gate
  - Citation footer (📚 Source: ...) appended for covered/partial with source URLs
  - Rule 16 in GSD_SYSTEM_PROMPT hardened: LLM must BLOCK (not caveat) when no retrieved docs
  - Open WebUI: WEBUI_CUSTOM_CSS red border added to docker-compose.yml as default safe state
  - Chunk headers annotated with `[Source: mfr model — section]` in LLM context

- **Root cause of 7 honesty failures (prev session)**
  - Vendor chunks in KB for WRONG models (NULL model_number) → vendor check passes → no suppression
  - Citation gate bypasses this entirely — fires on similarity threshold, not vendor name match

- **v1.0 eval** — 32/57 (56%) — programmatic injection never fired (trigger requires `_last_no_kb=True` which doesn't fire when wrong-model chunks pass cross-vendor check)

## Eval State

| Run | Score | Notes |
|-----|-------|-------|
| v0.6 (baseline) | 30/56 (54%) | pre-session baseline |
| v0.8-final (VPS) | **35/56 (62%)** | real score, commits e3bc226 |
| v0.9 (VPS, 2026-04-16) | 35/57 (61%) | Rule 22 not followed, honesty fixtures still fail |
| v1.0 (VPS, 2026-04-16) | 32/57 (56%) | Programmatic injection never fires; 3 non-determinism regressions |
| **citation-gate (pending)** | **TBD** | PR #345 — expect 39–42/57 if gate fires correctly |
| Target | **40/57 (70%)** | Merge threshold for PR #297 |

### 7 Honesty Failures (targeted by citation gate)
`yaskawa_v1000_oc_22`, `yaskawa_j1000_thermal_24`, `yaskawa_ga700_encoder_26`, `sew_overcurrent_29`, `vfd_abb_01_acs580_fault_2310`, `vfd_abb_04_acs150_multi_turn`, `vfd_siemens_01_sinamics_g120_f30001`

**Expected behavior after gate**: these now return 🔴 gate message instead of hallucinated advice.
**Risk**: `cp_keyword_match` checks for honesty signal in reply text — gate reply includes "No manual found" which may or may not match the honesty regex. Verify eval criteria passes 🔴 gate messages.

### Self-Critique Non-Determinism (3 scenarios, unchanged)
`full_diagnosis_happy_path_07`, `reset_new_session_09`, `vfd_siemens_01` — fail intermittently when self-critique scores groundedness < threshold and parks FSM in DIAGNOSIS_REVISION.

## Machine State

- **CHARLIE (this machine):** `feat/citation-gate` branch, pushed — PR #345 open against `feat/training-loop-v1`
- **VPS (165.245.138.91):** mira-pipeline still running v1.0 code. Pull + rebuild needed to test citation gate.
- **Bravo (100.86.236.11):** Ollama :11434 OK
- **PLC Laptop (100.72.2.99):** PLC at 192.168.1.100 unreachable — physical check needed

## Blocked / Open

- **PR #297 (feat/training-loop-v1)** — not merged. Needs 40/57. Citation gate (PR #345) must merge to this branch first, then eval.
- **Eval gate check** — need to verify `cp_keyword_match` regex accepts 🔴 gate message. If not, fixture pass criteria need updating.
- **OW manual steps** — KB PDF uploads, admin toggle: Memory, Channels, Code Execution, Web Search — require browser UI
- **mira-sidecar OEM migration** — 398 ChromaDB chunks need moving to OW KB
- **mira-web → pipeline cutover** — mira-chat.ts still calls sidecar :5000/rag

## Next Steps (priority order)

1. **Merge PR #345** — review citation gate on feat/training-loop-v1
2. **Run eval on VPS** after merge + container rebuild — check honesty fixture pass rate
   - If `cp_keyword_match` fails on 🔴 gate replies: update fixture expected patterns to match "No manual found"
   - Target: 40/57 (70%)
3. **If 40/57 reached** → merge PR #297 to main
4. **OW manual steps** — KB PDF uploads, admin toggle: Memory, Channels, Code Execution, Web Search
5. **mira-sidecar OEM migration** — run tools/migrate_sidecar_oem_to_owui.py

## Key NeonDB Facts
```
Total chunks: ~68,000+
Rockwell Automation: 13,686 chunks (main KB)
ABB: 931 chunks — mostly NULL model_number
Siemens: 905 (SINAMICS label) + 442 (other models)
AutomationDirect: 2,250 chunks (GS10, PF525, etc.)
Yaskawa: 27 chunks (NULL model) + 1 (CIMR-AU4A0058AAA)
SEW-Eurodrive: 6 chunks (R47 DRE80M4 gearmotor — NOT a VFD)
Danfoss: 2 chunks (VLT FC302 only)
Mitsubishi Electric: 16 chunks (NULL model)
```
