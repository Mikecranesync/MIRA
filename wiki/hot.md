# Hot Cache — 2026-04-15T19:45 — CHARLIE

## Just Finished (this session)

- **Training loop acceleration (feat/training-loop-v1)** — PR #297 open, 6 commits ahead of main
  - `synthetic_pair_gen.py` — 168 DPO preference pairs/night (6 domains × 6 states × 4 variants)
  - `active_learner.py` — threshold 0.6→0.45, cap 10→50, auto-land ≥0.85 confidence direct to main
  - `judge.py` — 5th dimension `conversational_flow` + history-aware turn_log prefix
  - `run_eval.py` — accumulates turn_log per scenario, passes to judge
  - `celery_tasks.py` — `mira_synth.generate_nightly` task at 02:00 UTC

- **OW tool scripts written** (closes #306/#307)
  - `tools/owui_tools/get_equipment_history.py`, `create_work_order.py`, `lookup_part.py`, `search_knowledge.py`
  - `tools/owui_tools/setup_owui_models.py` — 3 specialized models + 5 prompt templates via OW admin API

- **Prompt v0.7 (honesty-signal)** — 5th few-shot: SEW MDX61B F07, out-of-KB path. Targets 10 failing fixtures (#311)
- **Prompt v0.8 (diagnosis-advance)** — 6th few-shot: GS10 pump OC → DIAGNOSIS from context alone. Targets 9 FSM undershots (#310)
- **Baseline: 30/56 (54%)**. v0.8 eval running — expected ~40/56 (71%) if both buckets fixed.

## Evals In Flight (CHARLIE, ~19:45)

| Task | Eval | Writes to |
|------|------|-----------|
| b5oni21sy (PID 23132) | v0.7 prompt, MIRA_DB_PATH set, no judge | runs/2026-04-15-v0.7-honesty.md |
| baz22it6l (PID 23536) | v0.8 prompt, MIRA_DB_PATH set, no judge | runs/2026-04-15-v0.8-diagnosis-advance.md |

Check: `ls -la tests/eval/runs/2026-04-15-v0.8* && grep "Pass rate" tests/eval/runs/2026-04-15-v0.8-diagnosis-advance.md`

## Machine State

- **CHARLIE (this machine):** Active session, 2 evals running background. `feat/training-loop-v1` branch.
- **Bravo (100.86.236.11):** Ollama :11434 — generates embeddings for ingest
- **VPS (165.245.138.91):** mira-pipeline :9099 running (eval hits this). OPENWEBUI_API_KEY was stale — rotated Apr 14.
- **PLC Laptop (100.72.2.99):** PLC at 192.168.1.100 unreachable — physical check needed

## Blocked

- **Anthropic API credits exhausted** — judge fails HTTP 400. Running eval with EVAL_DISABLE_JUDGE=1. Need credits before nightly judge resumes.
- **PR #297 not merged** — needs review
- **OW manual steps** — folder org, KB uploads, memory/channels/code execution toggles — require browser UI
- **mira-sidecar OEM migration** — 398 ChromaDB chunks need moving to OW KB (script at tools/migrate_sidecar_oem_to_owui.py)
- **mira-web → pipeline cutover** — mira-chat.ts still calls sidecar :5000/rag

## Next Steps (priority order)

1. **Read v0.8 scorecard** — confirm #310+#311 fixed; if ≥40/56 merge PR #297
2. **Add Anthropic API credits** — or hard-route judge to Groq in judge.py
3. **Run `setup_owui_models.py`** on app.factorylm.com: `doppler run --project factorylm --config prd -- python3 tools/owui_tools/setup_owui_models.py`
4. **OW manual steps** — KB PDF uploads, admin toggle: Memory, Channels, Code Execution, Web Search
5. **mira-sidecar OEM migration** — run tools/migrate_sidecar_oem_to_owui.py
