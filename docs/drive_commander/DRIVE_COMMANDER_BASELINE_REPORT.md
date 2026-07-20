# Drive Commander — Baseline Report

**Run:** 2026-07-20 against `origin/main` (`5fa32cb8`, v3.178.1), fully offline, **$0**.
Interpreter: `.venv-flmai` (+fastapi/pydantic-core/starlette) under `PYTHONUTF8=1` (mirrors CI/Linux).

---

## 1. Exact commands + results

| Scope | Command | Result |
|---|---|---|
| Existing drive-pack suite | `PYTHONUTF8=1 pytest <14 explicit drive-pack test files>` (from `mira-bots/`) | **137 passed** |
| — without UTF-8 | same, Windows default cp1252 | 135 passed, **2 failed** (encoding artifact, see D5) |
| Lane A benchmark | `PYTHONUTF8=1 python tools/drive_commander_bench/runner.py` | **16/16 PASS, grade A, 0 hard-gate failures** |
| Lane A self-tests | `pytest tools/drive_commander_bench/test_bench.py` | **7 passed** (grader teeth + frozen corpus) |
| Lane F (zero-token) | (reported by the runner) | **100%** — 12/12 answerable cases via tier-1 exact lookup, $0 |

**Test-file list** (all under `mira-bots/tests/`): `test_drive_packs`, `_fault_entries`, `_schema_v2`,
`_gs10_v2_fixture`, `_readonly`, `_truth_pins`, `drive_pack_ask`, `_cards`, `_nameplate`,
`ask_api_drive_pack`, `engine_drive_pack_fastpath`, `drive_pack_photo_fault_bridge`,
`engine_photo_fault_bridge`, `drive_pack_hub_copy_sync`.
**Harness note:** run drive-pack tests as an **explicit file list**, not `-k` over `tests/` — 17
sibling test files fail collection on missing bot deps (telegram/slack), unrelated to Drive Commander.

## 2. Baseline by lane

| Lane | Status | Score | Notes |
|---|---|---|---|
| **A** deterministic pack lookup | **RUN** | **A (16/16, 0 gates)** | GS10/PF40/PF525 faults+params+family-resolve+adversarial declines. Production-quality. |
| **B** OCR/family recognition | **partially run** | det-half green | `extract_pack_fault_codes` negative gate proven by `test_drive_pack_photo_fault_bridge.py`; the **model** OCR half is metered (not run, $0 rule). |
| **C** full photo→answer | **hermetic path proven** | — | `test_engine_photo_fault_bridge.py` drives real `process_full` with a fake vision worker (dispatch_kind=drive_pack, safety-wins, no-code→RAG). Live path metered (not run). |
| **D** adversarial | **partially run** | green subset | nonexistent code, fabrication-probe (30006), nonexistent param, unsupported family — all correctly decline in Lane A. Image-adversarial (blur/rotate/injection) needs the metered vision stage. |
| **E** technician Q&A | **not run as a lane** | — | seams exist (`answer_question` honest-decline, provenance); needs a Q&A corpus (follow-up). |
| **F** zero-token | **RUN** | **100%** | every in-corpus fault/param/keypad/status answer is tier-1 exact lookup, no LLM. |

## 3. Zero-token percentage (the headline ZTA number)

**100% of in-corpus deterministic cases are answered with no general-purpose LLM.** The entire pack
answer path is deterministic; a model is used only to *read a photo* (Lane B/C pre-stage), never to
compose the answer. See `DRIVE_COMMANDER_ZTA_CODIFICATION_PLAN.md` for the runtime ladder.

## 4. Defects, grouped by root cause (proven, this pass)

| # | Defect | Class | Severity | Evidence |
|---|---|---|---|---|
| **D1** | **Mnemonic-only fault codes unreachable.** v3 `fault_entries` (string-keyed, case-sensitive, per-fault citation) is parsed by the loader but consumed by **zero** answer/card code (`fault_entries` = 0 occurrences in `ask.py`/`cards.py`/`resolver.py`). A v3-only pack answers nothing. | **schema-consumption** | **HIGH** (blocks all mnemonic-coded crane VFDs, e.g. Magnetek) | recon + grep |
| **D2** | **v3 packs can't be promoted anyway.** The read-only gate's `_ALLOWED_TOP_LEVEL_PACK_KEYS` (`test_drive_packs_readonly.py`) does not include `fault_entries`, so a v3 pack in `packs/` fails CI. | **gate/deployment** | HIGH (couples with D1) | recon (verify the exact set before the PR) |
| **D3** | **Citation imprecision for non-GS10 packs.** `build_cards` staples the entire `provenance.sources` list onto **every** fault card unless a `TemplateReader` is injected → a PF525 fault answer cites **all 48** sources, not the one for that fault (`_pack_level_citations` returns all sources; cards.py). Borders hard-gate #3. | **citation** | MEDIUM | verified (48 cites/case in Lane A) |
| **D4** | **Case flattening.** `answer_fault_code` upper-cases both sides (`ask.py`) → `oC`≡`OC`, contradicting v3's case-sensitive intent. Latent until D1 is fixed and a case-distinct pack ships. | **schema-consumption** | LOW (latent) | recon |
| **D5** | **Truth-pins test reads JSON without `encoding="utf-8"`** (`test_drive_pack_truth_pins.py:17`), so it fails on Windows cp1252. **The loader is correct** (`loader.py:282` uses UTF-8) — this is test-only, not a production/desktop defect. | **test-hygiene** | LOW | this pass |
| **D6** | **OCR-model-lane cost not logged** (`vision_worker.py:592` discards usage) — a Lane-B-model benchmark would under-count cost. | **observability** | LOW | recon |

**D1+D2+D3+D4 share one root:** the reachable v2 answer path has no per-fault, case-sensitive,
mnemonic-capable fault record — the v3 `FaultEntry` was built for exactly this but is never consumed.
**One backward-compatible fix (consume `fault_entries` in `ask.py`/`cards.py` + add it to the gate's
allowed keys) resolves all four, with ZERO current-production impact** (all live packs are v2). This
is the single highest-value defect fix and directly closes the mission's flagged mnemonic-code risk.

## 5. Coverage by family (what the baseline actually exercises)

- **GS10** — fault (numeric + mnemonic), parameter, keypad, status/command word, live decode; richest.
- **PF40 / PF525** — fault + parameter only (no keypad/status/cmd/registers/live-decode data).
- **Mnemonic-keyed (Magnetek)** — NOT exercised at runtime (D1); its schema+loader tested in
  `test_drive_packs_fault_entries.py` (77 codes) but the answer path can't reach it.

## 6. Missing fixtures / corpus gaps

- No **v3 pack fixture** in the runtime `packs/` tree (only the candidate under `tools/`).
- No **synthetic keypad images** for Lane B/D image-robustness (needs generation, clearly labeled).
- No **Lane E Q&A corpus** yet (realistic technician phrasings).
- PF40/PF525 have **no keypad/status** data to benchmark those capabilities.

## 7. Production-readiness verdict

- **Deterministic pack lookup (Lane A): PRODUCTION-READY** for GS10/PF40/PF525 fault + parameter
  answers — 16/16, honest declines, cited, 100% zero-token, read-only enforced. This is a dependable,
  inexpensive, technician-safe core for the three supported families.
- **Mnemonic-coded drives (crane VFDs): NOT READY** — the capability is built at the schema/test layer
  but unreachable (D1/D2). This is the gap between "we have a Magnetek pack" and "MIRA can answer a
  Magnetek `oC` fault."
- **Photo→answer (Lanes B/C live): UNMEASURED here** (metered) — the deterministic bridge and the
  hermetic path are proven; the model OCR/vision quality needs a budgeted Lane-B/C run (see the
  paid-plan section of the ZTA plan).
- **Citation precision (D3): a real quality gap** for PF40/PF525 answers, worth fixing alongside D1.

**Money spent: $0.**
