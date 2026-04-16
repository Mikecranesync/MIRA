# Hot Cache — 2026-04-16 — CHARLIE

## Just Finished (this session)

- **eval infra fixed** (commit d607f39) — judge.py fallback, remote-pipeline guard, VPS scorecards restored

- **v0.9 prompt (honesty-diagnosis)** — 35/57 on VPS (below 40/56 merge threshold). Rule 22 was ignored by LLM — model omits honesty prefix even when it reaches DIAGNOSIS for out-of-KB vendors.

- **Diagnosis: Why honesty fails** (commit 9cf1f11 — partial fix)
  - KB has vendor chunks for WRONG models: 26 Yaskawa (NULL model), 931 ABB (NULL model), 905 Siemens (model_number="SINAMICS"), 6 SEW (gearmotor, not VFD), 2 Danfoss (FC302 only)
  - Vendor check passes (vendor IS in KB) → chunks not suppressed → `_last_no_kb = False`
  - Programmatic injection (engine.py) never fires because trigger requires `_last_no_kb = True`

- **Implemented**: Programmatic honesty prefix injection in engine.py + `_last_no_kb` tracking in rag_worker.py + Prompt v1.0 (removed Rule 22, updated Example 7). v1.0 eval: 32/57 (regression from non-determinism, not code bug).

- **Root blocker identified**: Need **model-level KB check** — extract model token from query (J1000, ACS580, G120) and verify it appears in chunk `model_number` fields. Risk: Yaskawa A1000 chunks stored as "CIMR-AU4A0058AAA" — literal "A1000" not present in model_number string.

## Eval State

| Run | Score | Notes |
|-----|-------|-------|
| v0.6 (baseline) | 30/56 (54%) | pre-session baseline |
| v0.8-final (VPS) | **35/56 (62%)** | real score, commits e3bc226 |
| v0.9 (VPS, 2026-04-16) | 35/57 (61%) | Rule 22 not followed, honesty fixtures still fail |
| v1.0 (VPS, 2026-04-16) | 32/57 (56%) | Programmatic injection correct but never fires; 3 DIAGNOSIS_REVISION regressions = Groq non-determinism |
| Target | **40/57 (70%)** | Merge threshold for PR #297 |

### 7 Persistent Honesty Failures (unchanged v0.8→v1.0)
`yaskawa_v1000_oc_22`, `yaskawa_j1000_thermal_24`, `yaskawa_ga700_encoder_26`, `sew_overcurrent_29`, `vfd_abb_01_acs580_fault_2310`, `vfd_abb_04_acs150_multi_turn`, `vfd_siemens_01_sinamics_g120_f30001`

All reach DIAGNOSIS but omit the honesty prefix. All fail `cp_keyword_match: No honesty signal`.

### Self-Critique Non-Determinism (3 scenarios)
`full_diagnosis_happy_path_07`, `reset_new_session_09`, `vfd_siemens_01` — fail intermittently when self-critique scores groundedness < threshold and parks FSM in DIAGNOSIS_REVISION.

## Machine State

- **CHARLIE (this machine):** `feat/training-loop-v1` branch, 3 commits ahead of origin
- **VPS (165.245.138.91):** mira-pipeline running v1.0 code (rebuilt container). eval-v1.0-programmatic-honesty.md = 32/57
- **Bravo (100.86.236.11):** Ollama :11434 OK
- **PLC Laptop (100.72.2.99):** PLC at 192.168.1.100 unreachable — physical check needed

## Blocked

- **PR #297 not merged** — Current best eval: 35/57 (v0.9). Needs 40/57. Root blocker: model-level KB check.
- **Model-level KB check** — Issue #313 needs implementation. Risky: CIMR-AU4A0058AAA doesn't contain "A1000" literal → model check would incorrectly suppress chunks for A1000 queries.
- **OW manual steps** — folder org, KB uploads, memory/channels/code execution toggles — require browser UI
- **mira-sidecar OEM migration** — 398 ChromaDB chunks need moving to OW KB
- **mira-web → pipeline cutover** — mira-chat.ts still calls sidecar :5000/rag

## Next Steps (priority order)

1. **Model-level KB check (issue #313)** — Implement in `rag_worker.py` `process()` after vendor check. Must solve the CIMR-AU4A0058AAA → A1000 alias problem. Options:
   - Build vendor-model alias map (SEW→MOVITRAC, Yaskawa A1000→CIMR-A*, etc.)
   - OR: check chunk CONTENT (not model_number field) for the queried model string
   - OR: add `model_family` field to NeonDB schema and populate during ingest
   Once implemented: run eval, expect 35+7=42/57 → merge PR #297

2. **Run `setup_owui_models.py`** on VPS (already synced): `doppler run --project factorylm --config prd -- python3 tools/owui_tools/setup_owui_models.py`

3. **OW manual steps** — KB PDF uploads, admin toggle: Memory, Channels, Code Execution, Web Search

4. **mira-sidecar OEM migration** — run tools/migrate_sidecar_oem_to_owui.py

## Key NeonDB Facts (discovered this session)
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
