# PRD — MIRA × FactoryLM Phase 1: Read-Only Machine Evidence Handoff

**Status:** Ready to build
**Amended 2026-08-02** — verified against the real ingest contract on `origin/main` before any code was written. Every symbol and file this PRD names exists as described. Four corrections are inlined below and marked *Amended 2026-08-02*: (1) `source_system` must be `plc_bridge`, since `factorylm-plc-modbus` is rejected by `VALID_SOURCE_SYSTEMS`; (2) the envelope→canonical-batch field mapping is now specified, because `machine_state` / `active_conditions` had nowhere to go yet are required to build a `LiveStateOverlay`; (3) seeding `approved_tags` is a **prerequisite** of PR 3 — the allowlist is fail-closed, so without it a valid snapshot yields `accepted=0` and an empty overlay; (4) PR 4 reads state back at turn time, because the relay persists rather than carrying a request-scoped snapshot. The preflight's "stop if no ingress exists" contingency **does not fire** — the ingress exists and is mandatory.
**Objective:** Make FactoryLM's canonical PLC snapshot available to MIRA's existing audited technician context as read-only live evidence, without creating a second runtime schema, a second relay, or any plant-control capability.

## Product outcome

A technician asking MIRA about a machine can receive a grounded answer that uses FactoryLM's current canonical PLC values. The same live evidence must be present in:

1. the technician prompt projection;
2. the `TechnicianContext` manifest/audit payload; and
3. the deterministic evidence rendering path.

The system must remain safe if no snapshot is available, stale, malformed, unauthorized, or unavailable.

```mermaid
flowchart LR
  F["FactoryLM PLC Modbus canonical snapshot"] --> C["Versioned snapshot envelope read-only"]
  C --> I["Existing authorized MIRA ingress"]
  I --> A["MIRA adapter"]
  A --> L["LiveStateOverlay"]
  L --> T["TechnicianContext.live"]
  T --> P["Prompt projection and manifest: same context object"]
```

## Scope

Build the first vertical slice only:

- FactoryLM emits a versioned, canonical, read-only machine snapshot.
- MIRA converts the snapshot into the existing `LiveStateOverlay`.
- MIRA adds the overlay to the existing `TechnicianContext.live` field.
- MIRA renders and audits that same context object.
- Tests prove mapping, isolation, tenant-boundary behavior, fail-open diagnosis, and no duplicate live-data prompt blocks.

This work is intentionally split into independently reviewable PRs. Do not bundle FactoryLM bugs, transport changes, MIRA context changes, security remediation, CMMS SSO, training, or production deployment into one branch.

## Non-goals

Do not do any of the following in this phase:

- Create a new MIRA context schema, alternate evidence model, or second "agent brain."
- Add LangChain, a new orchestration framework, or new cloud dependencies.
- Write to PLCs, Modbus registers, SCADA, MES, CMMS, or the knowledge graph.
- Add a MIRA-side socket client that polls FactoryLM directly.
- Create an unauthenticated HTTP endpoint, custom secret store, or committed `.env` file.
- Change FactoryLM's shared dirty checkout or overwrite an existing PR branch.
- Rework MIRA PR #3046, merge PRs, deploy to production, or rotate credentials.
- Implement FactoryLM CMMS SSO remediation (#192), MIRA security work (#2989/#3038), LoRA training, recovery flows, or visual/spatial evidence work.
- Promote candidate UNS paths to confirmed asset identity automatically.

## Existing architecture to preserve

MIRA already has the canonical evidence spine:

- `materialized_evidence/context_contract.py`
  - `LiveTag`
  - `LiveStateOverlay`
  - `TechnicianContext.live`
  - `live_overlay_from_machine_packet(packet)`
- `mira-bots/shared/technician_context.py`
  - `build_turn_context(...)`
  - `manifest_of(...)`
  - prompt projection helpers
- `mira-bots/shared/engine.py`
  - `_build_prior_decisions_context(...)`
  - `_context_manifest` carrier, which ensures the audited manifest represents the same context used for prompting
- `mira-bots/shared/live_snapshot.py`
  - read-only snapshot normalization and rendering

FactoryLM already has canonical PLC work to reuse:

- Existing draft PR #188, “Map PLC canonical tags for Hub UNS”
- `services/plc-modbus/src/factorylm_plc/modbus_tag_source.py`
  - `canonical_tag_name(...)`
  - `canonical_tags_from_snapshot(...)`
  - `ModbusTagSource.tick()`
- Existing canonical tag vocabulary includes:
  - `conv_simple.motor_run`
  - `conv_simple.vfd_speed_hz`
  - `conv_simple.vfd_current_amps`
  - `conv_simple.fault_code`
  - `conv_simple.comm_ok`
  - `conv_simple.height_sensor_mm`
  - `conv_simple.sort_divert_active`

**Doctrine:** ADR-0033 remains authoritative: one technician policy, many typed evidence producers. FactoryLM is an evidence producer, not a parallel MIRA runtime.

## Required preflight

Before editing code:

1. Read both repositories' `AGENTS.md`, MIRA `wiki/hot.md`, ADR-0033, and the MIRA unification PRD.
2. Fetch both remotes and compare every work branch against `origin/main`.
3. Do not use `/Users/charlienode/factorylm` for edits if it remains dirty or user-owned. Create a fresh worktree from `origin/main`.
4. Inspect live GitHub state before relying on prior PR claims:
   - MIRA #3046 is an incident/recovery dependency for live proof. Do not edit its branch.
   - FactoryLM #188 is an old draft; inspect and rebase before treating it as current.
   - FactoryLM #161 is a separate PLC-model correctness defect. Fix it independently before relying on affected VFD fields.
5. Search both repositories for an existing authenticated MIRA ingress for equipment status, relay data, or MQTT snapshots. Reuse it if it can carry this data safely.
6. If no existing ingress supports this payload, stop after the contract and fixture PRs. Report the gap; do not create a second relay or an unauthenticated endpoint.

Use fresh branches such as:

- `codex/mira-factory-snapshot-contract`
- `codex/factory-plc-snapshot-contract`
- `codex/mira-factory-snapshot-ingress`
- `codex/mira-factory-live-context`

Do not push, open PRs, merge, deploy, change GitHub labels, or modify production configuration without explicit approval.

## Contract: `factorylm.machine-snapshot.v1`

Create one shared JSON fixture and specification. The fixture is the compatibility boundary between repositories; both projects must test against the exact same payload.

```json
{
  "schema_version": "factorylm.machine-snapshot.v1",
  "snapshot_id": "uuid-or-stable-source-id",
  "source_system": "plc_bridge",
  "captured_at": "2026-08-01T12:00:00Z",
  "tenant_id": "required-mira-tenant-id",
  "asset": {
    "source_record_id": "factorylm-machine-id",
    "proposed_uns_path": "Enterprise/Site/Area/Line/conv_simple"
  },
  "machine_state": "running",
  "active_conditions": [],
  "tags": [
    {
      "tag_path": "conv_simple.vfd_speed_hz",
      "value": 32.5,
      "quality": "good",
      "observed_at": "2026-08-01T12:00:00Z"
    }
  ],
  "provenance": {
    "producer": "factorylm-plc-modbus",
    "gateway_id": "edge-gateway-id",
    "source_snapshot_ref": "source-specific-opaque-reference"
  }
}
```

> **Amended 2026-08-02 — verified against the real ingest contract.** `source_system` was
> originally `"factorylm-plc-modbus"`. `tag_ingest.ingest_batch` validates against
> `VALID_SOURCE_SYSTEMS = {"ignition", "plc_bridge", "relay", "simulator"}`
> (`mira-relay/tag_ingest.py:59`) and raises `invalid_source_system` on anything else, so that
> value would have been rejected at the door. `plc_bridge` is semantically exact, and widening
> the vocabulary at the single enforcement point to accommodate one producer is the wrong
> trade. The FactoryLM identity moves to `provenance.producer`, where it belongs.
> `simulated` provenance is derived from `source_system` alone (`simulated = source_system ==
> "simulator"`), so a `plc_bridge` snapshot is correctly treated as real telemetry and can
> never be clobbered by a simulated cache row.

### Contract rules

- `schema_version`, `snapshot_id`, `captured_at`, `tenant_id`, and `tags` are required.
- `tenant_id` must be authenticated and authorized by the existing ingress. Never default it, infer it, or accept it from an untrusted caller without validation.
- `tag_path` must be a canonical FactoryLM tag name; raw register numbers and arbitrary caller-defined paths are rejected or recorded as unknown, never silently remapped.
- `quality` must normalize to MIRA's existing live quality/freshness vocabulary.
- `proposed_uns_path` is provenance only. It is not a confirmed MIRA asset identity and must not create or mutate a KG/UNS record.
- Preserve source timestamp and provenance. Do not invent freshness.
- Invalid input produces no live overlay for that turn; diagnosis must still answer normally.
- The payload contains observation data only. No command, write, actuator, or control field is permitted.

### Envelope → canonical batch mapping (amended 2026-08-02)

The envelope above is the **producer's** shape. It is NOT the shape the ingress accepts. The
canonical batch is `{source_system, tags[], tenant_id?, source_connection_id?}`
(`build_ingest_batch`) whose entries are `{tag_path, value, value_type, quality, ts?,
equipment_entity_id?, metadata?}` (`build_tag_entry`). Everything else in the envelope has
**no home** in that shape — and two of those fields (`machine_state`, `active_conditions`)
are *required* to construct a `LiveStateOverlay`. Losing them silently would produce an
overlay that renders as "unknown state" forever while every tag looked healthy.

**Decision:** snapshot-scoped fields ride in per-tag `metadata` under a single
`factorylm_snapshot` key, carried verbatim by `TagEventRow.metadata` and read back on the
serving path. `value_type` is derived by the producer (`bool`/`int`/`float`/`string`/`enum`);
an unrecognized type is rejected at `ingest_batch`, not coerced.

| Envelope field | Where it goes |
|---|---|
| `tags[].tag_path` / `value` / `quality` | `build_tag_entry` positional + kwargs |
| `tags[].observed_at` | `ts` |
| `machine_state`, `active_conditions`, `snapshot_id`, `captured_at`, `schema_version`, `provenance`, `asset.proposed_uns_path` | `metadata.factorylm_snapshot` |
| `tenant_id` | **never in the body** on the HMAC path — the `X-MIRA-Tenant` header is authoritative |
| `asset.source_record_id` | `equipment_entity_id` **only if** it is a real MIRA entity id; otherwise `metadata` |

`quality` has two vocabularies and they are not the same: the ingest contract validates
`{good, bad, stale, uncertain}` and **downgrades an unknown value to `uncertain`** rather than
rejecting it; `LiveTag.freshness` is the `Freshness` enum `{live, stale, simulated, unknown}`.
Map explicitly at the adapter. Never let an unknown quality become `good` — the downgrade
direction must always be toward less confidence.

### The allowlist is fail-closed — seeding is a prerequisite, not a detail (amended 2026-08-02)

`ingest_batch` normalizes each `tag_path` with `normalize_tag_path` and **rejects any tag not
present in `approved_tags` for that tenant + source_system** (`reason="not_allowlisted"`).
There is no permissive mode. Until the seven canonical tags are seeded, a perfectly valid
snapshot is accepted with `accepted=0` and every tag in `rejected` — the handoff would look
wired end-to-end and deliver nothing.

Normalization collapses `/`, `.`, and `:` to `_`, so `conv_simple.vfd_speed_hz` must be seeded
as `conv_simple_vfd_speed_hz`. Precedent to copy rather than reinvent:
`tools/seeds/approved_tags_conveyor.sql`, `tools/seeds/gen_approved_tags_simulator.py`,
migration `035_approved_tags.sql`. The seed also carries the `uns_path` that
`ingest_batch` resolves onto each row — which is where real UNS identity comes from, **not**
from the envelope's `proposed_uns_path`.

## Work packages and PR boundaries

### PR 1 — MIRA contract adapter and shared fixtures

**Goal:** Accept the versioned FactoryLM envelope in pure Python and convert it to the existing `LiveStateOverlay`.

Implement:

- A small pure adapter adjacent to `live_overlay_from_machine_packet(...)` in `materialized_evidence/context_contract.py`.
- The adapter validates `factorylm.machine-snapshot.v1`, constructs the existing MachineContextPacket-compatible shape, and then reuses `live_overlay_from_machine_packet(...)`.
- Do not duplicate `LiveTag`, freshness mapping, or rendering logic.
- Add a shared fixture under a neutral contract/fixture location that FactoryLM can consume unchanged.
- Add a companion invalid fixture for missing tenant, missing timestamp, invalid schema version, and malformed tags.
- Extend `build_turn_context(...)` with an optional, explicitly supplied live packet/overlay input. It must populate the existing `TechnicianContext.live` field only after validation.

> **Amended 2026-08-02 — prefer the `augment_with_*` shape.** #3041 landed the retrieval family
> as a **separate** `augment_with_retrieval(ctx, chunks)` in `mira-bots/shared/technician_context.py`
> rather than as another `build_turn_context` parameter, because retrieval evidence does not exist
> yet at the engine seam where the context is first assembled. Live state has the same property
> (the snapshot is read back at answer time, not at assembly time), so an `augment_with_live(ctx,
> packet)` that re-validates and returns `(combined_ctx | None, violations)` matches the
> established precedent, keeps `build_turn_context`'s signature from growing per evidence family,
> and re-manifests once. Take that shape unless there is a concrete reason not to. Either way the
> rule is unchanged: ONE context, ONE manifest, no second assembly site.

Acceptance tests:

- Good snapshot maps canonical tags, state, timestamp, quality, and active conditions correctly.
- Stale/unknown quality does not become `good`.
- Invalid/missing fields result in no live overlay and a non-fatal violation.
- Manifest includes the same `live` payload used to render the prompt.
- With the contract flag off, current behavior is byte-for-byte unchanged.
- No network calls, hardware handles, or fieldbus writers are imported or invoked.

### PR 2 — FactoryLM canonical-source correctness

**Goal:** Make FactoryLM's canonical snapshot source reliable before any handoff.

Implement only after inspecting the current state of FactoryLM issue #161 and PR #188:

- Fix #161 as an isolated bug-fix PR if named VFD/register data is actually missing from the current source model.
- Rebase and test the canonical mapping work from #188 in a clean branch/worktree.
- Generate `factorylm.machine-snapshot.v1` from canonical tag output; do not publish it remotely yet.
- Validate that the shared MIRA fixture can be generated/consumed without semantic changes.

Acceptance tests:

- A normal snapshot produces all required canonical tags.
- A faulted/comms-lost snapshot preserves `fault_code` and `comm_ok=false`.
- Tag names, values, timestamps, and quality are deterministic.
- The FactoryLM-produced fixture exactly matches the MIRA consumer contract.
- No write-capable Modbus method is called in the snapshot path.

### PR 3 — Existing-ingress integration only

**Goal:** Deliver the envelope through an existing, authorized MIRA transport.

> **Amended 2026-08-02 — the ingress was located; this contingency does not fire.** The
> established path is `POST /api/v1/tags/ingest` → `mira-relay/relay_server.py::tags_ingest`
> (HMAC via `_authenticate_http`; the HMAC tenant is authoritative and a body `tenant_id` is
> honored only on the non-HMAC dev/bench path) → `mira-relay/tag_ingest.py::ingest_batch`.
> It is not merely available, it is **mandatory**: `.claude/rules/one-pipeline-ingest.md`
> forbids any transport from defining its own normalizer, allowlist, persistence, batch shape,
> or enforcement path, and `tests/test_architecture.py` Contract 5 fails the build on a
> violation. So "add a small FactoryLM endpoint" is not a fallback option — the work is to
> decode the envelope and call `build_tag_entry` → `build_ingest_batch` → `ingest_batch`,
> exactly as `simlab/publishers.py::RelayIngestPublisher` already does.

If a suitable ingress exists:

- **Seed `approved_tags` first** (see § "The allowlist is fail-closed"). This is a prerequisite of PR 3, not a follow-up: without it the integration returns `accepted=0` and every acceptance test below passes vacuously against an empty overlay. Assert `accepted == len(tags)` and `rejected == []` explicitly, so a missing seed fails loudly instead of looking like success.

- Add the smallest authenticated, tenant-scoped route/topic mapping required for this envelope.
- Use existing Doppler-managed credentials and existing authorization patterns.
- Rate-limit/deduplicate snapshots using existing project conventions.
- Preserve snapshot metadata without adding a new general-purpose persistence system.
- Do not connect the MIRA diagnosis engine directly to FactoryLM.

Acceptance tests:

- Authorized simulated FactoryLM publisher succeeds.
- Wrong-tenant or unauthorized publisher is denied.
- Malformed payload is rejected without affecting live diagnosis.
- Duplicate snapshot behavior is deterministic.
- No secrets are logged.
- No plant writes occur.

### PR 4 — MIRA live-context serving path

**Goal:** Make received FactoryLM evidence visible in the technician's single context path.

> **Amended 2026-08-02 — the snapshot is READ BACK at turn time, not carried inline.**
> `ingest_batch` is a **persistence** path: it appends to `tag_events` and upserts
> `live_signal_cache`. It does not hand a request-scoped object to the engine, and the ingest
> POST and the technician's turn are unrelated requests, usually seconds to minutes apart. So
> PR 4 reads current state for the turn's asset at answer time and builds the overlay from
> that — it must **not** try to thread the accepted snapshot through from the ingress.
> Consequences to honor: freshness comes from the stored `event_timestamp` (never `now()`),
> a cache row older than the staleness bound maps to `Freshness.STALE` rather than being
> dropped silently, and a `simulated` row must never be presented as real telemetry.

Implement:

- Wire the accepted snapshot from the established ingress/state carrier into `build_turn_context(...)`.
- Use `TechnicianContext.live`; do not add a competing “FactoryLM context” prompt block.
- Preserve the existing legacy `_build_live_data_context(...)` behavior when no FactoryLM overlay exists.
- When the FactoryLM overlay is present, ensure the answer does not render a duplicate or contradictory legacy live-data block.
- Keep the path flag-gated and fail-open: any intake or contract error returns an ordinary answer without live evidence.

Acceptance tests:

- Flag off: no behavior change.
- Flag on with a valid snapshot: prompt and `_context_manifest` contain the same live overlay.
- Flag on with no snapshot, stale snapshot, or invalid snapshot: normal diagnosis still completes.
- A FactoryLM snapshot does not create duplicate `[LIVE EQUIPMENT STATUS]` content.
- Decision-trace/audit manifest hash changes only when the actual context changes.

### PR 5 — Controlled integration proof

This is a separate verification PR/runbook update, not an implementation bundle.

Required proof:

1. FactoryLM simulated canonical snapshot.
2. Existing authorized MIRA ingress accepts it.
3. MIRA builds `TechnicianContext.live`.
4. Prompt projection and saved manifest agree.
5. A diagnostic answer uses the live evidence with timestamp/quality caveats.
6. A malformed/unauthorized/stale control case fails safely.
7. No external PLC, CMMS, KG, or control write occurs.

Do not call this “production proven” until MIRA #3046 is resolved, the relevant branches are current with `origin/main`, required CI is green, and a supervised live probe succeeds.

## Global engineering constraints

- Follow MIRA's Apache/MIT-only dependency rule and existing container/deployment conventions.
- Secrets are Doppler-managed only; never inspect, print, commit, or copy secrets.
- Use TDD: add a failing focused test, run it, implement the minimum change, rerun focused tests, then run the relevant suite.
- Keep commits conventional and small.
- Before any new helper or module, search both repositories and `origin/main` for equivalent code.
- Preserve separation between read-only evidence capture and human-approved plant/KG actions.
- Treat GitHub `DIRTY`, `BEHIND`, missing checks, or stale green checks as not merge-ready.
- Run one deployment-affecting change at a time. Re-check live state after deployment; back-to-back MIRA deploy smokes can collide.

## Definition of done for Phase 1

Phase 1 is complete only when:

- A shared v1 fixture passes in both repositories.
- FactoryLM emits canonical, read-only snapshot data.
- MIRA maps it into the existing `TechnicianContext.live`.
- Prompt and audit manifest reflect one identical context object.
- Invalid, stale, unauthorized, and absent data fail safely without preventing a diagnosis.
- Focused tests and relevant suites pass from fresh branches based on current `origin/main`.
- The integration proof is documented, reproducible, and does not overstate production verification.

## Required handoff after each PR

Report:

- exact base/head commits;
- changed files and reason for each;
- tests run and their results;
- live GitHub merge/check status;
- any dependency still blocked; and
- whether the PR is code-ready, integration-ready, or live-proven.

Do not describe a branch as merge-ready unless it is current with `origin/main`, non-draft, has required checks, and has no unresolved deployment or integration blocker.
