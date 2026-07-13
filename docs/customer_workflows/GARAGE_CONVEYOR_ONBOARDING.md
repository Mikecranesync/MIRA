# Garage Conveyor Onboarding — the first real end-to-end customer workflow

**Asset:** Mike's garage conveyor (physical conveyor + GS10 DURApulse VFD + Micro820 2080-LC20-20QBB
PLC + Banner photo eye). **Tenant (demo):** `0000c0a6-0000-4000-8000-000000000001` ("Mike's Garage").
**UNS:** `enterprise.home_garage.conveyor_lab.conveyor_1`.

This is the OBD-scanner-for-factories flow: **upload evidence → approve suggested structure → connect
live data → ask MIRA — no coding.** It is built by *wiring together existing FactoryLM pieces*, not new
architecture. The novel piece added for this loop is **approval-gated retrieval** (Phase 3 below) so that
**MIRA answers only from human-approved context.**

---

## Part A — Inventory: what already exists (reuse, don't rebuild)

| Capability | State | Where (reused) |
|---|---|---|
| Upload / document ingestion | ✅ real | Hub `/api/documents/upload`, `ignition/webdev/.../api/ingest`, MiraDrop watcher |
| Nameplate / photo ingestion | ✅ real | `nameplate_worker.py` + `photo_ingest_worker.propose_from_nameplate` → `ai_suggestions` |
| Manual / spec-sheet ingestion | ✅ real | `mira-crawler/ingest/`, `mira-contextualizer/` |
| Wiring-diagram / doc ingestion | 🟡 via doc ingest | same upload path; no diagram-specific parser |
| PLC program import / parsing | ✅ real | `mira-plc-parser/` (L5X/CSV/ST), `mira-contextualizer` (real Micro820 ST bundle test) |
| Tag mapper | ✅ real | contextualizer → `tag_entities`; `tools/seeds/approved_tags_conveyor.sql` (57 real tags) |
| Contextualizer | ✅ real | `mira-contextualizer/` (deterministic extract → proposed structure) |
| Namespace tree | ✅ real (🟡 approval not surfaced) | Hub `/namespace` → `/api/namespace/tree` (ltree on `kg_entities`) |
| Knowledge graph + viz | ✅ real | Hub `/knowledge/map` (force-graph; solid=verified/dashed=proposed) |
| Proposal workflow | ✅ real | `ai_suggestions` (mig 027) + `relationship_proposals` (mig 018) |
| Approval workflow | ✅ real | Hub `/knowledge/suggestions` → `/api/proposals/[id]/decide` (only proposed→verified path) |
| Live data source connection | 🟡 real-but-CLI | `mira-relay` HTTP ingest → `tag_events`/`live_signal_cache`; Ignition `ConvSimpleLive` |
| HMI / Ignition integration | ✅ real | `plc/ignition-project/ConvSimpleLive/` (Perspective + Ask MIRA), `mira-pipeline/ignition_chat.py` |
| Retrieval pipeline | ✅ real | `mira-bots/shared/neon_recall.py` |
| **Approval-gated retrieval** | ✅ **NEW (this PR)** | `neon_recall._approval_filter_sql` behind `MIRA_ENFORCE_APPROVED_RETRIEVAL` |
| MIRA ask endpoint | ✅ real | Hub `/api/mira/ask`, `mira-pipeline ignition_chat`, bot adapters |
| Reporting / proof packet | ✅ real | `tools/proof/{run_proof,build_pdf}.py` |
| Tenant / customer setup | 🟡 SQL-only | `tenants` table; no self-serve "create customer" button yet |

The garage conveyor is **already seeded** in staging: namespace + KG (`enterprise.home_garage.conveyor_lab.conveyor_1`
+ `gs10_vfd`/`micro820_plc`/`photoeye_1`, all `approval_state='verified'`), 69 KB chunks, 57 approved tags
(`tools/seeds/{factorylm-garage-conveyor,demo-conveyor-001,approved_tags_conveyor}.sql`).

---

## Part B — The customer workflow (what Mike does)

> Today some steps are Hub-UI and some are a one-line script (see the punch list for which). The goal of
> this loop is that every step is *possible and auditable*; making each a Hub button is the follow-on work.

1. **Create / select the customer + asset project.** A `tenants` row = the customer; the asset is a
   `kg_entities` node at a UNS path. (Today: `tools/seeds/factorylm-garage-conveyor.sql` / the golden-path
   seeder provisions the tenant. Hub self-serve = punch-list.)
2. **Upload conveyor evidence:** GS10 manual, spec sheet, nameplate photos, wiring diagram, the Micro820
   PLC program export (`plc/Micro820_v4.1.9_Program.st`), the tag list (`Modbus_ConvSimple_v1.9.ccwmod`),
   and HMI/live-data details. → Hub upload / contextualizer.
3. **Run the contextualizer.** Deterministic extraction proposes the conveyor structure (no LLM).
4. **Review the proposed structure** in the Hub namespace tree (`/namespace`) and graph (`/knowledge/map`).
5. **Review proposed components:** motor, VFD (GS10), photo eye (PE-001), PLC (Micro820), I/O, fault bits,
   live tags — each an `ai_suggestion` with evidence.
6. **Approve or correct** each suggestion → `/api/proposals/[id]/decide` flips `approval_state` to `verified`.
7. **Confirm the namespace tree** and **the knowledge graph** (verified edges solid, proposed dashed).
8. **Map PLC tags to approved components** (`approved_tags_conveyor.sql` → `tag_entities`).
9. **Connect the live data source** (the Micro820 over the relay → `live_signal_cache`; or Ignition `ConvSimpleLive`).
10. **Ask MIRA** conveyor questions (Hub `/api/mira/ask` or the Perspective "Ask MIRA" panel).
11. **Generate a report / proof packet** (`tools/proof/`).

### Questions MIRA can answer once context is approved
What is this conveyor? · What components are part of it? · What PLC tags control/monitor it? · Is the photo
eye blocked? · Is it safe to discharge another pallet? · What evidence supports this mapping? · What
manuals/spec sheets are associated? · What changed recently in live data? · Generate a maintenance report.

---

## Part C — Approval-gated retrieval (Phase 3, the authoritative-context change)

**Behavior:** when the gate is on, `recall_knowledge` returns only `verified=true` chunks, so a customer's
**un-reviewed upload is not citable** until a human approves it. Proposed ≠ approved.

- **Flag:** `MIRA_ENFORCE_APPROVED_RETRIEVAL` — **default `false`** (byte-identical to prior behavior, zero
  regression). Set `true` to enforce approved-only retrieval. Read live (toggles without a restart).
- **Column:** reuses the existing `knowledge_entries.verified` (migration 001) — no new table.
- **Scope:** the four `knowledge_entries` streams (vector/BM25/ILIKE/product). `fault_codes` has no
  `verified` column (separate governance question — left ungated, documented).
- **Visibility:** every retrieved chunk now carries `verified`, so a surface can show *approved vs
  unverified* source counts.
- **MANDATORY prerequisite:** run `tools/seeds/backfill_verified_corpus.sql` first (marks the shared OEM
  library + SimLab demo corpus `verified=true`). Without it, enabling the gate drops retrieval to ~271 rows.

---

## Part D — How Mike runs the golden path

```bash
# Deterministic proof (provisions a 'Mike's garage' tenant, seeds 4 real conveyor chunks —
# 3 approved + 1 held-back unreviewed — proves gate OFF sees all, gate ON = approved-only,
# and that approving the held-back chunk makes it retrievable). Self-cleaning.
doppler run --project factorylm --config stg -- python tests/golden/garage_conveyor_golden_path.py
#   => {"verdict": "PASS", ...}

# Tests (3 offline gate-helper units + 6 NeonDB integration):
doppler run --project factorylm --config stg -- python -m pytest tests/golden/test_garage_conveyor_golden_path.py -q

# Leave the fixture seeded for a live MIRA demo (then enable the gate + ask MIRA):
doppler run --project factorylm --config stg -- python tests/golden/garage_conveyor_golden_path.py --keep
```

Golden path proof points (all PASS): evidence seeded · structure proposed · structure approved · approved
namespace tree exists · approved KG exists · tags mapped · live tags attachable · **MIRA retrieves only
approved context** · approved-source count visible · report generatable.

---

## Part E — Punch list: what still blocks Mike using this without a developer

### Demo-critical (blocks the garage conveyor workflow)
- **Done in this branch: approve-button → `verified` wiring.** `/api/proposals/[id]/decide` now marks the
  approved uploaded document's `knowledge_entries` chunks `verified=true` for `HAS_DOCUMENT` approvals, so the
  Hub approval action drives retrieval eligibility instead of requiring manual SQL.
- **Done in staging: trusted corpus backfill.** `tools/seeds/backfill_verified_corpus.sql` has been applied to
  staging for the shared OEM tenant and SimLab tenant. Prod still needs the audited workflow path before the
  gate is enabled there.
- **Ready for human test:** local Hub is serving this checkout on `http://localhost:3001/hub/` with staging
  secrets and `MIRA_ENFORCE_APPROVED_RETRIEVAL=true`; the garage fixture is left seeded under tenant
  `0000c0a6-0000-4000-8000-000000000001`.

### Usability-critical (confusing but workable)
- **Namespace tree doesn't show entity `approval_state`** (only proposal counts) — a user can't see at a
  glance what's approved. (Assessment item #3 — small projection fix.)
- **Approved-source count not surfaced in the MIRA answer** (the data is now on each chunk; needs rendering).
- **Live data source setup is relay-HTTP/CLI**, not a Hub button.
- **Tenant/customer creation is SQL** (no "New customer" screen for this flow).

### Product-critical (needed for real customers)
- Document-level approve affordance in the Hub (not just kg-edge proposals).
- Per-request tenant resolution (stop relying on the global `MIRA_TENANT_ID` env).
- Report generation from the Hub UI (today `tools/proof/` is CLI).

### Do-not-build-yet (tempting, not needed for this loop)
- MQTT / Sparkplug subscriber and any new live-data architecture (relay HTTP is sufficient).
- KG/namespace re-rendering polish, animations, theming.
- A second graph / namespace / approval / retrieval / mapper system — **all already exist; do not duplicate.**

---

## Cross-references
- `docs/proveit/ARCHITECTURE_UNIFICATION_ASSESSMENT.md` — why namespace+KG are one store; the approval gap
- `mira-bots/shared/neon_recall.py` — the gate (`MIRA_ENFORCE_APPROVED_RETRIEVAL`)
- `tools/seeds/backfill_verified_corpus.sql` — the mandatory backfill
- `tests/golden/garage_conveyor_golden_path.py` — the deterministic proof
- `tools/seeds/factorylm-garage-conveyor.sql` / `demo-conveyor-001.sql` / `approved_tags_conveyor.sql` — the seeded conveyor
- `docs/runbooks/garage-conveyor-demo.md` — the HubV3 §7 acceptance demo
