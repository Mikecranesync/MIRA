# PLAN — Universal VFD Manual Compiler (`tools/drive-pack-extract`)

Branch: `feat/universal-vfd-manual-compiler` (off `origin/main`)
Worktree: `.claude/worktrees/universal-vfd-compiler`
PR only. **Do not merge.**

## Goal
Replace exact-header gating as the *primary* extraction architecture with a
universal pipeline: document IR → table discovery → schema inference → generic
row parsing → evidence validation → bounded LLM region-repair fallback.
Existing PowerFlex/Magnetek parsers become *scored dialect plugins* that
optimize known layouts but never gate discoverability.

## In-scope (numbered)
1. `document_ir.py` — one-pass pdfplumber normalization (pages, words+bbox, lines, rects, text, OCR status).
2. `table_discovery.py` — vendor-agnostic fault/param table candidate detection (vocab, id patterns, column alignment, whitespace channels, rules, density, repeated headers, multi-page continuation). Exact phrases may *raise confidence*, never *gate*.
3. `schema_inference.py` — map arbitrary headers/columns → canonical fault/param roles (synonym dictionaries).
4. `generic_table_parser.py` — wrapped/merged rows, ruled+unruled, identifier casing preserved, numeric/mnemonic/dotted/mixed ids, repeated headers, cross-page continuation.
5. `dialect_registry.py` — PowerFlex + Magnetek logic as scored plugins.
6. `evidence_validator.py` — every record retains page, bbox, verbatim excerpt, route, confidence, field-level evidence; reuse cite-integrity; reject unverifiable.
7. `llm_region_repair.py` — region-bounded, strict-JSON, source-validated, offline-by-default, emits learning artifacts + deterministic-rule proposals.
8. `universal_extract.py` + CLI — `python universal_extract.py MANUAL.pdf --output result.json --evidence-dir evidence/`.

Canonical output: `faults[]` (string `fault_id`), `parameters[]` (string `parameter_id`), document identity+provenance, extraction status + coverage report, rejected candidates + reasons, field-level citations + confidence. Legacy integer `fault_codes` map kept ONLY as derived compat field; never invent an integer for a mnemonic code.

Harness statuses corrected to: `COMPLETE | PARTIAL | NO_TABLES_FOUND | TABLES_FOUND_NOT_PARSED | FAILED`. A zero-record run may NOT be `EXTRACTED`.

Benchmark against: existing PowerFlex 40/520/525 + Magnetek fixtures **plus** real Yaskawa GA500, ABB ACS580-07, Schneider ATV320, Siemens G120(X), Delta VFD-E. Analyze all five together (no first-vendor overfit).

## Acceptance gates (measure + report each)
- All 5 unseen manuals recover real fault OR param records.
- Candidate-page recall >=95% vs verified table pages.
- Sampled row precision >=98%; sampled row recall >=90%.
- 100% emitted records have valid page evidence.
- No silent empty successes.
- Existing PowerFlex + Magnetek tests remain green.
- Deterministic extraction runs first, offline.
- LLM fallback region-bounded, auditable, optional, emits learning evidence.
- No hallucinated codes/values/defaults/ranges/corrective-actions.
- Before/after counts per manual + raw benchmark artifacts preserved.

## OUT-of-scope (do NOT touch)
- `mira-bots/shared/drive_packs/` runtime code (read schema only, never write packs there).
- Any fieldbus/PLC/socket code. Read-only, offline.
- Merging the PR. Deploys. Prod. Non-drive-pack modules.
- Rewriting the shipped PowerFlex/Magnetek packs.
- The foreign WIP `scorecard.py`/`test_scorecard.py` edits in the main checkout (isolated by worktree).

## Success criteria per task
Each module has a focused unit test (Haiku-built fixtures). The vertical slice
runs end-to-end on all 5 manuals producing the canonical JSON + evidence dir.
Existing `pytest tools/drive-pack-extract/tests/` stays green. `ruff check` clean.

## Reality note
The full acceptance-gate bar across 5 diverse vendors is a large target. Honor
the operator directive: implement the working vertical slice, run on all 5, fix
until gates met OR report the precise measured gap per manual per gate. Do not
stop at an architecture doc.
