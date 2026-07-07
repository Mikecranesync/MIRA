# Drive-Pack Scientific Grade — durapulse_gs10

Generated: 2026-07-07

## Grade: **D — 60.0/100** (INCOMPLETE)
_Research only_

**Promotion:** NOT PROMOTABLE — 1 unresolved critical failure(s) must be fixed first.

## Pack
- pack_id: `durapulse_gs10`
- manufacturer / series: AutomationDirect / DURApulse GS10
- schema_version: 2

## Hard gates
- ✅ **schema_validity** — schema OK (schema_version=2) — 10 fault codes, 1 parameters
- ✅ **runtime_compatibility** — pack loads + validates through the runtime drive_packs loader
- ✅ **provenance_present** — provenance.items present with valid tiers

## Category scores (weighted average over gradeable categories)

| Category | Weight | Score |
|---|---:|---:|
| Manual provenance and traceability | 10 | 50.0 |
| Fault coverage and precision | 20 | N/A |
| Fault field accuracy | 20 | N/A |
| Parameter coverage and precision | 20 | N/A |
| Parameter field accuracy | 15 | N/A |
| Relationship accuracy | 10 | N/A |
| Citation fidelity | 15 | N/A |
| Safety and technician usability | 10 | 70.0 |

**Manual provenance and traceability** (50.0):
- provenance.sources missing page+excerpt evidence

**Fault coverage and precision** (N/A):
- no gold set for this pack

**Fault field accuracy** (N/A):
- no gold set for this pack

**Parameter coverage and precision** (N/A):
- no gold set for this pack

**Parameter field accuracy** (N/A):
- no gold set for this pack

**Relationship accuracy** (N/A):
- no gold set for this pack

**Citation fidelity** (N/A):
- manual not available — citation fidelity could not be measured

**Safety and technician usability** (70.0):
- parameter_id 'P09.03': does not match ^[APCTBDapctbd]\d{2,3}$ or is a fault id
- parameter 'P09.03': related_faults entry 'CE10' does not match ^F\d+$

## Key metrics
- Fault recall: N/A
- Fault precision: N/A
- Parameter recall: N/A
- Diagnostic-critical precision: N/A
- Citation accuracy: N/A

## Critical failures
- ❌ domain hard violation(s): domain rules: 2 violation(s)

## Missing evidence
- gold set (author gold/<family>/gold.json) — coverage/accuracy unscored
- source manual PDF — citation fidelity unscored

> COMPLEMENTS the beta/trusted trust-status (grade.py); does not replace it.
