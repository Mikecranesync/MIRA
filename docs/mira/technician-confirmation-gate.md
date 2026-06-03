# Technician Confirmation Gate (connector context)

**Status:** Phase 6 — connector-originated confirmation gate shipped (this PR)
**Code:** `mira-connectors/mira_connectors/confirmation_gate.py`, `store.py`, `service.py`
**Companion:** `docs/mira/connector-framework.md` (Phase 3 — how external data becomes canonical records)

---

## 1. What already exists (don't reinvent)

MIRA already has the *confirmation* discipline in three places. This phase extends them to
**connector-originated data**; it does not replace them.

| Existing piece | Where | What it does |
|---|---|---|
| **UNS Location-Confirmation Gate** | `mira-bots/shared/engine.py` (`_should_fire_uns_gate`) | A technician's *chat* turn must confirm site/area/line/asset before troubleshooting (TOO Invariant #7; `.claude/rules/uns-confirmation-gate.md`). |
| **`ai_suggestions`** | Hub mig 027 | The broad `/proposals` work queue. Six `suggestion_type`s incl. `kg_edge` + `kg_entity`. Already has `proposed_by='import:<format>'` and a `pending→accepted/rejected/deferred/superseded` lifecycle. |
| **`relationship_proposals` + `relationship_evidence`** | Hub mig 018 | Edge proposals with `created_by='import'`, confidence, status, and 1..N evidence rows (incl. `evidence_type` `work_order`/`tag_list`/`manifest`/`oem_kb`/`human_observation`). |
| **`/api/proposals/[id]/decide`** | `mira-hub/src/app/api/proposals/[id]/decide/route.ts` | The Hub "verify/reject" action: on verify it sets `relationship_proposals.status='verified'` **and** upserts `kg_relationships` (dedupe on tenant+source+target+type). |
| **ADR-0017** | `docs/adr/0017-*.md` | The canonical status mapping across the three tables. |

**The key discovery:** the schema was *built* to accept imported, human-confirmed data
(`created_by='import'`, `evidence_type='work_order'|'tag_list'|...`, `proposed_by='import:…'`).
The connector gate uses these tables directly. **No new tables.**

---

## 2. The connector confirmation workflow

```
1. A connector imports + normalizes external data         (Phase 3: connector framework)
2. MIRA proposes asset / component / location / tag        →  ai_suggestions (kg_entity, pending)
   + relationship mappings                                 →  relationship_proposals (proposed)
                                                               + relationship_evidence
                                                               + ai_suggestions (kg_edge, pending)
3. Each proposal shows its SOURCE EVIDENCE                  →  the CMMS asset id, the SCADA tag
                                                               path, the manual page, the prior WO
4. A technician CONFIRMS, CORRECTS, or REJECTS             →  gate.confirm / correct / reject
5. Confirmed mappings are written to the graph             →  kg_entities / kg_relationships (verified)
6. Troubleshooting can begin                               →  the engine now reads verified context
```

Nothing reaches `kg_entities` / `kg_relationships` until step 4. This is TOO Invariant #4
("promotion to `verified` is a human action") applied to connector imports, and Invariant
#7 ("confirmation over guessing") applied to *where things are* in the namespace.

---

## 3. Status mapping (ADR-0017 — enforced by the gate)

| Action | `ai_suggestions` | `relationship_proposals` | `kg_*` |
|---|---|---|---|
| Connector proposes | `pending` | `proposed` (`created_by='import'`) | — |
| Technician **confirms** | `accepted` | `verified` | write/upsert `kg_entities` or `kg_relationships` (`approval_state='verified'`) |
| Technician **corrects** | `superseded` | `deprecated` | (a *new* proposal → `verified`) |
| Technician **rejects** | `rejected` | `rejected` | (no write) |

On confirm of an edge the gate mirrors the Hub decide route exactly: proposal → `verified`,
then UPSERT `kg_relationships` deduped on `(tenant, source, target, type)`.

> **ADR-0017 helpers.** `mira_bots/shared/proposal_transition.py` and
> `mira-hub/lib/proposal-transition.ts` are specified by ADR-0017 but **do not exist yet**
> (master-plan Phase 3 / Agent 4 owns them). Until they land, the gate's transition logic
> is connector-local. When they land, `PostgresProposalStore` should delegate its status
> writes to the Python helper — this is the single intended integration point.

---

## 4. The five requirements, and how they're met

| Requirement | How |
|---|---|
| **Store who confirmed, when, evidence used** | `ai_suggestions.reviewed_by` (`human:<id>`) + `reviewed_at` + `review_note`; `relationship_proposals.reviewed_by`/`reviewed_at`; a `relationship_evidence` row of type `human_observation` records the confirmation itself. |
| **Confidence before AND after** | The connector's original confidence is preserved in `ai_suggestions.extracted_data.confidence_prior` and on `relationship_proposals.confidence` — **never overwritten**. The "after" signal is the technician's `human_observation` evidence row (`confidence_contribution = +0.4`), the schema-native way to record that a human raised confidence. |
| **Allow corrections** | `gate.correct(suggestion_id, corrections={...})` — supersedes the original, deprecates its proposal, creates a new human-authored proposal with the corrections applied, and confirms it. |
| **Preserve conflicting mappings for review** | Corrections **supersede** (don't delete) the original. When two systems propose different UNS paths for the same physical device (same `conflict_key`, e.g. serial), both are kept `pending` and tagged with a shared `conflict_group` — surfaced for a human to resolve, never auto-rejected. |
| **Use existing tables** | `ai_suggestions`, `relationship_proposals`, `relationship_evidence`, `kg_entities`, `kg_relationships`. No new tables, no new migration. |

---

## 5. API / service surface

`ConnectorConfirmationGate` (`confirmation_gate.py`) is the service function. An HTTP route
(FastAPI / Hub API) is a thin async wrapper; the methods map 1:1 onto route handlers:

```python
gate = ConnectorConfirmationGate(store)             # store: ProposalStore (Postgres or in-memory)

# Propose (read-only — nothing hits the graph)
result = gate.propose(tenant_id=..., provider="maximo", entities=[...], relationships=[...])
#   → ProposeResult(entity_suggestion_ids, edge_suggestion_ids, conflict_groups)

# Technician actions
gate.confirm(tenant_id, suggestion_id, reviewed_by="user_42", note="confirmed on the floor")
gate.correct(tenant_id, suggestion_id, reviewed_by="user_42", corrections={"target_ref": "TB2-15"})
gate.reject(tenant_id,  suggestion_id, reviewed_by="user_42", note="not real")

# Queue
gate.pending(tenant_id, suggestion_type="kg_edge")
```

One-call wiring of a connector to the gate (`service.py`):

```python
from mira_connectors import create_connector, ConnectorConfirmationGate, import_and_propose
from mira_connectors.store import PostgresProposalStore

conn = create_connector("maximo", ConnectorConfig(tenant_id=tid))
gate = ConnectorConfirmationGate(PostgresProposalStore())
res  = await import_and_propose(conn, gate, record_types=[RecordType.ASSET, RecordType.DOCUMENT])
#   imports → normalizes → derives edges → proposes everything as pending. Confirms nothing.
```

### Suggested HTTP route shape (when wired into mira-mcp / Hub)

```
POST /api/connectors/{provider}/import        → import_and_propose  → {sync_results, propose}
POST /api/proposals/{suggestion_id}/confirm   → gate.confirm        → {ok, kg_relationship_id}
POST /api/proposals/{suggestion_id}/correct   → gate.correct        → {ok, new_suggestion_id}
POST /api/proposals/{suggestion_id}/reject    → gate.reject         → {ok}
GET  /api/proposals?status=pending&type=kg_edge → gate.pending
```

Tenant id comes from the authenticated session, never from a caller argument (same rule as
the existing MCP tools and the Hub routes).

---

## 6. Persistence (`store.py`)

`ProposalStore` is a Protocol with two implementations:

- **`InMemoryProposalStore`** — deterministic, dependency-free. Backs the tests and any
  offline/dev run ("offline mode is the floor").
- **`PostgresProposalStore`** — SQLAlchemy + `NullPool` + `sslmode=require`, mirroring
  `mira-bots/shared/neon_recall.py`. Every write runs inside a transaction with the RLS
  tenant GUC set (`SET app.current_tenant_id`), exactly as the Hub `withTenantContext` does.
  The `kg_relationships` upsert mirrors the decide route's dedupe logic; `create_entity`
  upserts on the `kg_entities` natural key `(tenant_id, entity_type, name)` (mig 025/026).

  > **Not executed by the test suite.** The 53 offline tests run entirely on
  > `InMemoryProposalStore`. `PostgresProposalStore`'s SQL was **schema-verified against the
  > live migrations** (ai_suggestions 027, relationship_proposals/evidence 018, kg_entities
  > 001/010/024/025/029, kg_relationships per the decide route) but never run against a real
  > DB here. Exercise it on staging NeonDB before production use — that is the natural
  > follow-up when this gate is wired into an HTTP route.

---

## 7. Tests

`mira-connectors/tests/test_confirmation_gate.py` + `test_service.py` (offline, in-memory):

- propose → pending `kg_entity` / `kg_edge` suggestions; `confidence_prior` preserved.
- confirm entity → `kg_entities` verified + entity becomes resolvable by natural key.
- confirm edge → proposal `verified`, `kg_relationships` upserted, `human_observation`
  evidence row written, dedupe on repeat confirm.
- unresolved-at-propose edge → `endpoints_unresolved` until entities confirmed, then resolves.
- correct → original `superseded` + proposal `deprecated`, corrected edge confirmed at the
  new target; original preserved.
- reject → `rejected`, no graph write.
- conflicting mappings (same serial, different UNS path) → both preserved, `conflict_group` set.
- guards: not-found, wrong-state, tenant isolation.
- end-to-end: `MaximoMockConnector` import → propose → confirm entities → confirm edges →
  verified `kg_relationships` in the graph.

---

## 8. What this phase deliberately does NOT do

- **No engine edits.** The chat-side UNS gate in `engine.py` is untouched. This gate governs
  *connector-imported* mappings, a different entry point.
- **No `proposal_transition.py`.** That helper is master-plan Phase 3 / Agent 4's file
  (ADR-0017). The gate is designed to delegate to it once it exists.
- **No auto-verify.** Every connector-originated edge enters as `proposed` and requires a
  human action to reach `verified` (Invariant #4).
- **No plant writes.** Confirmation enriches MIRA's graph; it never writes back to a PLC,
  SCADA, or historian (`.claude/rules/fieldbus-readonly.md`, ADR-0021).
