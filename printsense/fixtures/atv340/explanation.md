# ATV340 verified truth-set (defect list) — the calibration ground truth

**truth_status: `frozen_human_confirmed`** (2026-07-14) — verified against the hash-verified
Schneider **NVE97896-02 sheet 1/2** drawing AND the official Schneider **Installation Manual
NVE61069.06** (see `evidence_manifest.json`), then **frozen by Mike after primary-source review**
(PRD §10.7). This truth now blocks CI (`test_atv340_frozen_verdict` is enforced).

> **⚠️ D1 REVERSED after primary-source verification (2026-07-14).** An earlier draft claimed
> "RS422 belongs to CN4 and RS422-on-CN3 is a defect." The official Installation Manual
> (**NVE61069.06 p.132**, "Top Side CN3 Connector" table) states CN3/ENC legitimately supports a
> **"Digital encoder 5V RS422 A/B/I"** — RS422 is Schneider's shared differential standard across
> CN3/CN4/CN5, not CN4-exclusive. The `incorrect_connector_ownership` blocker was **removed**,
> along with the redundant `variant_crossover` and the non-defect `dangling_reference`.

This is the *ground truth* for the defective `graph.json`. Each row is a P0 error the structured
graph asserted, the correct reading, and the deterministic gate that catches it.

## Confirmed defects (the five retained blockers)

| # | Graph asserted (WRONG) | Correct reading | Gate |
|---|---|---|---|
| 1 | Digital outputs `DO1` / `DO2` (terminals `CN6:DO1` / `CN6:DO2`) | **CN6 is labeled `DQCOM`, `DQ1`, `DQ2`** | `exact_label_mismatch` + `confident_misread` |
| 2 | One braking path `[CN9:PA/+, CN9:PC/-, CN10:PB, CN10:PBe, resistor]` mixing DC-bus terminals into the brake loop | **`PC/-` is a DC-bus terminal and is NOT part of either valid brake-resistor circuit.** S1&S2 brake = `CN10:PBe ↔ CN10:PB`; S3 brake = `CN9:PA/+ ↔ CN8:PB` | `incompatible_functional_path` |
| 3 | Unqualified duplicate ids `M`, `CN9:PA/+`, `CN9:PC/-` | **These represent the SAME terminal and require DE-DUPLICATION** (not variant-qualification — see frame note) | `duplicate_identifier` |
| 4 | Footer `1/2` modeled as off-page reference `2/2` | a page count is metadata, not an electrical off-page ref | `off_page_from_pagination` |

## Frame-qualification — the precise scope (corrected)

- **Frame qualification applies to the `PB` terminal location: `CN10` for S1/S2 versus `CN8` for
  S3.** On S1&S2 the brake terminals PBe/PB sit on **CN10**; on S3 the brake terminal PB sits on
  **CN8** (CN10 is motor-only U/T1…). That is the genuine per-frame difference.
- **`CN9` is NOT the frame-varying connector.** `CN9:PA/+` and `CN9:PC/-` are the DC-bus ±
  terminals on **both** S1/S2 and S3 (identical role). The graph's duplicate `CN9:PA/+` /
  `CN9:PC/-` therefore represents the **same terminal** and must be **de-duplicated**, not
  frame-qualified.

## NOT defects (verified against the primary sources — do not gate)

- **`RS422` on `CN3` / ENC** — **CN3 legitimately supports RS422 encoder signaling**
  ("Digital encoder 5V RS422 A/B/I", Installation Manual NVE61069.06 p.132). Not a defect.
- **`+AI2` / `-AI2`** — the graph wrote `AI2+` / `AI2-` (a sign/order variant of the SAME
  terminal). Not a defect. (The old LLM-judge "hallucination" flag is a judge error fixed in PR4 §10.6.)
- **`CN3` reference** — `CN3` is a real connector the graph references, not a dangling defect.
  `require_refs_resolve` is `false` for this case (a generic reference-resolution check may run
  elsewhere as a NON-gating structural diagnostic).

## Genuinely-uncertain items (the graph honestly flagged these `unresolved` — not penalized)

- S3 power block `CN8` / `CN9` layout is physically cramped on the sheet.
- The repeated `DISUP` digital-input-supply terminal count.
- The `CN7` Modbus marking `VP12S`.

## Expected deterministic verdict

`quality_tier = USEFUL_DRAFT` · `import_verdict = FAIL` · `bot_importable = false`, on the **five**
confirmed import-blockers: `exact_label_mismatch`, `confident_misread`, `duplicate_identifier`,
`off_page_from_pagination`, `incompatible_functional_path`. The **score emerges** from the rubric
weights (`benchmarks/atv340_vfd/rubric.json`) + the honesty penalty — it is **not hardcoded**; the
benchmark test pins the USEFUL_DRAFT band `60 ≤ score < 75`. The reduced blocker set **independently
preserves the FAIL verdict**.

## Frozen (2026-07-14)

Rows above confirmed against the rendered page + the Installation Manual and frozen by Mike.
`"truth_status": "frozen_human_confirmed"` is set in `printsense/benchmarks/atv340_vfd/rubric.json`,
so `test_atv340_frozen_verdict` is now an **enforced CI gate** (no longer skipped).
