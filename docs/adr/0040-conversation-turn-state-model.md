# ADR-0040 — The canonical conversation turn-state model

- **Status:** Proposed (2026-09-01) — awaiting Mike
- **Scope:** every conversation surface — Hub Notebook chat, Hub AssetChat, Hub NodeChat, mobile chat
- **Relationship to ADR-0038/0039 (`#3514`, proposed):** 0038 governs the **streaming protocol**
  (the wire, its frames, rule 6 and rule 7). This ADR governs the **turn state** that protocol
  produces and that clients persist and render. Where they overlap, 0038 is authoritative for the
  wire and this ADR is authoritative for what the turn *is* afterwards.

## Context

Tonight nine PRs landed across the two Hub chat surfaces (safety-marker persistence, distinct
safety render, design tokens, Stop control, IME-safe composer, composer restore). In doing so we
proved a set of invariants empirically — by mutation-testing them and by fuzzing the canonical
stream reader with 128,000 randomized adversarial streams (0 violations).

This ADR **encodes what we proved**. It deliberately does not propose a second implementation:
every rule below already holds somewhere in the tree, and the gaps are named as gaps.

## Decision

### 1. The server owns the terminal outcome

The canonical terminal state of a turn is decided by the **server** and transmitted explicitly.
The client never infers it from transport behaviour.

Canonical outcomes:

| outcome | meaning |
|---|---|
| `completed` | the server produced an answer it stands behind |
| `safety_stop` | a safety determination replaced the answer (LOTO, arc flash, confined space…) |
| `insufficient_evidence` | the server had nothing adequate to ground an answer |
| `stopped` | the technician interrupted generation |
| `failed` | the exchange did not produce a turn |

`generating` is a **client-side presentation state**, not a terminal outcome. `truncated` is
likewise not a separate stored outcome — a stream that ends without a terminal marker is
**`failed`** (see §3), and may carry partial text.

### 2. `safety_stop` alone is sufficient, and optional metadata is never required

A turn whose outcome is `safety_stop` **must be renderable as a safety turn from that fact
alone**, after reload and on a different device.

- Optional `trigger` / reason metadata (`loto`, `arc_flash`, …) is **enrichment only**.
- A client that receives `safety_stop` with **no** trigger MUST still render full safety
  treatment. Absence of a trigger is never grounds to downgrade the turn.
- This is the one place we deliberately **fail closed**: safety is presented on partial
  information rather than withheld pending complete information.

*Empirically held today:* the stream reader keeps a delivered `safety` frame sticky through
truncation, and a mutation making it non-sticky is caught. Verified across 128,000 randomized
streams.

### 3. Absence of a terminal marker is never success

A stream that ends — cleanly, by disconnect, by proxy cut, by `[DONE]` — **without** an explicit
terminal marker resolves to a non-answer. `[DONE]` is a transport sentinel and carries no state;
stream closure is not a terminal marker at all.

*Empirically held today:* ADR-0038 rule 6, implemented by seeding the terminal state as
not-an-answer and setting `sawStatus` only on a real `status` frame. Reintroducing the old
`"answered"` seed is caught immediately by the soak.

### 4. Citation and success-chrome eligibility

Presentation affordances are gated on the outcome, not on the presence of data:

| affordance | eligible when |
|---|---|
| citations / source chips | outcome is `completed` |
| basis / evidence badges | outcome is `completed` |
| follow-up suggestions | outcome is `completed` |
| partial text | any outcome may carry it |
| safety treatment | outcome is `safety_stop` (trigger not required) |

Citations arriving **before** truncation must not be rendered as though the turn completed —
the wire delivers sources before status, so a cut-off turn is otherwise holding real citations
and would present as a complete, cited answer. That exact defect is what ADR-0038 rule 6 fixes.

### 5. Retry semantics

- Retry is offered only for `failed`.
- Retry re-posts the **byte-identical** request. It never recomputes scope, history, or message.
- Retry targets exactly the failed exchange and **must not duplicate the user's turn**. The
  failure path therefore rolls back the *whole* optimistic exchange — assistant bubble **and**
  user turn — so the question survives only in the composer.
- A `stopped` turn is **not** retryable: the technician chose to stop.
- Retry is unavailable while a new attempt is in flight.

*Gap closed tonight:* AssetChat/NodeChat removed only the assistant bubble on failure, orphaning
the user turn; Retry then appended a second copy of the same question — to the transcript **and**
to the model payload. Fixed on `#3531` (HELD) via `rollbackFailedExchange`, mirroring Notebook
chat, which already did this and documented why.

### 6. What must survive persistence

Reload and cross-device must reproduce the turn's **identity**, not merely its text:

- the terminal outcome
- `safety_stop` as a first-class fact (§2)
- partial text of a `stopped` or `failed`-with-partial turn
- citations **only** where §4 permits them

Presentation is **derived**. Colours, markdown, chrome and rendered HTML are never canonical and
are never persisted as truth — a client computes them from the outcome. Tonight's token migration
(`--status-red-bg`, `--status-red`) is the concrete form of that rule: styling is a client
concern, and tests that pinned literal colour values were repointed at tokens.

### 7. Turns that are not answers never re-enter model context

`stopped`, `failed`, and `safety_stop` turns are excluded from the history sent on a later turn.
A safety refusal in particular must not be replayed to the model as its own prior reasoning.

*Partly held today:* `stopped` is excluded on all surfaces. The `safety_stop` exclusion is
implemented on `#3521` (HELD) and is **not yet on main**.

## Failure-open vs failure-closed

| situation | direction | why |
|---|---|---|
| safety determination arrived, tail lost | **closed** — show safety | withholding a LOTO warning is the unsafe direction |
| no terminal marker | **closed** — not an answer | a cut-off stream must never claim success |
| trigger metadata missing on `safety_stop` | **closed** — full safety treatment | metadata is enrichment, never a gate |
| citations present but turn incomplete | **closed** — suppress citations | avoids a fabricated cited answer |

## Consequences

- A surface adding a new outcome must define its citation and chrome eligibility here first.
- Persisting rendered presentation is a defect, not an optimisation.
- Any client that treats missing optional safety metadata as "not a safety turn" violates §2.

## Status of the invariants

| invariant | state |
|---|---|
| §1 server owns outcome | held on the wire (ADR-0038); outcome vocabulary here is **proposed** |
| §2 `safety_stop` self-sufficient | held for the sticky-safety half; **the enum is not yet implemented** |
| §3 no marker ⇒ not success | **held**, soak-verified |
| §4 citation eligibility | held in Notebook chat; AssetChat/NodeChat have no citation chrome to gate |
| §5 retry semantics | held in Notebook chat; fix pending on `#3531` (HELD) |
| §6 persistence | held for safety markers; presentation-derivation held after tonight |
| §7 non-answers out of history | `stopped` held; `safety_stop` pending on `#3521` (HELD) |

This ADR is **documentation of proven behaviour plus named gaps**. It authorises no refactor.
