# From Flight Recorder to Fault Intelligence — Discovery + Plan

**Status:** discovery + planning (2026-07-01). **No product logic changed. No UI. Not committed.**
**Wedge:** *FactoryLM/MIRA turns cryptic PLC, HMI, drive, and OEM machine faults into plain-English,
evidence-backed troubleshooting.* Not generic predictive maintenance.

> **Bottom line:** the fault-intelligence substrate mostly **already exists** — parseable manual
> fault tables, a real-conveyor code→meaning dictionary, a production `fault_codes` table + recall,
> the difference-engine bundle, decision-traces, and the review queue. The missing bridge is small:
> a **deterministic Fault Dictionary** extracted from the manuals, which then joins a fault code to
> the difference bundle. Recommend **Option A (Fault Dictionary Extractor)** as the smallest Phase 2.

---

## 1. What already exists that supports Fault Intelligence

| Concern | Exists? | Where |
|---|---|---|
| **Manual fault tables (parseable!)** | ✅ | `simlab/docs/<asset>/fault_code_table.md` (11 assets) — clean MD table: `Code \| Label \| Severity \| Description \| Likely Cause \| Recommended Action`, with backtick-referenced tags (e.g. F007 → `filler_bowl_pressure`, `tank_level_percent`, AirSystem01 header). |
| **Real-conveyor fault dictionary** | ✅ | `plc/conv_simple_anomaly/rules_core.py::GS10_FAULT_CODES` (~50 GS10 codes → meaning) + `_GS10_CRITICAL`; A2 decodes `vfd/vfd101/fault_code`. |
| **Production fault-code lookup + table** | ✅ | `docs/migrations/002_fault_codes.sql` (`fault_codes` table) + `mira-bots/shared/neon_recall.py::recall_fault_code` + `_extract_fault_codes`. |
| **OEM alarm fixtures** | ✅ | `tests/eval/fixtures/vfd_danfoss_01_vlt_fc102_alarm4.yaml`, `mira_copy/outputs/blog-posts/danfoss-earth-fault-alarm-causes.md`. |
| **Baseline-vs-current diff + event bundle** | ✅ | `demo/factory_difference_engine/pipeline.py::run_pipeline()`; `plc/conv_simple_anomaly/{difference_detectors,baseline_learner}.py`. |
| **Explanation + evidence record** | ✅ | `decision_traces`(mig 032/055), `event_context.py`, `simlab/diagnostic.assemble_evidence`, `WhyMiraThinksThis.tsx`. |
| **Human accept/reject/escalate + learning** | ✅ | ADR-0017 `proposal_transition.py`, `review-queue.tsx`, `/decide` routes, `ai_suggestions`(027), `kg_*.approval_state`. |
| **Static readout (Flight Recorder Report)** | ✅ | `demo/factory_difference_engine/flight_report.py` (+ `--html`). |
| **Sim fault signal** | ⚠️ | `fault_code` (STRING) on 8 assets; no numeric/decoded code. Data-richness audit: VFD/drive/condition tags absent. |

## 2. What should NOT be rebuilt

The GS10 dictionary (`rules_core.py`), the `fault_codes` table + `recall_fault_code`, the difference
engine + `run_pipeline` bundle, `decision_traces` / `event_context`, the review queue + ADR-0017, the
Flight Recorder Report renderer, and the SimLab manuals. Fault Intelligence **composes** these; it
adds no new store, UI, adapter, LangGraph, or Langfuse.

## 3. How the Flight Recorder Report connects to fault-code explanation

The Report already renders *what changed → why → evidence → what to check → learn*. Fault Intelligence
adds a **fault anchor** at the top of that same flow: a cryptic code becomes the entry point, and the
existing difference bundle + evidence + manual citation become its explanation. Same readout, one new
lead section ("Fault observed → what it means") — Option C is literally the Report re-centered on a fault.

## 4. How a fault code should become a Factory Difference Bundle

```
fault code (string/int, from fault_code tag or GS10 register / HMI alarm)
  → resolve in the Fault Dictionary  → {label, meaning, likely_cause, first_checks, referenced_tags, cited_source}
  → affected asset (from the tag's UNS path)
  → event window (the difference-engine machine event around the fault)
  → baseline-vs-current diff on the fault's referenced_tags (reuse difference_detectors)
  → evidence = abnormal tags + the cited fault_code_table.md row + prior approved fixes
  → MIRA explanation (deterministic templated, or --live Supervisor)
  → technician accept/reject/edit → approved fix becomes future context
```
The join key is the Fault Dictionary's `referenced_tags` ↔ the bundle's abnormal signals. That's why
the dictionary is the foundational Phase-2 piece.

## 5. How MIRA should explain a fault (inputs it already has vs needs)

Fault code ✅ · affected asset ✅ (UNS) · current tags ✅ (`live_signal_cache`/snapshot) · baseline-vs-current ✅
(difference engine) · event timeline ✅ (`group_observations`) · manual/troubleshooting evidence ✅
(`fault_code_table.md` + `recall_fault_code`) · prior human-approved fixes ⚠️ (kg/decision_traces exist; not yet
joined per-fault). Only the last needs wiring — everything else is present.

## 6. What we can prove NOW with ProveIt / Northwind

For process/state faults it is genuinely end-to-end: e.g. **F007 "Low Bowl Pressure"** →
`filler_bowl_pressure` below baseline (11.7–12.3 → 5.1) + `underfill_reject_count` rising → grouped
event → cited `fault_code_table.md` + `troubleshooting.md` → "check AirSystem01 header pressure" →
accept/reject. Deterministic, read-only, offline. Same for capper torque, casepacker jam, low air.

## 7. What is missing because the sim lacks VFD/drive/condition tags

(From `docs/discovery/proveit_2026_factory_data_richness_audit.md`: PRESENT 3 / PARTIAL 3 / ABSENT 10.)
A *drive* fault can be **named** from the manual but not **corroborated** by signals: e.g. a GS10
"ocA over-current-accel" or Danfoss "A4 mains phase loss" would reference **torque %, DC bus, output
voltage, drive temp, overload count** — all **absent** in the sim. So sim fault intelligence is strong
for **process/mechanical/controls** faults, weak for **electrical/VFD** faults. **Weak tag depth blocks
deeper diagnosis:** MIRA can cite the cause but cannot show the drive signature that confirms it.

## 8. How Mike's real conveyor VFD data becomes the gold-standard demo

The real bench already has what the sim lacks: `GS10_FAULT_CODES` (decoded), and **live torque,
frequency, current, voltage, DC bus, RPM, power** (proven readable via Micro820/Litmus, mirrored in
`plc/ignition-project/.../VFD/tags.json`). The gold-standard maintenance demo runs the *same* Fault
Intelligence loop on the real conveyor: a real GS10 fault code → decoded meaning → the live drive
signals that confirm it (DC-bus sag + current climb + torque spike) → cited GS10 manual → fix. The sim
proves the *loop*; the real conveyor proves the *depth*. Enrich the sim toward the GS10 tag shape
(audit §8) so both tell one story.

## 9. Smallest useful Phase 2 build — recommendation

**Option A — Fault Dictionary Extractor (recommended first).** Deterministic, offline, read-only; the
foundational piece B and C both need; directly serves the wedge (cryptic code → plain English).
Parse `simlab/docs/<asset>/fault_code_table.md` (and later fold in `GS10_FAULT_CODES`) into a
deterministic dictionary: `{asset, code, label, severity, meaning, likely_cause, first_checks,
cited_source, referenced_tags, confidence, missing_evidence}`. No DB, no UI, no adapter, no LLM.

- **Option B (Phase 2b):** join the dictionary INTO the difference bundle → a Fault Intelligence
  Bundle (fault + source + asset + evidence tags + baseline/current + cited manual + checks + review state).
- **Option C (Phase 2c):** a fault-centered static report — reuse `flight_report.py`, add a lead
  "Fault observed → what it means → what data is missing" section.

Do B/C only after A is proven; do not build Hub UI, live adapters, or schema now.

## 10. Exact files if Option A approved (tiny, deterministic, offline)

- **NEW** `demo/factory_difference_engine/fault_dictionary.py` — `extract_fault_dictionary(docs_dir="simlab/docs") -> list[dict]` (pure MD-table parse; also `lookup(code, asset=None)`; each entry tags `referenced_tags` from the backticked tag names and `missing_evidence` for tags not present in the sim).
- **NEW** `tests/simlab/test_fault_dictionary.py` — deterministic: parses all 11 tables; `filler01/F007` → "low bowl pressure", references `filler_bowl_pressure`, cites `fault_code_table.md`; two extractions identical; offline (no DB/cloud/LLM).
- **MODIFY (docs only)** `demo/factory_difference_engine/README.md` — one command to dump the dictionary.
- **Optional artifact** `demo/factory_difference_engine/out/fault_dictionary/fault_dictionary.{json,csv}` (generated, deterministic).
- **Reuse read-only:** `simlab/docs/*/fault_code_table.md`; `neon_recall.recall_fault_code` field shape; `GS10_FAULT_CODES` (folded in later).

## Proven vs planned (clear separation)

- **Proven now:** the difference→event→explanation→evidence→review loop for process/state faults; the
  static Flight Recorder Report; parseable manual fault tables; a real GS10 code dictionary.
- **Planned (this doc):** the Fault Dictionary extractor (A) → fault-into-bundle join (B) → fault-centered
  report (C). No code written here.

## Cross-references
- `docs/discovery/proveit_2026_factory_data_richness_audit.md` (the tag-depth limits).
- `docs/prd/factorylm_flight_recorder_black_box_prd.md`; `demo/factory_difference_engine/{README,flight_report}.md/.py`.
- `plc/conv_simple_anomaly/rules_core.py` (`GS10_FAULT_CODES`); `docs/migrations/002_fault_codes.sql`; `mira-bots/shared/neon_recall.py`.
