# Mission 001: technician observation state contract (Task 0)

Claim: #5088. Premise: draft PR #5086 (first-customer Level 3 plan, Tasks 0 and 5). Base for the trace: `origin/main` at `d7bf852a1`.

This note pins the canonical writer, event, projection and consumer for technician-originated machine state before Task 5 builds on it. It records what exists, what is absent and what this slice adds. It does not claim staging, device or customer acceptance.

## Trace: what existed at d7bf852a1

| Link | Present? | Where |
|---|---|---|
| Technician confirms an asset-scoped record | Fix records only | `mira-hub/src/capabilities/fix-records.ts` (`insertFixRecord`), `POST /api/equipment-notebooks/[id]/fixes`, migrations 095 to 098 |
| Retry dedupe | Yes | `client_request_id` unique index (097) plus a request fingerprint replay (098) |
| Same-transaction domain event | Yes, `fix_recorded` only | `notebook_domain_events` (111), `cmms-dispatch/enqueue.ts` |
| UNS scope on the event | Yes, a nullable snapshot | `asset_uns_path` copied from the turn's binding (081) |
| Observation record (observed time, verification, negation, correction) | **Absent** | No table or type |
| Projection of human input into machine state | **Absent** | `machine_state_window` and `machine_run` are telemetry-only (`mira-crawler/run_engine/store.py`, `mira-relay/tag_ingest.py`) |
| Event consumer other than CMMS | **Absent** | The only consumer is `cmms-dispatch/dispatcher.ts`, behind `NOTEBOOK_EVENT_DISPATCH_ENABLED` |
| Later chat answer uses technician records | **Absent** | Neither notebook chat route reads technician records. The record-fix confirmation says otherwise (#5089). |
| Customer-facing review before save | **Absent** | Record-fix uses `window.prompt` in `mira-hub/src/factorylm-ui/hub-host.tsx` |

## Decisions for this slice

1. **Canonical writer:** a new append-only record, `asset_observations`, follows the `insertFixRecord` shape exactly:
   - One `withTenantContext` transaction.
   - The insert reads the notebook row `FOR SHARE` and requires the bound, confirmed asset.
   - `ON CONFLICT (tenant_id, client_request_id) DO NOTHING`, with a fingerprint replay on retry.
   - In the same transaction it inserts one `notebook_domain_events` row with `event_type = 'observation_recorded'` and `information_status = 'technician_reported'`.
   - No delivery row: observations never dispatch to the CMMS.
2. **UNS event:** the domain event row is the typed, asset-scoped event. It carries `equipment_entity_id`, the `asset_uns_path` snapshot from the server binding, and a structured payload (fact key, value, observed time, verification method). The technician's words are never in the payload. This reuses the outbox from #5020. It is not a second ledger, and no broker is added.
3. **Projection:** `deriveObservedState` is a pure function evaluated at read time over the asset's observation rows. There is no projector table or worker, so persistence and projection cannot diverge: a crash before commit leaves nothing, and a commit is visible at once. The projector version and a `state_version` hash are returned with every read.
4. **Derivation rules (`obs-proj-1`):**
   - The newest observed report wins. A report observed earlier but recorded later stays in history.
   - A correction (`supersedes_id`) removes the superseded row from the projection but keeps it in history.
   - Opposite reports observed within 60 minutes of each other are `contested`.
   - "Repair reported" is a maintenance fact. `health`, `root_cause` and `safe_to_operate` are always `not_established` or null for human reports.
5. **Human versus machine:** observations are `self_reported` and `unverified`. They never write `machine_state_window` or tag tables, and they never count toward approved-context gate counters. In the prompt they appear under a header that says they are unverified and are not machine measurements.
6. **Access:** readback is asset-scoped. Any notebook of the same tenant bound to the same confirmed asset sees the facts and history. Turn text, thread ids and the notebook id are never returned. Other tenants see nothing because of RLS plus explicit tenant predicates.
7. **Schema authority:** the migration is proposed at `mira-hub/db/proposed/113_asset_observations.sql`, outside `db/migrations/`, so `migration-verify.yml` does not apply it to shared staging. Promotion is a `git mv` after the owner authorizes it.
8. **Flag:** `MIRA_OBSERVATION_STATE`, default off. When off, routes return 404 and chat adds nothing. When on but the table is missing (42P01), routes return 503 and chat answers without the section.

## Minimum human-evidence fields (plan Task 5) mapped

| Plan field | Column or source |
|---|---|
| Stable event or request id | `asset_observations.id`, `client_request_id`, `notebook_domain_events.event_id` |
| Server-authorized tenant and user | `tenant_id` and `recorded_by` from the session |
| Confirmed equipment id and canonical UNS path | `equipment_entity_id` (binding must be confirmed), `asset_uns_path` snapshot |
| Raw report and source reference | `raw_report`, optional `source_turn_id` (must belong to the notebook) |
| Observed and recorded times | `observed_at` (technician-confirmed, not in the future), `recorded_at` (server) |
| Typed fact, value and unit | `fact_key` (fixed vocabulary), `fact_value` (`present`, `absent`, `repaired`); no unit for these facts |
| Verification method | `verification_method`; only `self_reported` is accepted today |
| Uncertainty | `uncertainty` (`unverified`, `uncertain`) |
| Correction or supersession reference | `supersedes_id` (same tenant, asset and fact) |
| Projector version | `projector_version` on the row; `PROJECTOR_VERSION` and `state_version` on reads |

## Not covered (named blockers)

- Applying 113 to staging, and any staging trace: owner authorization is required.
- Physical Android or Pixel proof of the panel: not attempted in this slice.
- Five-technician customer acceptance: not attempted.
- Fix records feeding chat (#5089, plan Task 7): unchanged here.
