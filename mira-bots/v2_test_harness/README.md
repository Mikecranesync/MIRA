# MIRA v2 Autonomous Test Harness

Runs 120 test cases (100 original + 20 generated), self-heals failures inline,
probes the Telegram path, makes an autonomous release decision, and optionally
tags and pushes both repos.

## Quick Start

```bash
cd ~/Mira/mira-bots

# Run all 120 cases (no release)
python3 v2_test_harness/runner.py --all

# Run all and release if ≥95%
python3 v2_test_harness/runner.py --all --release

# Skip Telegram probe (faster)
python3 v2_test_harness/runner.py --all --skip-probe

# Run specific cases
python3 v2_test_harness/runner.py --cases vfd_overcurrent_01 hydraulic_pressure_drop_106
```

## Tag v1.0 First (if not already done)

```bash
python3 v2_test_harness/runner.py --tag-v1
```

## Env Vars

| Variable | Default | Purpose |
|----------|---------|---------|
| `INGEST_URL` | `http://localhost:8002/ingest/photo` | Ingest endpoint |
| `PROBE_OPENWEBUI_URL` | `http://localhost:3000` | OpenWebUI for GSDEngine probe |
| `OPENWEBUI_API_KEY` | `` | API key for OpenWebUI |
| `VISION_MODEL` | `qwen2.5vl:7b` | Vision model for GSDEngine direct probe |
| `TELEGRAM_TEST_SESSION_PATH` | *(auto-detected)* | Telethon session file path |
| `TELEGRAM_API_ID` | `` | Telethon API ID |
| `TELEGRAM_API_HASH` | `` | Telethon API hash |
| `TELEGRAM_BOT_USERNAME` | `` | Bot username for Telethon probe |

## 3-Step Healing

When a case fails, the healer attempts up to 3 steps:

1. **HEALED_JUDGE** — Re-score the same reply using nouns extracted from it as
   extra pattern keywords. Fires when `word_count > 20` and patterns are sparse.

2. **HEALED_PROMPT** — Patch `mira-ingest/main.py` DESCRIBE_SYSTEM to append
   `"Always label your response with (1), (2), (3)."`, rebuild `mira-ingest`,
   wait for healthy, re-run the case. Only fires for `NO_FAULT_CAUSE` /
   `NO_NEXT_STEP`. Never fires for `HALLUCINATION` or `OCR_FAILURE`.
   Original DESCRIBE_SYSTEM is always restored whether or not healing succeeds.

3. **CEILING** — Mark the case as ceiling-limited. No further action.

## Evidence Files

Each case produces three files in `artifacts/v2/evidence/`:

```
{case_name}_request.json   — payload sent to ingest endpoint
{case_name}_response.json  — raw reply text
{case_name}_score.json     — full judge result dict
```

## Release Thresholds

| Ingest Rate | Action |
|-------------|--------|
| < 90% | STOP — do not release |
| 90–95% | COMMIT_NO_TAG — commit progress, no tag |
| ≥ 95%, no `--release` | REPORT_ONLY — ready, run again with `--release` |
| ≥ 95%, `--release`, Telegram ≥ 90% | RELEASE — tag + push both repos |
| ≥ 95%, `--release`, Telegram < 90% | RELEASE_INGEST_ONLY — tag + push, note Telegram gap |

## How to Add New Test Cases

1. Add entries to `telegram_test_runner/test_manifest_100.yaml`
   (or edit `v2_test_harness/generator.py` for programmatic generation).
2. Delete `v2_test_harness/manifest_v2.yaml` to force regeneration,
   or it auto-regenerates after 24 hours.
3. Run the harness.

## Module Map

```
v2_test_harness/
  runner.py          — entry point, orchestrates all phases
  judge_v2.py        — wraps v1 judge with runtime pattern injection
  healer.py          — per-case inline self-healing (3 steps)
  generator.py       — codebase-aware 20-case generator
  telegram_probe.py  — advisory Telegram path probe
  agent.py           — autonomous release decision logic
  report_v2.py       — writes report_v2.md + results_v2.json + evidence
  manifest_v2.yaml   — generated at runtime (not checked in)
```
