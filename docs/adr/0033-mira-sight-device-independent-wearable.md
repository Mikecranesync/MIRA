# ADR-0033: MIRA Sight — device-independent wearable architecture

**Status:** Accepted (Phase 0/1 implementation)
**Date:** 2026-07-29
**Spec:** `docs/mira-sight/PRD.md` (uploaded 2026-07-29, treated as controlling)
**Owner surface:** `mira-sight/` (wearable core + simulator), `tools/mira_sight/sdk_watch/` (watcher), `config/mira-sight-sdk-*` (registry + baselines)

## Context

The MIRA Sight PRD directs a device-independent wearable intelligence layer (first
hardware: Brilliant Labs Halo) that feeds first-person observations into MIRA's
existing perception/retrieval/diagnosis stack, read-only, behind approvals.

### Repository-truth finding (PRD premise corrected)

The PRD header names `Mikecranesync/factorylm` as the primary repository. That repo
is the cluster/platform bootstrap ("Digital Twin Architecture"); **every reuse target
the PRD §10.1 enumerates lives in `Mikecranesync/MIRA`** — PrintSense, the VisualSession
spine, UNS resolver, retrieval, approved tags/live-tag ingest, approval systems, CMMS,
eval harness, CI conventions. Per PRD §0 ("Reuse existing components… Do not create a
parallel platform"), MIRA Sight is implemented **in MIRA**. If Mike intended factorylm,
say so and this program moves — nothing here depends on repo identity.

## Decision

1. **One wearable contract, adapters at the edge.** A `mira_sight` core package defines
   capability types (explicit tri-state+ knowledge: `supported/unsupported/unknown/
   requires_enrollment/requires_hardware/requires_license/deprecated`), the device
   protocol, the capture state machine, observation episodes, and the glanceable-card
   contract. Vendor adapters (simulator first, phone fallback next, Halo third)
   implement the contract; no vendor symbol leaks into the diagnostic core.
2. **Observation episodes ride the VisualSession spine, not a new store.** The PRD §7
   episode is an in-memory structure in Phase 2; when it persists (Phase 4+), it lands
   on the existing VisualSession system of record (`mira-bots/shared/visual/`
   `session_service`/`store`, migration 063) — the same spine #2798's print workspace
   consumes — with approvals through the existing `ai_suggestions`/approval-state
   systems (ADR-0017). **No second evidence registry** (materialized-evidence rule 15),
   **no second approval system** (PRD §7.2).
3. **The SDK watcher is data-in, review-out.** `tools/mira_sight/sdk_watch/` detects
   upstream changes (GitHub, PyPI/npm/pub.dev, docs fingerprints) against a committed
   baseline lock, emits JSON+Markdown change packets, and — only outside dry-run and
   only in test mode until reviewed — opens deduplicated issues. It never executes
   upstream content, never merges, never deploys (PRD §11.9–11.11; zero-token
   architecture: the watcher is deterministic, no LLM in the loop).
4. **Read-only industrial posture.** Live context consumption reuses the canonical
   ingest outputs (`tag_events` / approved-tags allowlist) read-only; fieldbus rules
   (`.claude/rules/fieldbus-readonly.md`) and the one-pipeline law are untouched.
   No write path exists in this program until a separately-approved PRD.

## Reuse map (Phase 0 deliverable — verified against this repo, 2026-07-29)

| PRD capability | Existing MIRA asset (reuse, don't rebuild) |
|---|---|
| Frame quality scoring | `mira-bots/shared/visual/quality_gate.py` (sharpness/variance scoring) |
| Photo classification (print vs equipment vs other) | `mira-bots/shared/workers/vision_worker.py` classification lanes |
| Multi-frame print understanding | `printsense/` (interpret seam, deterministic_qa, designations decoder) + `#2798` print workspace (`shared/print_workspace.py`, `visual/evidence_answer.py` trust labels) |
| Episode/evidence system of record | VisualSession spine: `shared/visual/session_service.py`, `store.py` (Neon-or-InMemory), migration 063; `EvidenceState` incl. SUPERSEDED |
| Nameplate → asset identity | nameplate flow (`/api/cmms/nameplate` shim + bot nameplate fast-path) |
| OCR | vision worker OCR lane (`ocr_lane_report`), printsense OCR spine; OCR regime runbook `docs/runbooks/ocr-regime.md` |
| Manual/knowledge retrieval | `mira-bots/shared/neon_recall.py` (BM25+vector+fault streams, hybrid-corpus law) |
| Asset/UNS context | `mira-bots/shared/uns_resolver.py`; kg_entities `uns_path` |
| Live tags (read-only) | `mira-relay` ingest → `tag_events` + `approved_tags` (one-pipeline law); `tag_diff_logger` grouping |
| Approvals | `ai_suggestions` / `relationship_proposals` / approval-state transitions (ADR-0017) |
| CMMS draft | `mira-cmms` (Atlas) + `mira-mcp` CMMS tools |
| Evidence-before-conclusions labels | `visual/evidence_answer.py` (Shown/Derived/Reported/Not-proven) — adopt the same vocabulary on glasses cards |
| Eval discipline | 5-regime tests, print autoeval v2, golden CSVs; frozen-corpus pattern from `printsense/benchmarks/` |
| Trust/grounding ceiling | citation compliance, groundedness scoring (`shared/engine.py`), UNS gate rules |
| AR precedent (archived) | `archive/mira-hud-2026-04` branch — hardware-gated AR HMI demo; consult, don't resurrect |

## Consequences

- Phase 2's in-memory episode must be written so its fields map 1:1 onto the
  VisualSession schema when persistence arrives (no parallel schema drift).
- The watcher's baseline lock lives in git (`config/mira-sight-sdk-baselines.lock.json`);
  meaningful upstream changes surface as reviewable diffs to that file plus packets —
  never silent state.
- Halo adapter work is gated on the verified-SDK inventory (`docs/mira-sight/sdk-matrix.md`)
  and cannot mark a capability `supported` without official-doc proof + test evidence
  (PRD hard gate 5).

## Risk register (Phase 0)

| Risk | Posture |
|---|---|
| Brilliant SDK churn (repo has NO releases/tags as of 2026-07-29 — commits are the only version signal) | Watcher monitors head commit + package registries; adapter pins discovered versions in its own manifest |
| PyPI `brilliant-sdk` declares no license metadata (repo is BSD-3-Clause) | License review required on change (registry flag); flag to human before any vendored use |
| Prompt injection via upstream release notes/docs | Watcher treats all upstream text as inert data; bounded diffs; fixed schema; hostile-content tests in CI |
| Consumer glasses in industrial spaces (privacy, certification) | Capability model carries `industrial.*`/`privacy.*` states; `unknown` never coerced to `false`; no hazardous-location claims |
| Feature creep into control writes | Read-only hard gate; any write path requires a new PRD + safety architecture (PRD §4.5) |
| Parallel-platform drift | This ADR's reuse map is the contract; reviewers reject new duplicates (mira-architecture-guardian skill) |
