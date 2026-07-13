# Print-Eval Gold Standard & Email Loop — Durable Implementation Spec

**Status:** In implementation (PR1 of 5).
**Extends:** [`printsense/PATH_TO_A.md`](../../printsense/PATH_TO_A.md) — this is PATH_TO_A **Phase 1 (measurement)**, widened from one case (SCU2 sheet-20) to a corpus.
**Requirements source:** the approved PRD *"MIRA Print Evaluation Gold Standard and Email Loop"* (2026-07-13, owner: Mike Harper). This doc does **not** restate the PRD; it is the **repo-grounded reuse map + seam→gate mapping + verified ATV340 anchor + PR plan** the PRD tells the implementer to produce (§4, §18 PR1).

**Branch:** `feat/print-eval-skill` · **Base:** `origin/main` @ `c81a64b9` (post-#2674, `v3.137.2`) · **Worktree:** `C:/wt-printsense`.

---

## 0. Thesis

> **Good prose does not imply a trustworthy graph.**

The Schneider ATV340 run scored **81/B, `hard_failure=false`** from the LLM judge while its structured graph contained P0 electrical errors (verified §3). The fix is not a new evaluator — MIRA already has four grading artifacts. The job is to **unify and productize** them: make the deterministic grader authoritative for *import safety*, keep the LLM judge for *qualitative discovery*, and never let fluent prose unlock import.

---

## 1. Reuse map — what already exists (do NOT fork; PRD §4, §6)

Four grading artifacts exist and are **not unified**:

| Artifact | Kind | Path | Wired into a pipeline? |
|---|---|---|---|
| Professor ATV340 review | Human rubric (8 weighted cats + P0 gates + truth set + DoD) | uploaded PRD source | No (paper → this spec) |
| `judge.py` `_RUBRIC` / `_HARD_FAILS` | **LLM** judge (Sonnet, multimodal) | `tools/internet_print_test/judge.py` | **Yes** — `runner.py` runs it (double-judge on hard-fail) |
| `grader.py` | **Deterministic**, no-LLM, per-case rubric | `printsense/grader.py` | **No** — CLI + `tests/printsense/test_grader.py` only |
| `fixtures/scu2/judgement.json` | Hand-authored acceptance audit | `printsense/fixtures/scu2/` | No (frozen review record) |

**Three facts that drive every design choice below:**

1. **The two engines never meet.** `runner.py` (internet path) calls *only* the LLM `judge`; `grader.py` runs *only* in unit tests/benchmarks. **PR4 wires the deterministic grader into `runner.py` before the judge.**
2. **`bot_importable` is a naming collision, not a gate.** The only `bot_importable` in the repo (`submit.py:71,126`) is a *Python-module-import-success* flag. The professor's structural validator (`duplicate_ids` / `unresolved_references` / `variant_crossovers` / `exact_label_failures`) exists in **no code**. `grader.py` is its home (PR2).
3. **The judge is prose-only.** `judge.py::_prompt` receives `final_text` + `map_text` + the image — **never `extraction.json`**. Every missed defect (DQ/DO, dangling `CN3`, dup ids, RS422) lives *in the graph the judge cannot see*. **PR4 hands it the graph.**

**Schema / provenance canon to reuse (no 5th schema — PRD §6):**
- Graph schema = `printsense/models.py::PrintSynthGraph` (Pydantic, `extra="allow"`). `Entity` has **no `id` and no `variant`** — identity is the free-text `tag` (root cause of duplicate ids). Provenance is a flat `evidence: str|None` with no non-empty constraint.
- Deterministic-gate **model to copy** = `machine-print-pack/build/validate_pack.py` (`check_N` broken cross-refs, `check_O` duplicate conductors, `check_M` missing evidence) — the exact checks the professor wants, already written, but over `pack_model.json`. Re-implement equivalently **over `PrintSynthGraph` inside `grader.py`** (do not import the pack validator; different schema).
- Provenance/trust canon = `EvidenceState` (`mira-bots/shared/visual/evidence_state.py`, ADR-0027) + `region_of_interest` (mig-063) — PATH_TO_A Phase 3 already plans `Entity.region`. Prefer these over printsense's parallel `TrustState`/free-text `evidence` when provenance work lands (PR2/Phase-3 scope; not PR1).

**Ops contract (for the skill — PRD §10.1) — canonical run:**
```
doppler run -p factorylm -c stg -- py -3 tools/internet_print_test/runner.py \
  --telegram-production-path --test-id <id> --send-email
```
- Real entry point: `bot._try_print_translator_reply(raw, vision, caption, update, context)` (`mira-bots/telegram/bot.py`), driven in-process by `submit.py` with Telegram-shaped stand-ins (no live token).
- Secrets (Doppler `factorylm/stg`): `ANTHROPIC_API_KEY` (interp+judge), `RESEND_API_KEY` (email), `MORNING_REPORT_EMAIL` (recipient), `RESEND_FROM`, `PRINT_VISION_PROVIDER=anthropic`. `MIRA_DB_PATH` auto-set. `PYTHONUTF8` is **not** referenced in code (UTF-8 forced in-code) — optional Windows console belt only.
- Safety (`safety.py`): robots.txt fail-closed; MIME allowlist (content-sniffed) {pdf,jpeg,png,webp,tiff}; 60 MB cap; 30 s timeout; 3 s/host; serial; archive/exe magic reject; `neutralize()` + `redact_secrets()`.
- Success marker: `email send: {'sent': True, 'status': 200, 'id': ...}` in `<id>/run.log`. Ungraded reports are **HELD** (never emailed without score/tier/verdict).

---

## 2. Seam → gate mapping (PRD §10.4)

Gates land in `grader.py`; per-case truth in the extended `rubric.json`. **DET** = computable from the graph JSON + rubric; **LLM** = needs the drawing when no frozen truth exists.

| Gate | Check | Seam |
|---|---|---|
| G1 exact printed-label / G2 no partial-completion | DET | `grader`: `rubric.categories.*.known_misreads ∩ pool`; digits never fuzzy-collapsed (`_norm`) |
| G3 dangling reference | DET | new: every `connects[]` / `functional_paths[].sequence[]` target resolves to a `tag` or is `UNREADABLE` |
| G4 duplicate identifier | DET | new: count `tag` across `PrintSynthGraph.ENTITY_SECTIONS`; require variant-qualified ids |
| G5 variant crossover / G6 incompatible path | DET*/LLM | new: `rubric.paths[]` with `variant` + `forbidden_members` (`PC/-`); DET once `Entity.variant` populated |
| G7 connector ownership (RS422→CN4 not CN3) | DET*/LLM | new: `rubric.paths[]` `from`/`forbidden_from` |
| G8 off-page-from-pagination | DET | new: `off_page_references` tag matching bare `N/M` == package page count |
| G9 evidence/provenance completeness | DET | new: graded `tag` on a `safety_critical` entity requires non-empty evidence (→ `region` bbox in Phase 3) |
| G10 trust consistency | DET | `grader` already: `trust ∈ {machine_verified,human_verified}` on fresh interp → 0/F |
| G11 `bot_importable` consistency | DET | new: `bot_importable=true` illegal when `import_verdict=FAIL` |
| G12 safety-critical misread | DET/LLM | new: misread on `rubric.safety_critical` counted separately + import-blocking |
| G13 confident misread | DET | `grader` already: `confident_misreads` caps at C |
| G14 required metrics (F1/coverage) | DET | `grader` already: device/wire/xref F1 + `is_A` |

**`rubric.json` additions (extend, do not fork — PRD §10.3):** `safety_critical[]`, `paths[]` (variant/endpoints/forbidden_members/from/forbidden_from), `require_unique_ids`, `require_refs_resolve`, `import_blocking_gates[]`, `expected_verdict{}`.

---

## 3. ATV340 calibration anchor — VERIFIED truth facts (PRD §11)

Confirmed against the rendered `tested_page.png` (Schneider `NVE97896-02`, sheet 1/2) — these freeze into the truth set (human review-and-freeze required, PRD §10.7):

- **Digital outputs = `DQCOM`, `DQ1`, `DQ2`** (NOT `DO1`/`DO2`). The graph emitted `DQCOM` *and* `DO1/DO2` — an internal DQ/DO inconsistency confirming the substitution.
- **Analog inputs = `+AI2` and `-AI2` (both printed)** on the differential-amp symbol. Graph used `AI2+/AI2-` (ordering nit, terminals correct). The **judge falsely flagged this as a hallucination** — G-level judge correction (PRD §10.6).
- **RS422 belongs to CN4/PTO** (→ remote ATV340 PTI). **CN3 is the `1Vpp A/B/I` encoder** (labeled). Graph wrongly put RS422 on CN3/ENC.
- **Braking, per-variant:** S1&S2 resistor = CN10 `PBe`↔`PB`; S3 resistor = CN9 `PA/+`↔CN8 `PB`. **`PC/-` is DC-bus, in neither.** Graph merged one path `[CN9:PA/+, CN9:PC/-, CN10:PB, CN10:PBe, resistor]` — wrong on both counts.
- **Variant-qualified ids required:** `S1S2:M`/`S3:M`; `S1S2:CN9:PA/+`/`S3:CN9:PA/+`; `S1S2:CN9:PC/-`/`S3:CN9:PC/-` (graph had unqualified duplicates).

**Expected deterministic verdict:** `quality_tier=USEFUL_DRAFT`, `import_verdict=FAIL`, `bot_importable=false`, score ≈ **67** (from rubric weights + gate deductions, **not** hardcoded). Minimum import-blocking failures: `exact_label_mismatch` (DQ→DO), `dangling_reference` (CN3), `duplicate_identifier`, `variant_crossover`, `incorrect_connector_ownership` (RS422), `incompatible_functional_path` (braking), `bot_importable_inconsistent`.

---

## 4. Two-axis verdict & tiers

Per PRD §8. Deterministic gates first, then weighted score; a hard-fail caps the letter. Tiers: `AUTO_IMPORT` (≥90 + all gates → the *only* tier that may set `bot_importable=true`) · `APPROVABLE_WITH_FIELD_VERIFICATION` (≥75 + zero safety-critical misreads + zero import-blocking) · `USEFUL_DRAFT` (≥60) · `REJECT` (<60 or severe hard-fail). `import_verdict ∈ {PASS,FAIL}` owned by the deterministic grader; the LLM judge may explain but never override.

---

## 5. PR plan (PRD §18) + status

| PR | Scope | Base | State |
|---|---|---|---|
| **PR1** | this spec + reuse map + `print-eval-email-loop` skill + stable grader interface (`grade_case`) + orchestration tests. **No grader behavior change.** | `main` @ c81a64b9 | **in progress** |
| PR2 | deterministic gates G1–G14 + `rubric.json` extension + unit tests | main | pending |
| PR3 | ATV340 frozen benchmark (source meta + reviewed/frozen truth + fixture) → reproduces USEFUL_DRAFT/FAIL | main | pending |
| PR4 | runner↔grader↔judge unification (grader before judge; graph → judge; AI2 fix; two-axis report/email) | main | pending |
| PR5 | offline `printsense-grader-gate` CI (no paid client; structural no-spend proof) | main | pending |
| follow-ups | PATH_TO_A Phase 0/2/3 product fixes driven by measured corpus failures | main | pending |

Each PR awaits Mike's explicit approval before merge (PRD §24). Follow-up product-fix PRs are separate from the harness program.

---

## 6. Success / "the goal" (PRD §9)

1. **Primary (done gate):** every **frozen** benchmark case (SCU2 + ATV340 + malformed fixtures) produces its expected deterministic result in `printsense-grader-gate` CI.
2. **Field metric:** rolling internet-corpus safety-critical hard-fail rate **< 5%** (publish numerator/denominator; ≥20 cases before it's meaningful; hide nothing).
3. **Phase-promotion streak:** **10 consecutive** predefined-queue cases at `APPROVABLE_WITH_FIELD_VERIFICATION`+, multi-manufacturer, ≥3 categories, no cherry-picking.

Corpus re-run queue (PRD §14): Eaton (clean) → Omron / Mitsubishi (verify page-0 first) → Yaskawa (robots-blocked; needs source swap). Per-case: Sonnet visual auditor drafts truth → **Mike freezes** → run → grade → judge → email → classify failure → map to PATH_TO_A backlog → rerun only after a fix.

---

## 7. Variances documented (PRD §24)

- **Worktree:** reused `C:/wt-printsense` off updated `main` instead of a fresh worktree — `C:` disk-tight (repo memory `reference_disk_full_worktree_sprawl`).
- **merge→deploy coupling:** merging #2674 to `main` fired the smoke-gated VPS deploy (VERSION bump). #2674 is tooling/eval-only (no service code) → effectively no-op + version tag. Mike explicitly authorized the merge.
