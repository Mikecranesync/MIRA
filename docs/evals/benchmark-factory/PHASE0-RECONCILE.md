# Benchmark Factory — Phase 0 reconcile (2026-10-26)

Spec: `docs/evals/benchmark-factory/IMPLEMENTATION_AND_VISION.md` (PR #4824).
Base: `origin/main` @ `4e89f24aa`. Work claim: PR #4824 comment 6428384341.

## What already exists

| Thing | Where | State | Disposition |
|---|---|---|---|
| `answer_radar/` package: `QuestionRecord`, CLF rights / license / independence / safety / split vocabulary, CAS freeze (`freeze.py`), dual graders, VCAD score + report | `main` | merged, CI-run (`pytest tests/answer_radar/`) | **REUSE: the canonical base.** The Benchmark Factory lives in `answer_radar/factory/` and imports these types. |
| Continuous Learning Factory contracts (rights, judge independence, gold record, leakage split) | `docs/specs/continuous-learning-factory/` (main) | schemas only | **REUSE vocabulary** (already reused by `answer_radar.schema`). |
| IMIB v0.1: forum-new / t4-77 / safety-gate sets, provenance, blind labels, human-key rescore, planted-defect check, run manifests | PR #4793, `docs/evals/benchmark-4791/` | open draft, active owner | **CONNECT:** import its JSON sets as data and reuse its planted-defect idea. Not edited from here. |
| Expert review app ("Industrial Intelligence Challenge") | PR #4801, `docs/evals/benchmark-4791/review-app/` | open draft, live artifact | **CONNECT:** the factory's expert queue exports and imports `review-data.json`'s shape. |
| Answer Radar V1 foreman mission (`mira-bots/foreman/agents/answer_radar/`) | PR #3589 | open draft, idle since 2026-09-05 | **RETIRE candidate.** Superseded by `answer_radar/` on main. Not closed here; that is the owner's call. |

## Decision recorded for owner veto

Spec §6 says "extend the current IMIB schema". IMIB v0.1 has no single schema: each set is its own JSON shape on an unmerged branch. The merged, tested record type is `answer_radar.schema.QuestionRecord`. So `BenchmarkCase` wraps `QuestionRecord` and adds the §6 fields (pool, question lineage, gold status, holdout and exposure, provenance), and IMIB sets enter through importers. This is one schema, extended, not a second one (§17).

## Mapping, not parallel enums

- **Split:** reuse `SplitAssignment` (fresh / regression / development). Holdout is a separate `holdout` flag, and a Live case is always fresh + holdout + not exposed.
- **Lineage:** `QuestionRecord.lineage_key` (manufacturer/model/platform) remains the split key. `BenchmarkCase.lineage_id` groups metamorphic variants of one source question. A variant shares its parent's question record identity fields, so it also shares the split.
- **Gold:** `provisional | expert_reviewed | disputed`. `expert_reviewed` requires an `IndependenceClass.HUMAN_REVIEW` label.

## Hard limits this session

No crawler activation, paid run or scheduled job is authorized (§17). Discovery adapters ship as fixture replay. Collection stays refused until a registry entry has `reviewed_at` set by a human.
