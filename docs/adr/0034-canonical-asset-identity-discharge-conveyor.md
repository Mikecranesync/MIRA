# ADR-0034: One Canonical Asset Identity per Physical Machine — "Discharge Conveyor" (`cv_101`)

- **Status:** Accepted (Mike, 2026-08-14)
- **Date:** 2026-08-14
- **Inputs:** Magic Box #001 PRD (MIRA Edge); Phase-0 reconnaissance
  (`docs/plans/2026-08-13-magic-box-001-phase0.md` §3.5); issue #3161;
  `plc/ignition-project/NorthwindBottling/README.md`.

## Context

One physical rig — an Allen-Bradley Micro820 driving an AutomationDirect GS10 VFD on a
belt conveyor — is addressed in this repo under **at least five** UNS identities:

```
enterprise.garage.demo_cell.cv_101
enterprise.garage.demo_cell.bottling_demo.cv_101
enterprise.garage.cv_101
enterprise.garage.area.demo_cell.line.conveyor_line.equipment.conveyor_001
enterprise.riverside.area.packaging.line.line1.equipment.discharge_conveyor_cv200
```

A stray `CV-100` also appears in a few documents.

This is not an accident, and the second family is not a rename. The Northwind surface was
added deliberately — `plc/ignition-project/NorthwindBottling/README.md` states it
*"**ADDS** a Northwind surface; it does **NOT repoint** the garage `ConvSimpleLive` demo.
Same physical rig, same source tag paths."* So the repo legitimately holds an engineering
identity (garage bench) and a customer-facing demo identity (Northwind Beverage /
Riverside Plant / Packaging / Line 1) for one machine.

Counts on `main`: `CV-101` in 271 tracked files, `CV-200` in 42, `Northwind` in 47. There
is no `cv_200` snake-case form. Human labels already in prose: "garage conveyor" ~120
occurrences, "discharge conveyor" ~35.

**Why this needed a decision now.** The Magic Box PRD requires that every reading preserve
asset identity and provenance, that incidents be reconstructable from local history, and
that the graph relate machine and device context. Under split identity, history can land
under one id while graph edges and documents key to another. The failure mode is
particularly bad because it is **silent**: each component still returns plausible results,
multi-hop root-cause traversal simply misses edges, and nothing errors.

## Decision

**1. `cv_101` is the canonical machine key.** All history (`tag_events`,
`live_signal_cache`), all `kg_entities` / `kg_relationships` rows, and all citations key to
it.

**2. `Discharge Conveyor` is the human name**, carried in the existing
`kg_entities.name` column. This is what MIRA says to a technician and what an HMI label
shows.

**3. Every other identifier is an alias, not an identity.** `CV-200`,
`discharge_conveyor_cv200`, `conveyor_001` and `CV-100` are recorded as aliases in
`kg_entities.properties` and resolve to the canonical key. The Northwind/Riverside UNS path
remains a valid **presentation** surface; it is not a second identity for storage.

**No schema migration is required.** `kg_entities` already separates the three concerns:

```sql
entity_id  TEXT   -- stable machine key      -> cv_101
name       TEXT   -- human name              -> "Discharge Conveyor"
properties JSONB  -- aliases + context       -> { aliases: [...], line: ... }
```

## Why `cv_101` and not `discharge_conveyor_cv200`

The live telemetry already flows under CV-101 — the ingest source is literally
`cv101-bench-gw` (per #3161). Making the Northwind id canonical would require re-keying the
live stream **and** the existing `tag_events` history, on a stream that #3161 reports as
already unstable. Choosing the id the data is already keyed to means **nothing has to be
re-keyed**; the change is additive.

`cv_101` is also the engineering truth (the bench project the rig is physically wired to),
and engineering truth is the right anchor for a store of record. The customer-facing name
belongs in the presentation layer, which is exactly what `name` + the Northwind Perspective
project provide.

## Why "Discharge Conveyor" and not "Garage Conveyor"

"Garage conveyor" is the incumbent by usage (~120 vs ~35) and would have cost nothing to
adopt. It was rejected because it names **where the machine lives rather than what it
does**. The PRD's target is an appliance a customer installs in their own control panel;
"the garage conveyor" is meaningless in that setting, whereas any maintenance technician
understands a discharge conveyor without explanation. Location belongs in the UNS path,
which already carries it.

The existing ~120 prose occurrences are **not** a migration target — they are documents and
wiki notes, and "garage conveyor" remains a perfectly good informal alias.

## Consequences

- Root-cause traversal, history and citations share one key, so multi-hop reasoning cannot
  silently miss edges through an identity split.
- The Northwind demo keeps its customer-facing framing with no forked storage.
- Alias resolution becomes a real requirement: anything accepting an asset reference
  (chat text, Ignition `asset_context`, QR deep-link, ingest payload) must resolve aliases
  to `cv_101` before writing. **A write path that stores a non-canonical id is a bug.**
- The stray `CV-100` should be retired rather than aliased once its occurrences are checked.
- This ADR governs identity only. It does **not** resolve #3161 (stale snapshot replay
  presented as `live`), which remains the separate blocker for the PRD's dual-source
  provenance gate.

## Scope

This ADR decides identity for **one** rig, deliberately. The general rule it establishes —
*one canonical machine key, one human name, everything else an alias* — should apply to the
next asset, but no other asset is being re-keyed by this decision.

## Cross-references

- `docs/plans/2026-08-13-magic-box-001-phase0.md` §3.5 — the five-identity finding
- `plc/ignition-project/NorthwindBottling/README.md` — why the second surface exists
- `.claude/rules/uns-compliance.md` — path builders and slug rules the aliases must honor
- Issue #3161 — the separate live-vs-stale provenance blocker
