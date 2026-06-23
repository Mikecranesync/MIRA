# Session 009 — ProveIt Conv_Simple demo spine (evidence → card → MQTT)

**Date:** 2026-06-23
**Recorder:** Discovery Recorder (ProveIt demo track)
**Class of work:** real-asset demo build (evidence folder → answer card → narrow MQTT/UNS path)

> Real Conv_Simple bench assets only. No invented equipment / part numbers. No Ignition / OPC-UA /
> OpenPLC / Modbus expansion. Deterministic.

## 1. Question

Can a ProveIt viewer see the real demo equipment, its supporting documents, a fault scenario, MIRA's
evidence-backed answer, and a clean UNS MQTT event — end to end, deterministically?

## 2. Files inspected

- `plc/GS10_Integration_Guide.md`, `plc/MbSrvConf_ConvSimple_v1.9.xml`, `plc/conv_simple_anomaly/`
  (A12 photo-eye jam, `di05_photoeye` on DI_05), `plc/CCW_VARIABLES_ConvSimple_v2.1_DELTA.md`.
- `mqtt_uns/broker.py` (reused transport).

## 3. Assumptions tested

| # | Assumption | Result |
|---|---|---|
| A1 | The demo is the Cappy MES factory. | **FAILED** → the example folders (conveyor/photoeye/vfd/motor/plc) = the **Conv_Simple bench**. |
| A2 | The deployed Modbus map is `MbSrvConf_ConvSimple_v2.1.xml`. | **FAILED** (test caught it) → the real file is `MbSrvConf_ConvSimple_v1.9.xml` (v2.1 reuses it). Fixed; no invented path. |
| A3 | The photoeye/motor have known models. | **CONFIRMED UNKNOWN** → tag/role recorded (PE-101 / DI_05; 3-phase 4-pole) but no catalog number → flagged `UNKNOWN_MODEL`, not fabricated. |
| A4 | A standalone card is needed. | **REFINED** → reused the `mqtt_uns.broker` transport; the card cites the evidence manifest as real receipts. |

## 4. Decisions

- Built `demo/` self-contained: `evidence/` (6 asset folders + README + `evidence_manifest.json`),
  `conv_simple_demo.py` (assets + UNS + flagship scenario + answer card), `mqtt_demo.py` (broker reuse),
  `run_demo.py` (one-command gate), `tests/`.
- Flagship = photoeye blocked → conveyor stopped (anomaly A12). Evidence-against = GS10 no fault (rules
  out the VFD), grounding the photoeye conclusion.
- Manuals = REAL manifest entries only; every cited receipt is verified to exist (URL or repo path).

## 5. Reusable findings / risks

- The honesty test (`test_every_evidence_item_points_at_a_real_asset_and_source`) caught a stale file
  reference — keep that test; it prevents inventing evidence. Risk: referencing a versioned bench file by
  the wrong version → assert local paths exist.
- The same `mqtt_uns.broker` carries the demo event (one nervous-system path, not a new transport).

## 6. Validation

`python demo/run_demo.py` → DEMO: OK (5 real assets, 8 receipts, MQTT card preserved, 17 tests). ruff clean.
Reports: `demo/reports/answer_card.{md,json}` + `mqtt_report.md`.

## 7. Tests / fixtures

`demo/tests/{test_evidence,test_answer_card,test_mqtt_demo}.py` (17). No new fixtures; real bench files +
synthetic-but-labeled history. No licensed data; no invented part numbers.
