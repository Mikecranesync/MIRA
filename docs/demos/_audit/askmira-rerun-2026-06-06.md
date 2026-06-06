# AskMira Re-Test — 2026-06-06

**STATUS:** TEMPLATE (not yet run — Gate 3 deploy pending Mike's hands).

**Re-test instrument:** Microsoft Webwright (Phase 0 install pending) driving Chromium against `http://100.72.2.99:8088/data/perspective/client/ConvSimpleLive/AskMira`.

**Plant state at test time** (Mike to confirm before re-test):
- E-STOP: `_____` (ARMED expected)
- MLC (Main Line Contactor): `_____` (OPEN expected)
- VFD comm: `_____` (LOST expected — COMM X active fault)
- VFD fault code: `_____` (14 expected)
- PE-01 (photo eye): `_____`
- Motor: `_____` (STOPPED expected)

**Pre-test smoke** (from `docs/demos/_audit/askmira-deploy-session-2026-06-06.md`):
- Backend `/ask`: GREEN — 39 s, single-vendor citations.
- View deployed: PENDING.

## Run Method

Mike's prior 2026-06-01 reports captured 10 questions. **Use the same exact wording for parity.** Source the 10 questions from your prior `/garage-conveyor` Telegram or chat transcript; this template doesn't reproduce them because they aren't checked into the repo.

For each question, capture:
1. Question text
2. Latency (seconds)
3. Full answer text
4. R1-R6 verdict (per the table below)
5. Screenshot of the AskMira view if Webwright captures it

## Per-Question Log

### Q1: `<paste question 1>`

- Latency: `___ s`
- Answer: `<paste>`
- R1 (no CoT leak): PASS / FAIL — `<note>`
- R2 (single vendor citations): PASS / FAIL — `<note>`
- R3 (no fault tunnel-vision): PASS / FAIL / N/A — `<note>`
- R4 (E-stop awareness): PASS / FAIL / N/A — `<note>`
- R5 (latency target < 15 s): PASS / FAIL
- R6 (sources present): PASS / FAIL

### Q2: `<paste question 2>`

(repeat block)

### Q3–Q10

(repeat blocks)

## Summary Table

| Q# | R1 CoT | R2 Vendor | R3 Tunnel | R4 E-stop | R5 < 15 s | R6 Sources | Net |
|---:|:---:|:---:|:---:|:---:|:---:|:---:|:---|
| 1 | | | | | | | |
| 2 | | | | | | | |
| 3 | | | | | | | |
| 4 | | | | | | | |
| 5 | | | | | | | |
| 6 | | | | | | | |
| 7 | | | | | | | |
| 8 | | | | | | | |
| 9 | | | | | | | |
| 10 | | | | | | | |

**Median latency:** `___ s` (R5 target: < 15 s)
**Per-signal pass rate:**
- R1: `__/10`
- R2: `__/10`
- R3: `__/10` (only counts non-status questions)
- R4: `__/10` (only counts E-stop-relevant)
- R5: `__/10`
- R6: `__/10`

**Verdict:** PASS (≥9/10 across R1, R2, R6 + median < 15 s) / FAIL / PARTIAL

## Comparison to 2026-06-01 baseline

| Symptom | 2026-06-01 (sidecar/llama3) | 2026-06-06 (ask_api/cascade) | Delta |
|---|---|---|---|
| Chain-of-thought leak | every reply | `_____` | |
| Multi-vendor citations | PowerFlex + ABB + Yaskawa | `_____` | |
| Fault tunnel-vision | every question | `_____` | |
| Latency | 20–30 s | `_____` | |
| Sources panel | empty | `_____` | |

## Demo Readiness Verdict

`<one line>` — proceed with demo / fix specific gaps / fall back to prior recording.
