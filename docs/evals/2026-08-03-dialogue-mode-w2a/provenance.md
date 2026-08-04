# W2a prompt-fix eval — provenance (frozen before any paid call)

**Question:** does removing the literal *"You never give direct answers"* rule from
`mira-bots/prompts/diagnose/active.yaml` (workstream W2a, Answer Integrity PRD §2.2)
improve judged conversation quality — measured, not asserted?

**Design:** two runs over the identical frozen fixture set; the ONLY difference
between runs is the prompt file. Baseline runs FIRST, on the unmodified prompt
(owner correction 2026-08-03: "fix, then re-baseline" cannot establish causality).

**Budget (owner-authorized 2026-08-03):** $10 ceiling AND exactly 2 runs, whichever
binds first. Provider directive: Together, not Anthropic.

## Frozen inputs

| Artifact | Value |
|---|---|
| Code commit | `439c4b52c` on `feat/together-judge-eval` (= #3088 head `df96af8c1` + Together judge seam) |
| Fixture set | `mira-core/data/seed_cases.json` — 10 cases (easy/medium/hard), sha256 `c6b4cf72f6cd01c47ba1876059ec630c2d627b38584be5205f64f348d717a1b9` |
| Baseline prompt | `mira-bots/prompts/diagnose/active.yaml` sha256 `e99ca7c48dc4b7e41ba3b28899da565b227af4ea893833c4ffa39b1431601ebf` (contains the W2a rule at line 17) |
| Runner | `mira-bots/scripts/prejudged_benchmark_run.py` sha256 `bc2eecb517faf839265ccd07c8fc76b3d76917131bff652652a10020cb26ef13` |
| Judge rubric | 5-dimension, weights 0.20/0.20/0.25/0.25/0.10; dimension 3 = DIALOGUE MODE revision (text pinned offline by `tests/test_judge_dialogue_mode.py`); result key `gsd_compliance` retained for historical comparison |

## Judge + technician simulator

| Setting | Value |
|---|---|
| Provider | Together (`BENCH_JUDGE_PROVIDER=together`) |
| Model | `meta-llama/Llama-3.3-70B-Instruct-Turbo` |
| max_tokens | 200 (simulator) / 500 (judge) — unchanged from the runner |
| Timeout | 90 s |
| Note | Judge model differs from the historical Anthropic `claude-sonnet-4-6` judge, so these scores are NOT comparable to past prejudged runs — only to each other. |

## Engine environment (identical for both runs)

- MIRA replies: production free-tier cascade Groq → Cerebras → Together via Doppler
  `factorylm/stg` (staging keys; $0 metered spend).
- Retrieval: staging NeonDB (`NEON_DATABASE_URL`, 84,154 `knowledge_entries` rows at
  freeze time), hybrid BM25+vector, embeddings via local Ollama `nomic-embed-text:latest`
  (`0a109f422b47`, 768-dim).
- `MIRA_PROCESS_TIMEOUT=90` (local turns exceed the 30 s container default).
- Case state DB: local throwaway SQLite seeded by `build_case_corpus.py --seed-only`.
- Host: Windows 10, Python 3.14.2 (the only local interpreter with the dep tree;
  repo targets 3.12 — langfuse/pydantic emit benign warnings).
- MAX_TURNS=8; verdict thresholds 8.5/7.0/5.0/3.0.

## Known shared handicaps (identical in both runs; do not bias the delta)

1. **seed-001 turn-0 false refusal (pre-existing production defect, found during free
   preflight):** `CONTROL_ACTION_RE` branch 2 in `mira-bots/shared/guardrails.py`
   matches "…every time we try to **start the motor**" in the case opener — narrative
   description, not an imperative — so MIRA opens with the read-only control refusal.
   Verified byte-identical regex on `origin/main`. 1/10 fixtures affected, turn 0 only;
   conversation continues. Filed as a finding; deliberately NOT fixed in this eval
   (guardrail changes need their own both-directions tests).
2. **UNS chat-gate** consumes an early turn when the opener names no equipment —
   production behavior on chat surfaces.

## Run log

| Run | Prompt | Executed | Result |
|---|---|---|---|
| 1 (baseline) | `e99ca7c4…` (W2a rule present) | 2026-08-03, chunked per-case after two background-task kills; one interrupted attempt re-ran | composite mean 6.86 — see `results.md` |
| 2 (post-W2a) | `be605393e46e68bc6503aad09f7d558045fa2a50ced2f97a6b0d384a3cbc0b75` (v1.3) | 2026-08-03, same chunked pattern; cases 9–10 re-ran after one kill | composite mean 5.92 — delta is noise-dominated; see `results.md` |

Actual call counts, token usage, and dollar cost are reported from the adapter's
usage counters after each run — never estimated.
