# Unified Technician Eval Manifest (Phase 5) — capability slices

**Rule set:** ≥100 frozen held-out records grouped by full lineage; ≥50 manually
inspected before any verdict is final; deterministic metrics take precedence over
judges (protocol v3); per-slice results reported — an aggregate gain never hides a
domain regression. **No paid run is launched from this manifest.**

| # | Required slice | Asset (eval-only) | Records | Status |
|---|---|---|---|---|
| 1 | Drive Commander | 108-record 3-track PF40 set (`holdout_eval.build_prompt_set_expanded`, hash `b0493dcb…`) | 108 | READY |
| 2 | Safety / no-overreach | PF40 safety-sensitive subset + judge lens 3 + deterministic safety-floor metric | within #1 | READY |
| 3 | Citation presence/relevance | deterministic citation metric (behavior_spec) across all slices | cross-cutting | READY |
| 4 | Conflicting evidence | `eval_slices_general.jsonl` family `conflicting-evidence` (reserved, never trained) | 12 | READY (new) |
| 5 | Live-state freshness | family `stale-live-data` (reserved) | 12 | READY (new) |
| 6 | Missing retrieval | family `missing-retrieval` (reserved) | 12 | READY (new) |
| 7 | General troubleshooting | off-train general-behavior records (lineage-hashed test/held_out side, `general_offtrain_records` in the mixture report) | ~30 | READY (governed split by-product) |
| 8 | Correction handling | `correction-acceptance` off-train rows + judge lens | partial | PARTIAL |
| 9 | Cross-domain bridge | off-train bridge rows | ~small | PARTIAL (train-side bridge fix landed; off-train bridge rows remain few) |
| 10 | PrintSense | grader-gate frozen corpus (scu2 PASS / atv340 FAIL) + deterministic grader — **behavioral chat slice UNFILLED** | 2 graded cases | PARTIAL — honest gap |
| 11 | Graph/path reasoning | ontology fixtures are validator-only; **no chat-shaped graph eval exists** | 0 | UNFILLED — honest gap |
| 12 | Ontology truth boundaries | SHACL fixture pairs (11) — validator level only | 11 | PARTIAL |
| 13 | Task-mode consistency | requires the context contract wired into a serving path first | 0 | UNFILLED (blocked on runtime adoption) |

Frozen count grouped by lineage: 108 (PF40, one lineage, 3 tracks) + 36 reserved-family
general prompts + off-train governed rows ≥ **150+ total**, satisfying the ≥100 floor;
manual-inspection sample generation (≥50, stratified) is specified in judge protocol v3.

**Honest gaps:** graph-reasoning and task-mode-consistency slices cannot be built
credibly until (a) a chat-shaped KG eval fixture set exists and (b) the context
contract has at least one wired consumer. Both are named in the readiness report as
pre-training work, not post-training patches.
