# PrintSense Persistent Q&A — design record (2026-07-18)

**Status:** shipped as one vertical slice (Packages A+B+C, single PR, v3.166.0)
**Spec authority:** the PrintSense Persistent Electrical-Print Q&A upgrade prompt
(§Required implementation slice, §Acceptance tests, §Orchestration)
**Golden proof:** `mira-bots/tests/test_print_workspace_golden.py`

## Thesis

A technician photographs an electrical print **once**, then chats with that
print for as long as necessary. The photo is analyzed one time and becomes a
durable, versioned workspace; every later answer is grounded in the persisted
evidence ledger, prior conversation context, and technician-reported
measurements — never in a fresh re-analysis of the image, and never in
ungrounded model prose.

## Reuse map (inspected baseline — nothing here was rebuilt)

| Existing asset | Where | Role in this slice |
|---|---|---|
| VisualSession spine (ADR-0027) | `mira-bots/shared/visual/` (`session_service`, `store`, `models`, `evidence_state`, `answer_composer`, `quality_gate`) | THE system of record: sessions, evidence items, append-only observation ledger, `current_revision`, supersede, Q&A recording; Neon-or-InMemory via `default_store()` |
| Migration 063 (`visual_session` et al.) | `mira-hub/db/migrations/063_visual_sessions.sql` | Already existed — reused untouched (see Schema note) |
| PrintSynthGraph capture + CAS | `printsense/cas.py`, engine `graph_sink` seam | Graph JSON cached content-addressed under `graph_interpret_v1`; LIKELY ledger pointer |
| Deterministic Q&A spine | `printsense/deterministic_qa.py` (contact conventions, designations decoder, xrefnorm, wire grammar) | Chain link (b) + the bounded evidence packet for (d) |
| Designations decoder | `printsense/designations/` | K17↔K17.1 child/contact alias resolution (lazy, prefix-match fallback) |
| Print autoeval v2 | `mira-bots/shared/print_autoeval.py` | Every delivered turn graded ($0, deterministic); golden suite asserts never-P0 |
| Drive-pack fast-path precedent | `mira-bots/telegram/bot.py::_try_drive_pack_followup`, `mira-bots/ask_api/drive_pack.py` | The rung shape, the claim-gate discipline, the read-only API idiom |
| WorkflowRun / PhotoBatchQueue | `mira-bots/shared/workflow.py`, `shared/photo_batch_queue.py` | Existing durable-execution primitives (see Temporal verdict) |

## Architecture — the three packages

### Package A — persistent print workspace (`shared/print_workspace.py`)

- `telegram_print_workspace` chat→session mapping table in the same SQLite
  mira.db as `telegram_drive_context` (`get_workspace`/`set_workspace`,
  7-day TTL, `last_entity` continuity column, COALESCE-preserving upsert).
- `ingest_print_photo`: model-free ingest through the spine
  (`PrecomputedVision` replays the bot's already-computed vision result — the
  photo is never re-analyzed; `NullPrintWorker`/`_no_schematic` keep the spine
  inert beyond recording). Bbox single-writer: positioned `ocr_tokens` become
  one VISIBLE observation each, carrying `metadata.bbox` (honest evidence
  regions). Tag-overlap supersede: a close-up's re-read values supersede the
  stale rows from other evidence items; every evidence change bumps
  `current_revision` (the print-model version).
- `append_technician_observation`: technician-reported measurements land as
  DOCUMENTED (`extractor="technician"`) — structurally distinct from drawing
  facts (VISIBLE/ocr) and from derived facts (LIKELY), and deliberately do NOT
  bump the print-model revision.
- Everything fail-open: no public function may raise into a bot turn.

### Package B — evidence contract + follow-up rung

- `shared/visual/evidence_answer.py`: the `EvidenceAnswer` 12-field render
  contract (trust-labeled claims projected from the ledger, honest
  coordinates — no stored bbox → "coordinates unavailable", never fabricated;
  deterministic safety classes with grader-marker notes; ≤8 claims / ≤3
  suggestions, structurally under the autoeval degenerate thresholds);
  `detect_technician_observation` (value+unit AND a location cue/tag);
  `observation_ack_text`; `superseded_note_for`.
- `shared/visual/question_resolution.py`: explicit tag ∥ child alias
  (designations decoder, prefix fallback) ∥ pronoun/device-noun → `last_entity`.
- `telegram/bot.py::_try_print_workspace_followup`: the text rung after the
  drive-pack rung. Claim gate (preserved verbatim in Package C): not a safety
  turn ∧ live workspace ∧ (measurement ∥ resolved focus ∥ print-shaped
  question). Answer chain, first producer wins: (a) measurement intake — zero
  LLM; (b) deterministic spine over the rebuilt ledger `vision_data`; (c)
  ledger composer (`service.ask`); (d) bounded model explanation gated on a
  non-empty deterministic evidence packet; (e) honest refusal only when the
  question demonstrably targeted the workspace, else fall through unchanged.
  Autoeval branch `workspace_followup`.

### Package C — this change

1. **Fixture** `printsense/benchmarks/persistent_qa_fixture.py`: synthetic,
   redistributable K17 seal-in circuit (`BASE`) + the K17-region close-up
   (`CLOSE_UP_BASE`, adds the 21/22 pair) in the golden-corpus base-dict
   shape, rendered by the SHARED `draw_print_page`; `vision_data()` /
   `page_png()` pure helpers. No customer content (`truth_status: synthetic`).
2. **Golden acceptance** `mira-bots/tests/test_print_workspace_golden.py`: the
   spec's five-turn conversation over the REAL bot rungs, plus the close-up
   supersede/revision turn, per-turn autoeval never-P0, vision called exactly
   once for the whole conversation, state-persistence and both-evidence-kinds
   proofs. Hermetic, keyless, zero paid inference.
3. **Read-only workspace API** `mira-bots/ask_api/workspace.py` (+ two lines
   in `app.py`): `GET /workspace/{session_id}/summary|entities|evidence/{tag}`
   mirroring the drive-pack idiom (request-time `ASK_API_KEY`, `X-Mira-Tenant`,
   honest 404 for unknown/foreign sessions, never-500). This is the spatial
   -interaction backend contract: every entity/evidence row carries its stored
   bbox coordinates or an honest `null`.
4. **Continuity wiring** (two small additive edits, discovered by the golden
   conversation): `question_resolution._PRONOUN_RE` gains `its` (possessive
   pronoun continuity — "How does **its** seal-in work?"), and
   `ingest_print_photo` seeds `last_entity` from the photo caption when the
   caption names a tag the photo actually read ("What would energize **K17**?"
   → the next pronoun turn resolves K17). Neither touches the claim gate.
5. **Harness follow-through**: `tests/test_ask_api_readonly_guard.py`'s
   import-stub harness enumerates every router module `ask_api/app.py`
   includes — it gains an `ask_api.workspace` stub exactly mirroring its
   `ask_api.drive_pack` stub (without it, the stubbed `fastapi` lacks
   `APIRouter` and the app import breaks under the harness).

## Schema note (reused vs added)

- **Reused, zero new Neon migrations:** migration 063 (`visual_session`,
  `evidence_item`, `region_of_interest`, `observation`, answer tables) already
  existed from ADR-0027 Phase 1 and carries everything the workspace needs —
  including `current_revision` (the print-model version) and
  `superseded_by`/`SUPERSEDED` states.
- **Added (Package A, SQLite not Neon):** `telegram_print_workspace` mapping
  table in mira.db, created inline exactly like `telegram_drive_context` — a
  per-adapter continuity cache, not plant truth, so it does not belong in the
  Hub schema.

## Deviations from the spec's literal golden script

- Turn 2 is phrased "How does its seal-in work?" (not "How does it stay
  energized after I release Start?") — the spec phrasing contains "energized",
  which the deterministic state-honesty answerer correctly intercepts with the
  a-print-cannot-show-live-state reply; the seal-in phrasing exercises the
  intended pronoun→ledger→model chain and cites 13/14.
- Turn 5 is anchored: "What should I check next **on this circuit**?" The bare
  spec phrasing carries no workspace signal (no measurement, no resolvable
  entity, not print-shaped per `is_print_question`), and the preserved Package
  B claim gate deliberately declines signal-free turns (they could equally
  target a drive pack or wiring context). The anchored form resolves the
  pronoun against the accumulated `last_entity` AND is print-shaped;
  `test_bare_next_check_question_falls_through_by_design` pins the bare form's
  fall-through as intended behavior rather than silently widening the gate.

## Deferred (explicitly out of this slice)

- **Spatial tap-to-focus client** — the API now serves bbox coordinates per
  entity/evidence row; the Hub/mobile renderer that highlights regions,
  box-selects "what is this?", and walks xrefs is a client build on top of it.
- **Multi-sheet pagesets beyond the current multi-photo path** — multiple
  photos of one page work today (supersede-by-overlap); cross-sheet workspace
  linking (xref → destination sheet navigation) is not wired.
- **Quiz / challenge-my-diagnosis teaching modes** — the evidence system they
  must ride on is in place; the modes are prompt/flow work, not architecture.
- **Tesseract OCR fallback** — live free-cascade vision (gemma) currently
  yields 0 positioned OCR tokens on some turns; a local OCR lane would make
  bbox evidence independent of the vision provider (ADR-0028 territory).

## Temporal verdict (spec §Orchestration)

**NOT warranted now.** The live Q&A path must be low-latency reads of the
current workspace (it is: one SQLite mapping read + one ledger load), and the
ingest path is single-step and idempotent-enough under the existing
primitives: `WorkflowRun` (durable, observable, idempotency-keyed run records
— `shared/workflow.py`, Hub migration 044), the content-addressed CAS for
derived artifacts (`printsense/cas.py`), and `PhotoBatchQueue` for durable
multi-photo intake. Re-ingesting a photo is safe (append-only ledger +
supersede + revision bump), so failure recovery is "run it again", which those
primitives already record and dedup.

**The boundary where Temporal becomes justified:** multi-step **paid
enrichment chains** — e.g. tile → per-region paid vision → xref resolution
across sheets → graph merge, where each step costs real money, can fail
independently, must resume mid-chain without re-spending completed steps, and
may wait hours/days for a human close-up. That is durable *orchestration with
partial-progress checkpointing and long timers*, which `WorkflowRun` (a run
*recorder*, not a scheduler/resumer) deliberately does not do. Until a paid
multi-step chain like that ships, adding Temporal would be infrastructure
without a customer.

## Verification

- `mira-bots/tests/test_print_workspace_golden.py` — the golden conversation,
  close-up continuation, bare-turn gate pin, fixture determinism.
- `mira-bots/tests/test_ask_api_workspace.py` — auth, 404/tenant isolation,
  summary/entities/evidence shapes, superseded visibility, never-500.
- Existing Package A/B suites (`test_print_workspace_store.py`,
  `test_print_workspace_followup.py`, `test_question_resolution.py`,
  `test_evidence_answer.py`, `test_print_turn_persistence.py`) — unchanged and
  green with the continuity edits.
- PrintSense frozen-corpus + grader gates (`tests/printsense/`,
  `printsense/grader_gate.py`) — untouched and green (no guarded file edited).
