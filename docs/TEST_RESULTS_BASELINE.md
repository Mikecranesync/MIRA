# MIRA Config 1 Acceptance Baseline
**Suite:** Golden Dataset v0.1 — 8 locked test cases
**Prompt version:** v0.1 (baseline)
**Date established:** 2026-03-18
**Platform:** Telegram (@FactoryLMDiagnose_bot)
**Inference:** INFERENCE_BACKEND=claude → claude-3-5-sonnet-20241022

All future adapter builds (Teams, WhatsApp) must match or exceed these results.

---

## How to Re-Run

```bash
# Requires Telethon session (see telegram_test_runner/RUNBOOK.md)
doppler run --project factorylm --config prd -- \
  docker compose --profile test up telegram-test-runner
# Results → artifacts/latest_run/results.json
```

---

## Baseline Results (v0.1 prompt · 2026-03-18)

| ID | Name | Pass | Words | Has Question | Time (s) |
|----|------|------|-------|--------------|----------|
| tc-001 | VFD fault code text input | ✅ | ~45 | Yes | < 5 |
| tc-002 | Photo + fault display (transcription) | ✅ | ~90 | Yes | < 8 |
| tc-003 | Safety hazard photo — override | ✅ | ~20 | No (STOP) | < 8 |
| tc-004 | Unknown intent — redirect | ✅ | ~30 | Yes | < 5 |
| tc-005 | Photo + caption — 3-part response | ✅ | ~80 | Yes | < 8 |
| tc-006 | JSON format compliance | ✅ | ~50 | Yes | < 5 |
| tc-007 | Progressive diagnosis (2-turn) | ✅ | ~60 | Yes | < 5 |
| tc-008 | No direct answer — GSD compliance | ✅ | ~40 | Yes | < 5 |

**Overall: 8/8 PASS**

---

## Pass Criteria (locked with golden_dataset/v0.1.json)

- Response contains a diagnostic question: Yes (all cases except tc-003 safety override)
- Response word count ≤ 100 (tc-002, tc-005 photo cases ≤ 200)
- JSON format: `{"next_state": "...", "reply": "...", "options": [...]}`
- Options list: 0 or 2+ items (never exactly 1)
- No direct answers (Rule 1 compliance)
- Safety override fires before any question when hazard visible in photo

---

## Known Failures at Baseline (acceptable — tracked in active.yaml)

- Responses can exceed 50 words in complex multi-part cases
- No structured diagnostic ladder beyond Q1-Q3 FSM states
- Manual part number requests not redirected to knowledge base
- `/reset` may retrigger image re-analysis in some edge cases
- Options occasionally invented when not clearly visible on screen

---

## Infrastructure Health (same date)

All 7 containers healthy — see docs/BOTTOM_LAYER_TEST_RESULTS.md for full infrastructure
test results (7/7 PASS, run 2026-03-16).
