# Grounding-Verification Architecture Design

**Status:** Approved for planning documentation only. This document authorizes no runtime, schema, prompt, model, or deployment change.

**Date:** 2026-07-30

## Purpose

Create one navigable visual plan for FactoryLM and MIRA's grounding-verification work without replacing the source architecture. The plan must make clear what is current, what is historical, and what is a target-state seam.

## Decisions

1. The visual hub lives at `docs/architecture/grounding-verification-master-plan.md`.
2. It links to, rather than restates, ADR-0027, ADR-0028, ADR-0029, ADR-0032, ADR-0033, the unification PRD, the Materialized Evidence inventory, C4 references, and domain architecture references.
3. Existing C4 and earlier master/integration plans remain unchanged. The hub labels older snapshots as historical or verify-before-use; it does not redraw them as deploy truth.
4. The authoritative runtime catalog is the existing `materialized_evidence/context_contract.py` contract:
   - six `TaskMode` values;
   - ten `EvidenceKind` values;
   - `TechnicianContext` as the per-answer assembly object;
   - `EvidenceManifest` as the hash-stable materialized-evidence contract it composes with, not replaces.
5. Diagrams use solid arrows for verified present interfaces, dashed arrows for target integration, and amber warning nodes for known gaps.
6. Read-only status is represented as two independent controls: context validation and tool/fieldbus execution policy. The plan records that the present action check is not a strict allowlist yet.
7. No code, test, database, prompt, model, production configuration, or existing documentation file is changed in this documentation-only slice.

## Diagram Set

The master plan contains seven Mermaid diagrams:

1. source-authority and document navigation map;
2. layered grounding-verification architecture;
3. photo-to-grounded-answer data flow;
4. product-surface and evidence-plane topology;
5. read-only enforcement boundaries;
6. current-versus-target adoption and decision-trace unification;
7. verification and learning feedback loop.

## Acceptance Criteria

- Every listed architecture reference is linked from the master plan and classified as canonical, supporting, or historical.
- The two diagrams requested for the hub are present: layered view and concrete print-photo trace.
- The plan maps every `EvidenceKind` to its current producer path or an explicitly named gap.
- The plan does not claim runtime adoption or trace unification that the source code and unification PRD still mark as pending.
- The plan has a companion implementation plan for later code work, with no implementation performed in this slice.

## Rejected Approach

Regenerating every older architecture document as a current diagram is rejected. It would multiply drift: `SYSTEM_OVERVIEW.md` and several C4 diagrams are dated snapshots, whereas the new hub needs an explicit current/historical boundary.
