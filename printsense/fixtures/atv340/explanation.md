# ATV340 verified truth-set (defect list) — the calibration ground truth

**truth_status: `draft_llm_authored`** — verified against the rendered Schneider NVE97896-02
sheet 1/2 (durable spec `docs/plans/2026-07-13-print-eval-gold-standard.md` §3 + the professor
review). **Awaiting Mike's review-and-freeze** to `frozen_human_confirmed` (PRD §10.7). Only
frozen truth blocks CI.

This is the *ground truth* for the defective `graph.json`. Each row is a P0 error the structured
graph asserted, the correct reading from the print, and the deterministic gate that catches it.

## Verified defects

| # | Graph asserted (WRONG) | Correct reading (print) | Gate |
|---|---|---|---|
| 1 | Digital outputs `DO1` / `DO2` (terminals `CN6:DO1` / `CN6:DO2`) | **`DQ1` / `DQ2`** (`DQCOM` is correct) | `exact_label_mismatch` + `confident_misread` |
| 2 | `RS422` on **`CN3`** (the encoder connector) | `RS422` belongs to **`CN4` / PTO** → remote ATV340 PTI; `CN3` is the `1Vpp A/B/I` encoder | `incorrect_connector_ownership` |
| 2b | RS422 link connects to bare `CN3` (defined by no entity) | `CN3` must resolve to a defined connector entity | `dangling_reference` |
| 3 | One braking path `[CN9:PA/+, CN9:PC/-, CN10:PB, CN10:PBe, resistor]` | S1&S2 brake = `CN10:PBe` ↔ `CN10:PB`; S3 = `CN9:PA/+` ↔ `CN8:PB`; **`PC/-` is DC-bus, in neither** | `incompatible_functional_path` |
| 3b | Same path conflates S1&S2 with dc-bus / S3 terminals | keep per-variant braking distinct | `variant_crossover` |
| 4 | Unqualified duplicate ids `M`, `CN9:PA/+`, `CN9:PC/-` (S1/S2 vs S3) | variant-qualified: `S1S2:M`/`S3:M`, `S1S2:CN9:PA/+`/`S3:CN9:PA/+`, … | `duplicate_identifier` |
| 5 | Footer `1/2` modeled as off-page reference `2/2` | a page count is metadata, not an electrical off-page ref | `off_page_from_pagination` |

## NOT a defect (do not gate)

- **`+AI2` / `-AI2`** — the graph wrote `AI2+` / `AI2-` (ordering nit; the terminals are correct).
  The LLM judge falsely flagged this as a hallucination. That is a **judge** error fixed in PR4
  (§10.6), **not** a graph defect — no gate fires on it here, by design.

## Genuinely-uncertain items (the graph honestly flagged these `unresolved` — not penalized)

- S3 power block `CN8` / `CN9` grouping (PB, PA/+, PC/-) is physically cramped on the sheet.
- The repeated `DISUP` digital-input-supply terminal count.
- The `CN7` Modbus marking `VP12S`.

## Expected deterministic verdict

`quality_tier = USEFUL_DRAFT` · `import_verdict = FAIL` · `bot_importable = false` · `score = 74/100`
— it **emerges** from the rubric weights (`benchmarks/atv340_vfd/rubric.json`) + the honesty
penalty, it is **not hardcoded**. The tag accuracy is decent (74); the *structure* is unsafe
(FAIL). That gap between the two axes is the whole point.

## To freeze (Mike)

Confirm the defect rows above against the rendered page, then set
`"truth_status": "frozen_human_confirmed"` in `printsense/benchmarks/atv340_vfd/rubric.json`.
That flips `test_atv340_frozen_verdict` from *skipped* to an **enforced CI gate**.
