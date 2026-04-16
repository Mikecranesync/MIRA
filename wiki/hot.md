# Hot Cache — 2026-04-16 — CHARLIE

## Just Finished (this session)

- **eval infra fixed** (commit d607f39)
  - `judge.py` — Claude HTTP 400/402/429 → auto-fallback to Groq. Judge now works without Anthropic credits.
  - `run_eval.py` — Remote PIPELINE_URL detection: appends `-remote` suffix + warning banner. Prevents false local runs overwriting VPS scorecards (root cause of 8/56 confusion).
  - Restored real `tests/eval/runs/2026-04-15-v0.7-honesty.md` (was overwritten by false overnight run).
  - Renamed false overnight v0.8 run to `2026-04-15-v0.8-diagnosis-advance-remote.md`.

- **Prompt v0.9 (honesty-diagnosis)** — Rule 22 + Example 7
  - Mandates `"I don't have [vendor] documentation in my records."` prefix when diagnosing out-of-KB equipment
  - Targets 7 honesty_required DIAGNOSIS failures: yaskawa_v1000_oc, j1000_thermal, ga700_encoder, sew_overcurrent, vfd_abb_01/04, vfd_siemens_01
  - If all 7 fix: **35+7 = 42/56 (75%)** — well above 40/56 merge threshold for PR #297

## Eval State

| Run | Score | Notes |
|-----|-------|-------|
| v0.6 (baseline) | 30/56 (54%) | pre-session baseline |
| v0.8-final (VPS) | **35/56 (62%)** | real score, commits e3bc226 |
| v0.7/v0.8 overnight | 8-9/56 | FALSE — DB split (remote PIPELINE_URL + local DB). Now labeled -remote. |
| v0.9 | **TBD** | Deploy to VPS then run eval |

## Machine State

- **CHARLIE (this machine):** Active session, 2 evals running background. `feat/training-loop-v1` branch.
- **Bravo (100.86.236.11):** Ollama :11434 — generates embeddings for ingest
- **VPS (165.245.138.91):** mira-pipeline :9099 running (eval hits this). OPENWEBUI_API_KEY was stale — rotated Apr 14.
- **PLC Laptop (100.72.2.99):** PLC at 192.168.1.100 unreachable — physical check needed

## Blocked

- **PR #297 not merged** — v0.9 needs VPS eval before merge decision. Target: 42/56.
- **OW manual steps** — folder org, KB uploads, memory/channels/code execution toggles — require browser UI
- **mira-sidecar OEM migration** — 398 ChromaDB chunks need moving to OW KB (script at tools/migrate_sidecar_oem_to_owui.py)
- **mira-web → pipeline cutover** — mira-chat.ts still calls sidecar :5000/rag

## Next Steps (priority order)

1. **Deploy v0.9 prompt to VPS** — `git pull` on VPS (prompt loads from YAML, no container restart needed). Then run eval:
   ```bash
   # FROM VPS (ssh root@165.245.138.91)
   cd /opt/mira && git pull && EVAL_DISABLE_JUDGE=1 doppler run --project factorylm --config prd -- python3 tests/eval/run_eval.py --output tests/eval/runs/2026-04-16-v0.9-honesty-diagnosis.md
   ```
2. **If ≥40/56: merge PR #297** — `gh pr merge 297 --squash`
3. **Run `setup_owui_models.py`** on app.factorylm.com: `doppler run --project factorylm --config prd -- python3 tools/owui_tools/setup_owui_models.py`
4. **OW manual steps** — KB PDF uploads, admin toggle: Memory, Channels, Code Execution, Web Search
5. **mira-sidecar OEM migration** — run tools/migrate_sidecar_oem_to_owui.py
