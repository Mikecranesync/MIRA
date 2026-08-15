# ADR-0035: CV-101 Identity Contract — canonical key, display name, and operational UNS path

- **Status:** Accepted (Mike, 2026-08-14)
- **Date:** 2026-08-14
- **Scope:** the **one** physical CV-101 rig. Not a template for other assets or future
  customer deployments.
- **Supersedes:** the unmerged `0034-canonical-asset-identity-discharge-conveyor.md` on branch
  `docs/magic-box-001-phase0`, which reused an ADR number already taken on `main` by
  `0034-native-mobile-static-capacitor-client.md`. Its decisions are carried forward verbatim
  below; that file is withdrawn rather than merged.
- **Inputs:** issue #3233; the 2026-08-14 read-only prod measurement (db-inspect run
  `31773087124`); `tools/seeds/approved_tags_conveyor.sql`;
  `tests/test_conveyor_allowlist_parity.py`; `ignition/project/approved_tags.json`.

## Context

One physical rig (Micro820 + GS10 on a belt conveyor) is addressed under several names, and a
prior session found at least six distinct UNS paths for it across the repo and production.
Issue #3233 asked whether production telemetry — which lands under
`enterprise.home_garage.conveyor_lab.conveyor_1` — was landing under a "wrong" identity that
should be corrected before live telemetry resumed.

Investigation showed the premise was not safe to act on: **no canonical `uns_path` had ever
been decided.** The prior ADR settled the canonical asset *key* and the *display name* and was
explicit that it did so through `kg_entities` (`entity_id` / `name` / `properties`). It said
nothing about `uns_path`. Correcting production to a "canonical" path would therefore have
meant inventing one under a production authorization.

This ADR closes that gap by making the existing operational path canonical, and by stating the
identity layers so they cannot conflict again.

## Decision

### 1. The identity contract

| Layer | Value | Where it lives |
|---|---|---|
| **Canonical asset key** | `cv_101` | `kg_entities.entity_id` |
| **Human display name** | `Discharge Conveyor` | `kg_entities.name` |
| **Canonical operational UNS path** | `enterprise.home_garage.conveyor_lab.conveyor_1` | `approved_tags.uns_path`; stamped onto `tag_events` / `live_signal_cache` at ingest |
| **Ingest source** | `cv101-bench-gw` | `tag_events.source_connection_id` |
| **Informal alias** | "garage conveyor" | prose only — never persisted |
| **Presentation alias** | `CV-200` / `discharge_conveyor_cv200` (Northwind surface) | display + `kg_entities.properties` |

### 2. The UNS path is a routing identity, not the asset identity

The canonical operational UNS path is a **compatibility-sensitive telemetry-routing
identity**. It does **not** replace, and is not interchangeable with, the canonical asset key
or the display name.

### 3. Everything still resolves inward to `cv_101`

Any surface accepting an asset reference — chat text, Ignition `asset_context`, QR deep-link,
ingest payload, API — resolves aliases to `cv_101` **before** canonical asset identity is
persisted.

**Never persist, where the canonical asset key belongs:** the display name
("Discharge Conveyor"), the informal alias ("garage conveyor"), the gateway name
(`cv101-bench-gw`), or the UNS path. Doing so is a bug.

### 4. Scope

This decision covers **CV-101 only**. `enterprise.home_garage.conveyor_lab.conveyor_1` is
**not** proposed as the shape for other assets or for customer deployments. It is the
established path for this rig, and that is the entire reason it is canonical.

## Why the existing path is retained rather than "cleaned up"

**It is an established integration contract, not an accident.**
`tools/seeds/approved_tags_conveyor.sql` — merged, dated 2026-06-07 — sets this path on **65**
rows and documents the choice in its own header. It is the single definition in code;
production's value was applied from it. `tools/seeds/approved_tags_northwind_cv200.sql`
references it as well.

**Renaming it is a coordinated migration, not a cosmetic edit.** The path is what ingest
stamps onto every row (`tag_ingest.py`, `uns_path=allowlist.get(norm)`). Changing it in one
place desynchronises production from the seed that produced it and splits new telemetry's
identity from ~23.7M rows of history — while every individual component keeps returning
plausible results. That silence is the hazard.

**Doing it hours before a physical bench test maximises blast radius** for zero operational
gain: the rig is currently non-live for an unrelated physical reason (#3161), so a rename
would buy nothing today and risk the one test that matters.

### ⚠️ A correction to the risk originally stated on #3233

The first analysis claimed a rename would "break test-pinned gateway↔relay parity, whose
failure mode is the relay rejecting the gateway's tags as `not_allowlisted`." **That mechanism
was wrong**, and is corrected here rather than quietly dropped:

- `ignition/project/approved_tags.json` (gateway side) contains **no UNS path at all** — its
  keys are `version` / `description` / `tags`. The gateway is path-agnostic.
- `tests/test_conveyor_allowlist_parity.py` pins **tag sets**, and references `uns_path`
  **zero** times.

So changing `uns_path` would *not* have tripped the parity test, and would *not* have caused
`not_allowlisted` rejections. The decision is unchanged — the real reasons are seed/production
divergence and historical discontinuity, above — but the stated mechanism is now accurate.

Measured map of where the path actually appears:

| File | Occurrences |
|---|---|
| `tools/seeds/approved_tags_conveyor.sql` | 65 |
| `.github/workflows/cv101-live-gate.yml` | 2 (an overridable default) |
| `tools/seeds/approved_tags_northwind_cv200.sql` | 1 |
| `ignition/project/approved_tags.json` | **0** |
| `tests/test_conveyor_allowlist_parity.py` | **0** |
| `tools/cv101_live_gate.py` | **0** (takes it as an argument) |

## A future ISA-95-shaped path

A path carrying the structural type markers in `uns.RESERVED_LABELS`
(`…area.…line.…equipment.…`) may be evaluated later. It is **not** a Phase-0 blocker and not a
10:00 blocker.

It may only proceed as **one atomic, separately reviewed migration** containing:

1. gateway JSON / configuration;
2. the approved-tag seed;
3. the relay allowlist (production rows, via the sanctioned workflow);
4. parity and contract tests;
5. asset-context mappings (Ignition, QR, Hub, chat);
6. compatibility / alias behaviour for the historical path;
7. a rollout **and rollback** plan.

Landing any subset alone is the failure mode this ADR exists to prevent. Tracked separately.

## Consequences

- Ingest, allowlisting, the live gate, parity tests, and ~23.7M rows of history all continue to
  agree on one path. Nothing is re-keyed.
- The 10:00 bench test is unblocked: the live gate compares **observed** telemetry against the
  **allowlisted** path rather than imposing a renamed one, so it is correct under this decision
  and would remain correct under a future migration (pass `-f expected_uns_path=…`).
- `cv_101` remains the only thing written where the canonical asset key belongs; the UNS path
  never substitutes for it.
- #3233 is resolved by this decision, not by a production write. **No production data, seed,
  gateway config, allowlist, or schema was changed.**

## Cross-references

- Issue #3233 — the question this answers.
- Issue #3161 — the separate, physical reason CV-101 is not live (bench PLC↔Ignition link).
- `tools/seeds/approved_tags_conveyor.sql` — where the path is defined in code.
- `.github/workflows/cv101-live-gate.yml` + `tools/cv101_live_gate.py` — the gate that asserts
  observed-vs-allowlisted.
- `.claude/rules/uns-compliance.md` — UNS path builders and `RESERVED_LABELS`.
