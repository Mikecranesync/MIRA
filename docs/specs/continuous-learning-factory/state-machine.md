# CLF State Machine (idempotent + replayable)

Policy for ADR-0030 principle 6. PR 0 defines the **contract**; the runtime that enforces it lands in PR 6 (scheduler) and PR 7 (gold). No code here.

## Why

A continuous loop reruns forever. If a transition is not idempotent, a retry double-charges or double-promotes; if it is not replayable, a crash loses work; if stale inputs are not invalidated, a gold record can silently reflect a prompt or source revision that no longer exists. This document makes those three properties explicit.

## Unit of state

State is tracked **per (page, config) pair**, not per document. The key is:

```
work_key = (page_id, interpreter_model, prompt_version, preprocess_version, grade_ruleset_version)
```

`page_id` carries `document_lineage_key` (see [`data-rights-and-leakage.md`](data-rights-and-leakage.md)), so leakage control and state tracking share the same identity. A large PDF is many `page_id`s — **one page = one resumable record** (`page-render.v1`); a completed page is never reprocessed unless its `work_key` changes.

## States

| State | Meaning | Terminal? |
|---|---|---|
| `discovered` | source registered (`corpus-source.v1`), rights resolved | no |
| `rendered` | page rendered (`page-render.v1`), `page_sha256` stamped | no |
| `queued` | admitted by the cost governor for one interpret | no |
| `evaluated` | `eval-result.v1` written (interpreter + optional judge) | no |
| `graded` | deterministic `grade_case()` verdict attached | no |
| `in_review` | routed to the human queue (disagreement or low confidence) | no |
| `corrected` | ≥1 immutable `correction-event.v1` linked | no |
| `gold` | approved `gold-record.v1`, leakage-partitioned | **yes** (until invalidated) |
| `rejected` | reviewer rejected; retained, never trained on | **yes** |
| `invalidated` | a `work_key` input changed; downstream stale | re-enters at `queued` |
| `error` | transition failed after retry budget | **yes** (needs operator) |

## Transition rules

1. **Idempotent by content address.** Every transition writes a content-addressed artifact (`printsense/cas.py` / `materialized_evidence/`). Re-running a transition with identical inputs is a **no-op that returns the existing artifact** — the same discipline the merged `print_recall` gate already uses (lookup → single-flight compute → persist). A retried interpret with the same `work_key` never produces a second paid call.
2. **Single-writer per key.** Concurrent workers on one `work_key` are serialized by the per-key single-flight lock (`mira-bots/shared/print_recall.py` pattern: in-process lock + cross-process file lock spanning compute+persist). Exactly one worker computes; the rest read the result.
3. **Append-only history.** `correction-event.v1` is immutable; a revision is a **new** event linking `prior_correction_id`. State is derived by folding the event log, so any state is reconstructable from artifacts (replayable).
4. **Explicit retry budget.** A failed transition retries up to a policy limit, then lands in `error` (never an infinite loop, never a silent drop). `error` requires an operator; it is not auto-cleared.
5. **No skips.** `gold` is reachable only through `evaluated → graded → (in_review) → corrected → approved`. A model answer cannot jump to `gold` without a policy-authorized approval (see [`promotion-policy.md`](promotion-policy.md)).

## Stale-input invalidation

A `gold` or `graded` record is **invalidated → re-queued** when any `work_key` component changes:

- prompt version, preprocessing version, or interpreter model version, **or**
- the source revision (`corpus-source.v1.supersedes` names a newer revision), **or**
- the deterministic ruleset version (a newly approved `rule-candidate.v1` changes the grade).

Invalidation never deletes: the prior artifact is retained with lineage intact, and a fresh run is queued under the new `work_key`. Frozen benchmark rows (PR 7) are the deliberate exception — a frozen row pins its `work_key` and is only re-cut by an explicit, reviewed benchmark bump.

## Worked example (AN-GS-021 p4)

`discovered` (public-eval-only, rights resolved) → `rendered` (p4 @ 200 dpi) → `queued` (governor admits) → `evaluated` (MiniMax-M3, `SELF_CONSISTENCY_ONLY` judge, score 82) → `graded` (`import_verdict=UNKNOWN`) → `in_review` (three flagged claims) → `corrected` (immutable event, AI1-DIP + STO expansion labels) → **approved** by human → `gold` (`split_assignment=test`). If the interpret prompt is later revised, this `gold` row is `invalidated` and re-queued — the correction event and its regions survive.
