# Universal VFD Manual Compiler — Benchmark Results (2026-07-14)

Closes the **0/5 generalization gap**: the exact-header dialect extractor
(`extractor.py`) recovered **nothing** on five unseen vendors; the universal
pipeline (`universal_extract.py`) recovers thousands of cited records.

## Corpus (real official manuals — NOT committed; licensed + large)

| Manual | File | Pages | sha256 (head) |
|---|---|---|---|
| Yaskawa GA500 Programming (TOEP YAIGA5002) | `yaskawa_ga500_prog.pdf` | 526 | `5f43120dcc975297` |
| ABB ACS580 firmware (3AXD50000016097 J) | `abb_acs580_fw.pdf` | 632 | `8d1b3a25cac85e7d` |
| Schneider ATV320 Programming (NVE41295) | `schneider_atv320_prog_nve41295.pdf` | 343 | `295ab838a6b5da54` |
| Siemens SINAMICS G120X op. instructions | `siemens_g120x.pdf` | 964 | `9245b0530133b523` |
| Delta VFD-E User Manual | `delta_vfd_e.pdf` | 399 | — |

> Two of the originally-downloaded manuals were the wrong (undersized) document
> — the Yaskawa GA500 *quick-start* (74pp, no fault/param tables) and the ABB
> *hardware* manual (no parameter list). Both were re-fetched to the correct
> full programming/firmware manuals before benchmarking. Verify the corpus first.

## Before → After (per manual)

Baseline = current `extractor.parse_faults` + `parse_parameters` (whole-doc).
After = `universal_extract.extract_manual`. Raw: `benchmark_summary.json`.

| Manual | Before faults/params | After status | After faults | After params | Cand. pages | Parsed pages |
|---|---|---|---|---|---|---|
| Yaskawa GA500 | 0 / 0 | PARTIAL | 30 | 1245 | 368 | 149 |
| ABB ACS580 | 0 / 0 | PARTIAL | 260 | 1641 | 419 | 214 |
| Schneider ATV320 | 0 / 0 | PARTIAL | 5 | 439 | 81 | 54 |
| Siemens G120X | 0 / 0 | PARTIAL | 423 | 876 | 503 | 340 |
| Delta VFD-E | 0 / 0 | PARTIAL | 52 | 654 | 133 | 133 |
| **TOTAL** | **0 / 0** | — | **770** | **4855** | — | — |

**5,625 cited records recovered from zero.** Status is honestly `PARTIAL`
(not `COMPLETE`) because discovery over-flags some candidate pages — TOCs,
status-bit tables, cross-reference lists — that yield no validated record, so
`parsed_pages < candidate_pages`. A zero-record run is **never** labelled a
success (was the original `EXTRACTED`-on-0/0 bug).

## Acceptance gates — measured vs gap (honest)

| Gate | Status | Evidence |
|---|---|---|
| All 5 recover real fault OR param records | ✅ **MET** | 5,625 records, all 5 manuals (table above). |
| Candidate-page recall ≥ 95% | ✅ **MET (sampled)** | 22/22 (100%) hand-verified real table pages flagged by discovery. Full-document recall not exhaustively labelled — reported on a 22-page verified sample. |
| 100% emitted records have valid page evidence | ✅ **MET** | `evidence_validator` proves every record's excerpt on its cited page via `cite_integrity`; every emitted record has `validated=True`. |
| No silent empty successes | ✅ **MET** | Status enum `COMPLETE/PARTIAL/NO_TABLES_FOUND/TABLES_FOUND_NOT_PARSED/FAILED`; unit-tested that a zero-record run is never a success. |
| Existing PowerFlex + Magnetek tests green | ✅ **MET** | `test_extract` + `test_magnetek_dialect` + `test_scorecard` = 100 passed, 1 xfailed. Dialects wrapped, not modified. |
| Deterministic extraction first, offline | ✅ **MET** | Deterministic routes run first; LLM repair off unless `MIRA_DRIVE_LLM_REPAIR=1`. Benchmark is fully offline. |
| LLM fallback region-bounded, auditable, optional, emits learning evidence | ✅ **MET** | `llm_region_repair`: one region only, source-validated, learning artifacts + deterministic-rule proposals. |
| No hallucinated codes/values/defaults/ranges/actions | ✅ **MET** | String ids source-preserved (never an invented integer for a mnemonic); every field value re-verified against the page; excerpt is a verbatim page line. |
| Sampled row **precision ≥ 98%** | ❌ **NOT MET — measured gap ~87%** | Clean-record proxy: ABB 92%, Yaskawa 91%, Siemens 91%, Delta 82%, **Schneider 46%** (outlier). Noise sources: page-footers caught as ids (`502 "YASKAWA…Programming"`), section refs (`1.2`, `4.1`), and enum-value tables (setting-value columns) mis-classified as parameters. A safe empty-name/no-field filter is applied; the remaining gap needs per-vendor precision passes. |
| Sampled row **recall ≥ 90%** | ⏳ **NOT MEASURED** | No per-page hand gold was built for the five vendors this session (only PF40/525/GS10 gold exists). `parsed_pages` coverage is a proxy, not a recall number. Building sampled row gold (~20–30 rows/manual) is the tracked follow-up. |

## What this proves / what remains

**Proves:** Drive Commander's extractor now *generalizes*. One vendor-agnostic
pipeline (document IR → table discovery → schema inference → generic parse →
evidence validation), with the PowerFlex/Magnetek dialects retained as
confidence-boosting plugins, recovers real cited fault/parameter data on five
manuals that previously returned 0/0 — without a purpose-built parser per
vendor.

**Remains (measured gaps, not hand-waves):**
1. **Precision to 98%** — filter page-footers/section-refs and separate
   enum-value tables from parameter listings (Schneider is the worst case).
2. **Row-recall gold** — hand-label ~20–30 rows/manual to *measure* recall
   (currently unmeasured).
3. **Promote recurring generic geometries into scored dialects** via the
   `llm_region_repair` learning artifacts.

## Reproduce

```bash
# manuals must be present under /Users/bravonode/drive-manuals/ (not committed)
python docs/eval/universal-vfd-compiler/benchmark.py            # all 5, before+after
python tools/drive-pack-extract/universal_extract.py MANUAL.pdf \
    --output result.json --evidence-dir evidence/
```
