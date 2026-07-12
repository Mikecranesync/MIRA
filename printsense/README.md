# PrintSense / PrintSynth

**PrintSense** — a technician photographs an electrical print (page / cropped circuit / whole package),
sends it via Telegram, and MIRA identifies the page + package, explains the circuit in technician
language, calls out every device / terminal / wire / cable / power-domain / I-O / continuation / PE,
**traces across previously-ingested pages**, answers follow-ups, **cites page + region + evidence
crop**, and **refuses to invent**. It feels as capable as an LLM but **progressively answers from
verified deterministic artifacts** as corrections are approved.

**PrintSynth** — the structured representation each package compiles to: the typed, evidence-backed
graph (`graph.json`) + reusable interpretation rules.

## Doctrine (see `~/.claude/plans/find-the-photos-from-dynamic-pnueli.md` for the full grilled design)

- **Hybrid teach-and-learn.** The LLM *interprets* (teacher); each **verified** interpretation distills
  into **declarative** deterministic rules (learner — symbol templates, tag grammars, connectivity /
  operating / cross-page rules). **No runtime code-gen.** Answers shift from LLM → the trusted graph as
  corrections are approved; the LLM only handles the not-yet-learned + wording.
- **3-state trust gate:** `proposed` → `machine_verified` → `human_verified`; `unresolved` is never
  promoted by plausibility. The uploading technician is the **verifier of record** (self-serve).
- **Read-only OT.** Never infer field state from a drawing alone.

## Status (build in progress on `feat/printsense-framework`)

- ✅ **SCU2 gold package seeded** — `fixtures/scu2/` (25 devices … 25 PLC I/O; judge 94/100, 13/13, 0
  hard failures). See `fixtures/scu2/README.md`.
- ⏳ **Typed IR** (`models.py`, Pydantic + JSON Schema) — matches the fixture shape.
- ⏳ **Trust model** (`proposed/machine_verified/human_verified/unresolved` + verifier provenance).
- ⏳ **Deterministic question engine** — graph traversal answering the acceptance questions, cited
  (page + region + confidence + trust-state; separates visible-fact / inference / missing-PLC-behavior).
- ⏳ **Persistence** (Neon: reuse mig-063 evidence ledger + kg tables), **Telegram ingest seam**,
  **distillation flywheel**, **resumable multi-page/multi-cabinet ingest**, **machine-pack export**.

## Reuse anchors

- `mira-bots/shared/visual/` — `EvidenceState`, `Observation`, `answer_composer` (safety gate,
  NEVER-INVENT), the VT evidence types.
- `machine-print-pack/build/` — byte-deterministic build + validate + content-hash IDs + export.
- `mira-hub/db/migrations/063_visual_sessions.sql` — the evidence ledger (evidence_item /
  region_of_interest / observation) to extend for persistence.
- KG proposal infra (`ai_suggestions` / `relationship_proposals`, `proposed → verified` gate) +
  the existing **distillation flywheel** (`capture → score → distill → gate`).

## Tests

`tests/printsense/` — guarded with `pytest.importorskip("pydantic")` (skip where the optional dep is
absent, e.g. the lean offline-eval sweep) and run in a dedicated CI step. LLM-disabled by construction:
the question engine answers a learned package from the graph with no LLM call.
