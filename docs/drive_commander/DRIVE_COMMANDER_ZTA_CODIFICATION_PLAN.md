# Drive Commander — Zero-Token Codification Plan

**2026-07-20.** Operating principle: *infer only when necessary; codify what is learned; verify it;
version it; test it; reuse it without inference whenever possible.*

Drive Commander is already the strongest zero-token story in the codebase: its answer path is **100%
deterministic** and answers **100%** of in-corpus fault/param/keypad/status cases with **no LLM**
(baseline report §3). This plan says what stays codified, what the runtime ladder is, and what remains
inference-bound.

---

## 1. The runtime ladder (cheapest tier that can answer, wins)

| Tier | Mechanism | Token cost | Where in code today |
|---|---|---|---|
| 1 | **Exact deterministic lookup** (family+code/param → cited answer) | **$0** | `answer_fault_code`, `answer_question` |
| 2 | **Normalized / alias lookup** (F007→7, GS11N→GS10 alias, nameplate-keyword) | **$0** | `resolve_pack`, `_norm` in `ask.py` |
| 3 | **Rule / table execution** (status-bit & command-word decode, envelope compare) | **$0** | `live_snapshot.py`, `pack.live_decode` |
| 4 | **Approved cached answer** (a promoted, human-signed pack entry) | **$0** | pack JSON = the cache |
| 5 | **Cheap synthesis over verified evidence** (compose prose from pack facts) | low | `answer_composer.compose_answer(llm=None)` = deterministic; optional cheap LLM |
| 6 | **Vision model for NEW image evidence** (read a photo → OCR/nameplate) | metered | `VisionWorker`, `NameplateWorker` |
| 7 | **Stronger fallback model** (RAG auto-diagnose when the pack misses) | metered | engine RAG path |
| 8 | **Human review** (a miss becomes a gap → candidate → promoted pack) | human | gap flywheel + `drain_build_requests` |

**Promotion rule:** every successful higher-tier answer is *eligible* to be codified down. Today's
flywheel already does the tier-7→tier-8→tier-1 loop: a drive-pack **miss** is logged, ranked by
`gap_report.py`, raised as a review item, and (on human accept) re-extracted into a staged pack —
which, once promoted, answers at tier 1 forever after. **The one missing automation is tier-6→tier-1
for *newly-read displays*** (a vision-read fault that isn't yet in the pack): today it falls to RAG
(tier 7) and is only codified if it recurs as a gap. Closing that = capture the vision-read code +
family, and if the manual documents it, auto-stage a candidate entry.

---

## 2. What is already permanently codified (durable, no LLM to reproduce)

| Artifact | Form | Provenance | Regression test |
|---|---|---|---|
| Fault-code → meaning (GS10 10, PF40 26, PF525 48) | `pack.json` `live_decode.fault_codes` | hash-pinned public manuals (Rev B/J/O) | `test_drive_pack_truth_pins.py` |
| GS10 causes / first-checks (9 codes) | `drive_fault_intel.py` constant | `manual_cited` | `test_drive_pack_cards.py` |
| Parameters (GS10 8, PF40 9, PF525 45) w/ units, ranges, `value_meanings` | `pack.json` `parameters` | inline `source_citation` | `test_drive_packs_schema_v2.py` |
| GS10 keypad navigation (4 cards) | `pack.json` `keypad_navigation` | cited, view-only-warned | `test_drive_packs_gs10_v2_fixture.py` |
| GS10 status-word / command-word / register maps | `pack.json` `live_decode` | `bench_verified` | `test_drive_packs.py` (anti-drift vs `live_snapshot`) |
| Family resolution (aliases + nameplate keywords) | `pack.json` `family`/`nameplate` | — | `test_drive_pack_nameplate.py` |
| Read-only guarantee | AST gate | — | `test_drive_packs_readonly.py` |
| **Lane A benchmark** (this pass) | frozen corpus + deterministic grader | seeded from truth-pins | `tools/drive_commander_bench/test_bench.py` |

## 3. What can be additionally exported (per supported family) — the offline technician package

All of this is a pure reshape of existing pack JSON — **no new inference**:

- ✅ **Validated fault-code database** — already the `pack.json`; export a flat `faults.csv`/SQLite.
- ✅ **Parameter database** — `parameters` → `params.csv`/SQLite.
- ✅ **Keypad-navigation tables** — GS10 has them; PF40/525 do not (data gap, not code gap).
- ✅ **Status-word / command-word maps** — GS10 only (bench data).
- ⚠️ **Terminal / wiring references** — **not in the schema** today (would need a new `wiring` block +
  extractor support); PF525 surfaces verbatim manual ATTENTION notes only.
- ✅ **Safe troubleshooting decision trees** — derivable from fault→causes→checks (GS10); a small
  `decision_tree.json` per family.
- ✅ **Executable lookup rules / CLI / service** — `runner.py` + `answer_fault_code` already are one;
  the `/drive-pack/ask` endpoint is the service.
- ✅ **Local SQLite bundle / offline package** — a `drivepack_export.py` (proposed) that emits
  `<family>.sqlite` + `faults.csv` + `params.csv` + `provenance.json` + source hashes + the Lane-A
  corpus, runnable air-gapped. **This is the recommended new codification tool.**
- ✅ **Source hashes & provenance** — already pinned in each pack's `provenance.verification`.
- ✅ **Automated regression tests** — the truth-pins + Lane-A harness.

**The objective is met for GS10/PF40/PF525 fault+param answers today:** a technician question about a
supported drive is answered from durable, cited, versioned artifacts with no repeated LLM call. The
gaps are *data* (PF40/525 have no keypad/status data) and *reach* (mnemonic-coded families, D1).

## 4. What is honestly still inference-bound (and should stay behind the router + flags)

- **Reading a photo** (tier 6): OCR + nameplate extraction of a *new* image is genuinely a
  vision-model job. The deterministic Tesseract floor covers clean displays; difficult displays need
  the model lane. This is the one place a paid model earns its keep.
- **Off-corpus questions** (tier 7): a question about a drive/param not in any pack falls to RAG. The
  right response is a gap→codify loop, not a permanent LLM dependency.
- **Free-form synthesis** (tier 5): optional and already has a deterministic fallback
  (`compose_answer(llm=None)`).

## 5. Optional paid benchmark plan (Phase 9 — **NOT run; design only**)

Do not run without a fresh, explicit dollar ceiling. A single diagnostic run answering one question:

| Field | Value |
|---|---|
| **Question** | *Does the vision pre-stage accurately read difficult GS10/PowerFlex fault displays (Lane B-model), and does that change the Lane-C answer vs the deterministic Tesseract floor?* |
| **Models** | current cascade (Groq→Cerebras→Together) vision + the qualified MiniMax-M3 (behind the existing router/flags — no side path) |
| **Cases** | ≤ 12 (synthetic + public keypad renders, clearly labeled; **no customer photos**) |
| **Expected cost** | ≈ $0.30 ceiling (≈ $0.02–0.03/case incl. OCR) |
| **Stop guard** | in-script per-case ceiling (the `run_bench` pattern) |
| **Success threshold** | ≥ 90% exact code read on clear displays; honest "unreadable" on the truly illegible; **zero** fabricated codes |
| **Baseline** | the deterministic Tesseract floor (Lane B-det, $0) |

**Fine-tuning is NOT recommended** until the deterministic (D1), citation (D3), and OCR-cost (D6)
defects are separated from any genuine model limitation — tonight's Lane-A result shows the *pack +
software* layer is not the bottleneck, so a fine-tune would train on a fixable integration gap.

## 6. Recommended codification sequence

1. **Fix D1/D2** (consume `fault_entries` + gate allowed-keys) — unlocks mnemonic-coded families at
   tier 1, `$0`, zero current-production impact. *This is the single highest-value action.*
2. **Fix D3** (per-fault citation for non-GS10 packs) — precision, `$0`.
3. **Build `drivepack_export.py`** (§3) — the offline SQLite/CSV technician package, `$0`.
4. **Extend the harness to a mocked-worker Lane C** (§ baseline) — `$0`.
5. Only then, if Mike funds it, the one ≤$0.30 Lane-B-model diagnostic (§5).
