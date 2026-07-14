# Run B — design proposal (NOT implemented)

Run B is the **hybrid wrapper**: after the Run-A baseline is frozen (it is —
see `MANIFEST.json`), let Claude resolve the manual-backed information the
deterministic extractor *cannot represent*, while the deterministic path stays
exactly as Run A froze it. This document is design only. **No Run-B code is
written here.** It is scoped to the five locked constraints and nothing else.

> Scientific frame: Run A = current deterministic system (frozen). Run B =
> deterministic **+ explicit, labeled Claude fallback**. Run C = an improved
> deterministic system *learned from* Run B's approved records. The end-state is
> **not** "Claude fills the pack forever" — it is "code can't resolve → Claude
> resolves with evidence → human approves → system learns → future runs resolve
> deterministically."

## The five locked constraints (the only contract Run B is designed against)

### C1 — Preserve the exact raw fault token verbatim
Every Run-B record MUST carry the source token exactly as written: `oC`, not
`oc`/`OC`/`0xoC`/`212`. This is captured **before** any normalization so Run C
can derive aliases later; a record that loses the raw form is unreconstructable.

- **Record field:** `raw_token: str` (verbatim, case-preserved, whitespace-trimmed only).
- **No coercion:** no numeric alias, hash, synthetic id, or casefold at capture time.
- **Rationale grounded in Run A:** the GS10 leak (`'21' → 'oL overload'`) proves
  mnemonic identity has no home today; C1 gives it one *in the Run-B record*,
  without touching the frozen schema.

### C2 — Fallback resolves identity / description / severity ONLY with a manual citation
Claude may fill exactly three semantic fields, and only when it can cite a
manual page/excerpt for them:

- `identity` (what the code *is* — e.g. "Overcurrent"),
- `description` (human-readable meaning),
- `severity` (advisory band).

Each MUST carry `citation = {doc, page, excerpt}` (mirrors the existing
`schema.Citation` shape at `schema.py:115`). **No citation ⇒ the field stays
`unresolved`.** A Run-B record with a filled semantic field and an empty citation
is invalid and fails validation.

### C3 — Fallback may NOT invent codes, claim wire/register values, or give operational guidance
Hard prohibitions, enforced by the record validator, not by prompt alone:

- **No invented codes.** Claude may only resolve a `raw_token` that appears in
  the provided source excerpt set; a token with no supporting excerpt ⇒
  `unresolved`, never a guessed meaning.
- **No unverified wire/register values.** Claude MUST NOT assert a Modbus/EtherNet-IP
  register address or an integer enum value for a mnemonic code. Those are
  `bench_verified` facts; absent bench data the field is `null`, never a guess.
  (This keeps Run B from silently re-introducing the very int-key the schema
  demands — which would be laundering a guess through the fallback.)
- **No operational guidance.** No reset, clear, override, fault-acknowledge,
  jog, or any action step. Read-only-in-beta + `.claude/rules/fieldbus-readonly.md`
  + `train-before-deploy`. Resolving what a code *means* (cited) is allowed;
  telling anyone what to *do* is not.

### C4 — Safety-relevant unresolved crane/hoist faults stay unresolved and HARD-FAIL
G+ Mini is a lifting drive. A hallucinated crane fault meaning is a lifting-safety
issue. So:

- A configurable **safety-relevant token set** (brake `BE*`, overload `oL*`,
  overspeed, load-check `LL*`, encoder/feedback loss, phase loss) that Claude
  cannot resolve **with a citation** ⇒ status `unresolved` **and a hard fail** of
  that record — never a low-confidence guess, never a "best effort" meaning.
- **Invariant (the Run-A bar):** Run B must be **provably no-less-safe than Run
  A's refusal.** Run A resolves nothing and guesses nothing (0 hard failures =
  0 unsafe outputs). Run B's `hard_failures` metric counts any case where a
  safety-relevant code was emitted with a meaning; the target is **0**, identical
  to Run A. A Run B that turns an honest refusal into a confident-but-wrong
  crane decode has regressed safety even if coverage went up.

### C5 — An approved fallback result must be convertible to determinism
The win condition. For every Run-B record a human/reviewer marks **approved**,
there must be a mechanical path to all three of:

1. a **deterministic parser/pack entry** (the resolved code now lives in data the
   Run-C schema can key on, no LLM needed),
2. a **`fixtures/` case** (input → expected deterministic output),
3. a **regression test** asserting the code resolves **without** invoking Claude.

If an approved record cannot produce all three, the fallback wasn't really
"learnable" and the approval is incomplete. Run C's success metric is exactly
this: the codes Claude resolved in Run B now resolve deterministically, and
`pct_fallback` for G+ Mini trends to ~0.

## Proposed Run-B record shape (design only — captures C1–C4, feeds C5)

```jsonc
{
  "drive_family": "impulse_gplus_mini",
  "raw_token": "BE2",                    // C1 — verbatim, case-preserved
  "resolution_label": "llm_fallback",    // one of: deterministic | llm_fallback | unresolved
  "identity":    "Brake answerback fault",   // C2 — null unless cited
  "description": "Drive commanded the brake but did not…",  // C2 — null unless cited
  "severity":    "safety_relevant",      // C2/C4 advisory band
  "citation":    {"doc": "IMPULSE G+ Mini UM", "page": "7-4", "excerpt": "BE2 …"},  // C2 — required to fill semantics
  "wire_value":  null,                   // C3 — never guessed; bench_verified only
  "operational_guidance": null,          // C3 — always null in beta
  "deterministic_failure_reason": "loader._int_keyed rejects non-numeric key 'BE2' (loader.py:275)",
  "model": "<model id>",                 // provenance
  "prompt_version": "<hash/tag>",        // provenance
  "confidence": "low|medium|high",
  "validation_status": "valid|invalid",  // record validator verdict
  "review_state": "pending|approved|rejected",  // C5 gate — human action
  "safety_hard_fail": false              // C4 — true iff safety-relevant & uncited
}
```

Every field is labeled `deterministic` / `llm_fallback` / `unresolved`, and every
semantic field is traceable to a citation, a deterministic failure reason, a
model+prompt version, a validation status, and a review state — as required.

## Run-B metrics to report (same axes as Run A, for the A/B/C comparison)

`coverage`, `score`, `hard_failures`, `citation_accuracy`, `latency_ms`,
`token_cost`, `pct_deterministic`, `pct_fallback`, `pct_unresolved`. Run A's
frozen floor for each is in `metrics.json` (0 / 0 / 0 / N-A / N-A / 0 / 0 / 0 /
100). Run B is judged against that floor **with C4 as a veto**: a coverage gain
that raises `hard_failures` above Run A's 0 is a failure, not progress.

## Explicitly deferred to Run C (do NOT decide or build in Run B)
Per the freeze discipline, these are ratified from Run-B evidence, not
pre-committed: string-keyed map vs structured record (#1), version-bump vs
adapter (#2), exact/display/normalized/alias semantics (#3), case-sensitivity
policy (#4 — but C1 already forbids casefold at capture, protecting the option),
runtime/API compat across the five reader sites (#5), fault→parameter linking
(#6), existing-pack migration (#7). Build none speculatively (Karpathy). The one
open **input** Run B should gather for Run C: whether any two G+ Mini mnemonic
codes differ only by case (drives the #4 decision), and whether G+ Mini exposes
any integer fault register at all (drives whether `wire_value` can ever be
non-null).

## Guardrails on Run B itself
- Read/label only. Run B does **not** modify `schema.py`, `loader.py`, any pack,
  `gold/`, or any runtime path. It produces **records**, reviewed offline.
- Needs the actual G+ Mini manual as cited source (absent today — see
  `raw_inputs/NO_SOURCE_MATERIAL.md`); acquiring/curating it is a Run-B
  prerequisite, tracked separately, and its PDF is never committed (registry +
  `.gitignore` discipline).
- No merge, deploy, promote-to-`gold/`, or baseline overwrite without explicit
  approval.
