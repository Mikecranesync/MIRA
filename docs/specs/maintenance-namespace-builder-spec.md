# Maintenance Namespace Builder Specification

**Version:** 1.0
**Last Updated:** 2026-05-15
**Owner:** Mike Harper / FactoryLM
**Status:** Active — primary product-surface spec for the namespace-builder direction
**Parent doctrine:** `docs/THEORY_OF_OPERATIONS.md`
**Schema canonicalization:** [ADR-0013](../adr/0013-uns-namespace-builder-schema-canonicalization.md) — Hub `mira-hub/db/migrations/` owns product-surface schema; engine `docs/migrations/` owns kg_entities / kg_relationships.

## Purpose

The contract for the **Maintenance Namespace Builder** — MIRA's user-facing product surface for turning everyday maintenance activity (photos, notes, work orders, manuals, drawings, PLC/Ignition tags) into a tenant-scoped, evidence-bound, AI-ready factory namespace.

This spec defines:

- The **UNS Location-Confirmation Gate** that anchors every troubleshooting answer.
- The **AI proposal → human-approval → namespace write** loop.
- New tables, API endpoints, and Hub UI surfaces required to make "MIRA proposes, human confirms" real instead of rhetorical.
- The **automated L0–L6 AI Readiness Score** (distinct from `factorylm.com/assess`'s manual scorecard).
- How those surfaces integrate with the existing FSM (`dialogue-state-tracker-spec.md`), KG (`knowledge-graph-spec.md`), RAG (`rag-pipeline-spec.md`), quality gate (`quality-gate-spec.md`), and scan flow (`mira-scan-spec.md`).

Read `THEORY_OF_OPERATIONS.md` first for *why*. This doc is *how*.

## Scope

### IN scope

- New module `mira-bots/shared/uns_resolver.py` + new FSM side state `AWAITING_UNS_CONFIRMATION`.
- New NeonDB tables: `ai_suggestions`, `approvals`, `wizard_progress`, `health_scores`, `qr_codes`, `namespace_versions`.
- Extensions to `kg_entities` + `kg_relationships`: `approval_state` enum, `proposed_by`, `evidence_summary`.
- New REST endpoints under `/api/v1/` (Hub-served, MCP-served).
- New Hub UI surfaces: `/onboarding`, `/namespace`, `/proposals`, `/readiness`, `/tag-import`, `/m/[assetTag]/capture`.
- Photo ingestion endpoint wiring `mira-bots/shared/workers/nameplate_worker.py` to the namespace.
- Tag-import CSV pipeline (PLC / Ignition exports → tag entities + asset proposals).
- AI extraction schemas (component, tag, namespace match, relationship proposal).
- Approval workflow + role matrix.
- Automated L0–L6 AI Readiness Score calculation + dashboard widget.

### OUT of scope (covered by sibling specs or deferred)

- **Knowledge-graph schema canonicalization** between Hub `001_knowledge_graph.sql` and `docs/migrations/004_kg_entities.sql` — separate decision; this spec assumes migration 004 + 007 (uns_path) is the canonical flavor (per CLAUDE.md).
- **Full RAG pipeline** — `rag-pipeline-spec.md`.
- **Quality gate behavior** — `quality-gate-spec.md`; this spec only adds inputs (citation-required when in `AWAITING_UNS_CONFIRMATION` path).
- **Full Ignition Java/Kotlin SDK module** — Phase 6 of execution plan, separate spec to be drafted later.
- **MQTT / Sparkplug B export** — post-MVP.
- **Cross-tenant Knowledge Cooperative** — separate spec, requires anonymization + opt-in flow.
- **Customer-facing `/assess` manual scorecard** — `dt-scorecard-spec.md`; this spec adds the *automated* counterpart, not a replacement.
- **Signup/trial wall** — covered by `manual-intelligence-self-serve-spec.md` Gap 2; onboarding wizard assumes status=`trial` lands inside the app.

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  FRONT DOORS                                                       │
│  Slack  ─┐                                                         │
│  Web Hub ├──→  Engine (mira-bots/shared/engine.py)                 │
│  Tg / m/ ─┘            │                                           │
└────────────────────────│───────────────────────────────────────────┘
                         ▼
            ┌────────────────────────────┐
            │  UNS LOCATION-CONFIRMATION │   ← Phase 1 build
            │  GATE                      │
            │  (uns_resolver.resolve_…)  │
            └─────────────┬──────────────┘
                          │ confirmed context
                          ▼
            ┌────────────────────────────┐
            │  TROUBLESHOOTING / ANSWER  │
            │  (existing engine + RAG)   │
            └─────────────┬──────────────┘
                          │ proposed edges + suggestions
                          ▼
            ┌────────────────────────────┐
            │  ai_suggestions queue      │   ← Phase 1 build
            └─────────────┬──────────────┘
                          │
                          ▼
            ┌────────────────────────────┐
            │  Hub /proposals  →  /api/v1/proposals/:id/decide
            │  Slack approval thread     │
            └─────────────┬──────────────┘
                          │ approvals row
                          ▼
            ┌────────────────────────────┐
            │  Promote kg_entities /     │
            │  kg_relationships:         │
            │  proposed → verified       │
            └─────────────┬──────────────┘
                          │
                          ▼
            ┌────────────────────────────┐
            │  health_scores recomputed  │
            │  (L0–L6 + missing list)    │
            └────────────────────────────┘
```

Containers: this spec spreads across `mira-bots` (engine), `mira-hub` (UI + Hub API), `mira-mcp` (MCP tools + ingestion endpoints), and `mira-crawler/ingest` (extraction workers). No new containers.

Per `ARCHITECTURE.md` layer rules: Hub (Presentation) calls Hub API → MCP REST proxy → Engine. Engine calls Memory + Evidence. Front doors never call the engine via different paths.

## The UNS Location-Confirmation Gate

This is the most load-bearing item in the spec. Per `THEORY_OF_OPERATIONS.md` invariant #7, no troubleshooting answer is allowed before the gate succeeds.

### State of the world (2026-05-15)

A Stage-1 gate **already exists on origin/main** and covers the **vendor / model / fault-code** scope (PRs #1220, #1280, #1295, #1314). See `docs/specs/uns-message-resolver-spec.md` for that contract. This spec defines the **additive extension** to a full plant-hierarchy gate (site → area → line → machine → asset → component → fault).

The existing implementation:
- `mira-bots/shared/uns_resolver.py` — `resolve_uns_path(message, tenant_id=None, prior_ctx=None) → UNSContext`. `UNSContext` fields cover `manufacturer`, `manufacturer_alias`, `product_family`, `model`, `fault_code`, `fault_code_raw`, `category`, `site_path` (when tenant + asset can be identified), `matched_entities`, `matched_kb_count`, `confidence` band.
- `mira-bots/shared/uns_paths.py` — dep-free path builders (mirror of `mira-crawler/ingest/uns.py`).
- `mira-bots/shared/engine.py` — calls `resolve_uns_path` in 14+ places; line 1316 contains the gate logic "UNS Confirmation Gate — no diagnosis without confirmed equipment."

### What this spec adds (Phase 1 deltas)

1. **Site / area / line / machine / asset / component resolution.** The existing `UNSContext.site_path` is populated *when a tenant + asset can be identified*; this spec strengthens that path with explicit resolution against `kg_entities` rows that have `entity_type IN ('site','area','line','machine','asset','component')` and a confirmed `uns_path` ltree.
2. **New side state `AWAITING_UNS_CONFIRMATION` in the FSM.** The existing gate fires inside the current FSM states; the new side state lets the engine pause cleanly for a confirmation reply rather than re-resolving every turn.
3. **Confirmation card format and behavior table** (below) — codifies the technician-facing UX so all adapters (Slack, Hub, Telegram) render the same card.
4. **Backstop and feature-flag discipline** — `MIRA_UNS_GATE_ENABLED` is already present in the codebase; this spec defines its semantics and the fall-back path explicitly.
5. **Citation-enforcement coupling** — after the gate confirms, the `citation_compliance.py` hook flips from observational to enforcing for that conversation thread.

### Where the extension lives

- Extend `mira-bots/shared/uns_resolver.py` — add a `resolve_location(message, tenant_id, session) → list[LocationCandidate]` helper, or extend `UNSContext` with `site`, `area`, `line`, `machine`, `asset`, `component` fields populated via `kg_entities` lookups. Decision (extend `UNSContext` vs. new helper) is the first task of Phase 1.
- Extend `mira-bots/shared/fsm.py` — add `AWAITING_UNS_CONFIRMATION` to the side-states list.
- Extend the existing gate hook in `engine.py` (around line 1316) to enter the new side state when location resolution is ambiguous (confidence < 0.85 or multiple candidates), not just when equipment is ambiguous.

### Contract

```python
from dataclasses import dataclass

@dataclass
class CandidateContext:
    site: Optional[str]
    area: Optional[str]
    line: Optional[str]
    machine: Optional[str]
    asset: Optional[str]        # canonical name + entity_id
    component: Optional[str]
    fault: Optional[str]
    uns_path: Optional[str]     # ltree, e.g. "enterprise.harper.orlando.packaging.line5.b16.photoeye.pe2"
    confidence: float           # 0.0 – 1.0
    evidence: list[Evidence]    # see below

@dataclass
class Evidence:
    source: Literal[
      "prior_session", "technician_hint", "work_order",
      "uns_path_match", "manual_reference", "plc_tag", "kg_match",
      "fault_code_table", "photo_ocr"
    ]
    ref: str          # e.g. work_order_id, kg_entity_id, manual page, tag path
    score: float      # 0.0 – 1.0

def resolve_uns_path(
    message: str,
    tenant_id: str,
    session: ConversationState,
) -> list[CandidateContext]:
    """Return up to 3 candidates ranked by confidence."""
```

### Evidence priority (highest → lowest)

1. **Prior session context** — if the FSM has a confirmed `asset_id` from a recent turn and the message looks like a follow-up ("still broken", "what about the motor"), reuse.
2. **Technician hint** — explicit site / line / asset / component mentions in the message.
3. **Work-order history** — recent WO refs that mention the same tokens.
4. **UNS path direct match** — message tokens map to an existing ltree path (`uns_path @> ltree '…'`).
5. **Manual reference** — fault code or component model number → manual ref → installed instance.
6. **PLC tag** — tag name pattern match (e.g., `Line5/B16/PE2`).
7. **KG entity name + alias match** — fuzzy on `kg_entities.name` and `properties->>'aliases'`.

### Behavior table

| Result | FSM transition | Reply |
|---|---|---|
| `len(candidates) == 0` | Stay in current state | "I don't recognize that asset yet. Can you tell me the line and machine, or share a photo of the nameplate?" |
| `len(candidates) == 1 and confidence ≥ 0.85` | Set `asset_identified=1` + confirmed context; proceed | Skip gate; reply uses asset context implicitly (one-line ack: "Looking at Line 5 / Conveyor B16 / Photoeye B16.2…") |
| `len(candidates) == 1 and 0.5 ≤ confidence < 0.85` | Enter `AWAITING_UNS_CONFIRMATION` | Confirmation card (template below) |
| `len(candidates) ≥ 2` | Enter `AWAITING_UNS_CONFIRMATION` | Confirmation card with top candidate + "or did you mean…?" alt list |
| Any state and message contains safety keyword | Existing safety path takes precedence | (gate is a no-op) |

### Confirmation card template

Following `slack-technician-ux-writer` skill — terse, mobile-readable, action-oriented.

```
I think this is:
• Site: Orlando Plant
• Line: Line 5
• Asset: Conveyor Section B16
• Component: Photoeye B16.2
• Fault: Occupied Too Long

Evidence:
• Work order #4729 mentions Line 5 B16
• UNS path matches enterprise.harper.orlando.packaging.line5.b16.*
• Drawing ENG-PL-4472 Rev C linked to this asset

Confirm? (y / different / cancel)
```

### Transitions out of `AWAITING_UNS_CONFIRMATION`

| User reply | Action |
|---|---|
| `y`, `yes`, `confirm`, `ok` | Write confirmation to `conversation_state.asset_id`; transition to next normal FSM state; emit `ai_suggestions` row of type `uns_confirmation` with `decided=true`. |
| `different`, `no`, name of a different asset | Re-run `resolve_uns_path` biased away from the current top candidate; if new candidate, show new card; if no new candidate, fall back to open question. |
| `cancel`, anything off-topic | Drop the asset context; treat next message as fresh `IDLE`. |
| Timeout (no reply within N turns of unrelated chatter) | Auto-cancel; new diagnostic prompt re-runs the gate. |

### Backstop

If `resolve_uns_path` raises or returns no candidates AND the engine would otherwise proceed to troubleshooting, fall back to the existing specificity gate behavior in `engine.py` (asks for clarification on vague references). Behind feature flag `MIRA_UNS_GATE_ENABLED` (default true after Phase 1 lands; flip to false for emergency).

### Golden cases (added to `tests/golden_factorylm.csv`)

1. **Vague:** "fault on line 5" → enter `AWAITING_UNS_CONFIRMATION` with line-only context; ask for asset/component.
2. **Clear:** "Conveyor B16 occupied too long" → confidence ≥ 0.85, skip card, proceed.
3. **Ambiguous (2 candidates):** "B16 fault" → confirmation card with top + alt.
4. **Correction:** confirmation card shown for B16; user says "no it's B17" → re-resolve; show new card.
5. **Stale resume:** previous session asked about B16, new message says "still broken" → reuse prior context, single-line ack.
6. **Safety override:** "arc flash on line 5" — safety branch fires; gate bypassed.

## Data Model

### New tables (`docs/migrations/008_namespace_builder.sql`)

All tables tenant-scoped via NeonDB RLS (`app.current_tenant_id`). All `tenant_id UUID NOT NULL`. All indexes prefixed with `tenant_id`. Use `gen_random_uuid()` for primary keys.

#### `ai_suggestions`

```sql
CREATE TABLE ai_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  suggestion_type TEXT NOT NULL,         -- 'kg_edge' | 'kg_entity' | 'tag_mapping' | 'component_profile' | 'uns_confirmation' | 'namespace_move'
  payload JSONB NOT NULL,                -- shape per suggestion_type (see AI pipeline schemas)
  evidence JSONB NOT NULL,               -- list of Evidence records
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  proposed_by TEXT NOT NULL,             -- 'llm:groq' | 'llm:cerebras' | 'llm:gemini' | 'rule:tag_pattern' | 'human:tech_hint' | 'import:ignition_csv' | …
  proposed_by_run_id UUID,               -- groups suggestions from a single ingestion job
  source_entity_id UUID,                 -- nullable; populated when modifying an existing entity
  related_uns_path LTREE,                -- nullable; for namespace_move / kg_edge anchored to a node
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,                -- nullable; suggestions left unreviewed past this drop off /proposals
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','superseded','expired'))
);

CREATE INDEX idx_ai_suggestions_tenant_status_created
  ON ai_suggestions (tenant_id, status, created_at DESC);
CREATE INDEX idx_ai_suggestions_tenant_type
  ON ai_suggestions (tenant_id, suggestion_type);
CREATE INDEX idx_ai_suggestions_uns_path_gist
  ON ai_suggestions USING GIST (related_uns_path);
```

Distinction from `kg_triples_log` (`knowledge-graph-spec.md`): `kg_triples_log` is an **append-only audit of every extraction**. `ai_suggestions` is the **work queue of items waiting for a human decision**. Both rows can exist for the same fact.

#### `approvals`

```sql
CREATE TABLE approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  suggestion_id UUID NOT NULL REFERENCES ai_suggestions(id) ON DELETE CASCADE,
  decided_by UUID NOT NULL,              -- users.id
  decision TEXT NOT NULL CHECK (decision IN ('confirm','edit','reject','needs_review')),
  decision_payload JSONB,                -- if 'edit': the edited values that were ultimately applied
  reason TEXT,                           -- optional free-text rationale
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_approvals_tenant_decided_at
  ON approvals (tenant_id, decided_at DESC);
CREATE INDEX idx_approvals_suggestion
  ON approvals (suggestion_id);
```

#### `wizard_progress`

```sql
CREATE TABLE wizard_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  step_key TEXT NOT NULL,                -- 'company' | 'site' | 'line' | 'upload_tags' | 'upload_manuals' | 'photo_walk' | 'review'
  payload JSONB NOT NULL,                -- step-specific saved state
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, step_key)
);

CREATE INDEX idx_wizard_progress_user
  ON wizard_progress (tenant_id, user_id, updated_at DESC);
```

#### `health_scores`

```sql
CREATE TABLE health_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  uns_path LTREE NOT NULL,               -- node the score belongs to ('enterprise.harper' for tenant-wide)
  level INTEGER NOT NULL CHECK (level BETWEEN 0 AND 6),
  score REAL NOT NULL CHECK (score BETWEEN 0 AND 1),
  missing JSONB NOT NULL,                -- list of {category, count, suggested_action} items
  components JSONB,                      -- sub-scores per dimension for diagnostics
  last_calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, uns_path)
);

CREATE INDEX idx_health_scores_path_gist
  ON health_scores USING GIST (uns_path);
CREATE INDEX idx_health_scores_tenant_level
  ON health_scores (tenant_id, level DESC);
```

#### `qr_codes`

```sql
CREATE TABLE qr_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  target_entity_id UUID,                 -- nullable until asset is created
  target_uns_path LTREE,                 -- nullable until namespace placement
  label TEXT,                            -- human-readable, printed
  asset_tag TEXT,                        -- the short token in the URL (/m/[assetTag])
  status TEXT NOT NULL DEFAULT 'unbound' CHECK (status IN ('unbound','active','retired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_scanned_at TIMESTAMPTZ,
  UNIQUE (tenant_id, asset_tag)
);

CREATE INDEX idx_qr_codes_tenant_status
  ON qr_codes (tenant_id, status);
```

Coexists with `mira-scan-spec.md`'s asset-tag flow; this table is the storage for QR tags that may be printed *before* their target asset exists in the namespace (the "scan unknown → create asset" path in `scan-not-found.html`).

#### `namespace_versions`

```sql
CREATE TABLE namespace_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  snapshot JSONB NOT NULL,               -- serialized tree at this point in time
  created_by UUID NOT NULL,              -- users.id
  reason TEXT,                           -- 'manual_snapshot' | 'daily_auto' | 'before_bulk_move' | ...
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_namespace_versions_tenant_created
  ON namespace_versions (tenant_id, created_at DESC);
```

Retention policy: keep daily snapshots for 30 days; manual snapshots indefinitely. Operational concern; not a hard schema constraint.

### Extensions to existing tables

```sql
ALTER TABLE kg_entities
  ADD COLUMN approval_state TEXT NOT NULL DEFAULT 'verified'
    CHECK (approval_state IN ('proposed','verified','needs_review','rejected','deprecated')),
  ADD COLUMN proposed_by TEXT,
  ADD COLUMN evidence_summary JSONB;

ALTER TABLE kg_relationships
  ADD COLUMN approval_state TEXT NOT NULL DEFAULT 'verified'
    CHECK (approval_state IN ('proposed','verified','needs_review','rejected','deprecated')),
  ADD COLUMN proposed_by TEXT,
  ADD COLUMN evidence_summary JSONB;

CREATE INDEX idx_kg_entities_tenant_state
  ON kg_entities (tenant_id, approval_state);
CREATE INDEX idx_kg_relationships_tenant_state
  ON kg_relationships (tenant_id, approval_state);
```

**Migration plan:** the `DEFAULT 'verified'` on the new column intentionally backfills existing rows as confirmed — they came from authoritative manual ingestion. New rows written by the proposal pipeline must explicitly pass `approval_state='proposed'`.

**Schema canonicalization note:** as `knowledge-graph-spec.md` Known Issues records, two KG schema flavors exist in this repo. This spec assumes the **NeonDB `docs/migrations/004_kg_entities.sql` + `007_uns_path.sql` flavor** (per CLAUDE.md). If the Hub-local `001_knowledge_graph.sql` flavor is retained, a separate consolidation migration is required before Phase 1.

## API Contract

All new endpoints are tenant-scoped via `withTenantContext` (Hub) or HMAC + tenant header (MCP / Slack). All POSTs reject without a valid JWT or HMAC.

### Hub-served (mira-hub, Next.js route handlers)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/v1/namespace/tree` | JWT | Returns the tenant's namespace tree from `kg_entities` + `kg_relationships(part_of)` rooted at the tenant's enterprise node. Supports `?depth=N&path=ltree`. |
| PUT | `/api/v1/namespace/node/:id` | JWT | Rename / move / merge a node. Body: `{name?, new_parent_id?, merge_into?}`. Move/merge requires manager role. |
| GET | `/api/v1/proposals` | JWT | Paginated list of `ai_suggestions` rows. Filters: `?status=pending&type=kg_edge&path=ltree`. |
| POST | `/api/v1/proposals/:id/decide` | JWT | Confirm / edit / reject a suggestion. Body: `{decision: 'confirm'|'edit'|'reject', edits?: {…}, reason?: string}`. Writes `approvals` row + applies edge/entity write. |
| GET | `/api/v1/readiness` | JWT | Returns `health_scores` rows for tenant. Filters: `?path=ltree`. |
| POST | `/api/v1/readiness/recalculate` | JWT | Manager-only. Re-runs the health-score calculator (default is event-driven). |
| GET | `/api/v1/wizard` | JWT | Returns all wizard steps + their payloads for the current user. |
| POST | `/api/v1/wizard/:step` | JWT | Save / complete a wizard step. Body: `{payload, completed: bool}`. |
| POST | `/api/v1/qr` | JWT | Create a QR code (unbound). Returns `asset_tag`. |
| POST | `/api/v1/qr/:id/bind` | JWT | Bind a QR code to an entity / UNS path. |

### MCP-served (mira-mcp, FastMCP + REST)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/v1/ingestion/photo` | Bearer (MCP_REST_API_KEY) | Multipart upload: image + optional `asset_hint`. Returns `ingestion_job_id` + initial `ai_suggestion_id` for the proposed component profile. |
| POST | `/api/v1/ingestion/tag-import` | Bearer | CSV upload with header `tag_path,description,data_type,units` (Ignition export shape). Returns `ingestion_job_id` + list of generated `ai_suggestions` (one per tag → asset mapping proposal). |
| POST | `/api/v1/ingestion/work-order-csv` | Bearer | CSV upload of WO history; creates `ai_suggestions` proposing asset / component links from WO text. |
| GET | `/api/v1/ingestion/jobs/:id` | Bearer | Status of an ingestion job: `pending`/`extracting`/`matching`/`proposing`/`complete`/`failed` + counts. |

### MCP tools (FastMCP, called from Slack engine + Web Hub chat)

| Tool | Purpose |
|---|---|
| `kg_search_entities(query, type?, tenant)` | Fuzzy search across `kg_entities.name` + aliases. |
| `kg_propose_edge(source_id, target_id, relation_type, evidence, confidence, tenant)` | Insert `ai_suggestions` of type `kg_edge`. Never writes directly to `kg_relationships`. |
| `kg_approve_suggestion(suggestion_id, decision, edits?, tenant, user_id)` | Records `approvals` row + applies edge/entity write if `confirm`. |
| `namespace_resolve(message, tenant, session)` | Wraps `uns_resolver.resolve_uns_path`; used by the UNS gate. |

## Hub UI Surfaces

| Route | Purpose | Reuses |
|---|---|---|
| `/onboarding` | Multi-step wizard with saved progress. Steps: company → site → line → upload tags (optional) → upload manuals (optional) → photo walk (optional) → review proposed namespace. | `UploadBlock` status pattern; existing magic-link auth flow |
| `/namespace` | Tree editor. Left pane: ltree tree. Right pane: node detail (assets / components / docs / proposed-vs-verified counts). Drag-and-drop moves within a level (manager+). | `/(hub)/assets` API; `/(hub)/knowledge` expand/collapse |
| `/proposals` | Review inbox. Filters by type + path + status. Cards include evidence list + confirm/edit/reject buttons. | `UploadBlock` (state transitions reused as visual style) |
| `/readiness` | Per-path health-score dashboard. Levels-unlock visual (L0–L6 badge). Missing-data list with "next step" CTAs. | New widget; consumed by `/feed` header |
| `/tag-import` | CSV upload + reconciliation table (proposed tag → asset mapping). | `UploadBlock` + table primitives |
| `/m/[assetTag]/capture` | Mobile QR-scan capture flow. After scan: take photo, add note, confirm or create asset. Extends existing read-only `/m/[assetTag]` landing. | `mira-scan-spec.md`; existing `m/[assetTag]/page.tsx` |

### Health-score widget on `/feed`

A new prominent widget on the dashboard (`mira-hub/src/app/(hub)/feed/page.tsx`) showing tenant-wide AI Readiness Level + one highlighted "next step" missing-data task. Click-through to `/readiness`.

## AI Pipeline

All extraction runs through the InferenceRouter cascade (Groq → Cerebras → Gemini) per CLAUDE.md. Anthropic is **not** a valid backend. Every extractor uses **structured-output JSON mode** and a JSON Schema (Pydantic / TypedDict).

### Component profile extraction (from photo)

Worker: new `mira-bots/shared/workers/photo_ingest_worker.py`, wraps existing `nameplate_worker.py`.

```python
class ComponentProfile(BaseModel):
    manufacturer: str | None
    model: str | None
    serial: str | None
    part_number: str | None
    voltage_v: float | None
    current_a: float | None
    horsepower_hp: float | None
    frequency_hz: float | None
    rpm: int | None
    component_type: Literal[
        "proximity_sensor", "photoeye", "motor", "vfd", "contactor",
        "relay", "overload", "plc_module", "valve", "encoder",
        "bearing", "gearbox", "safety_relay", "unknown"
    ]
    aliases: list[str]
    notes: str | None
    confidence: float
```

After extraction, the worker:
1. Looks up existing `kg_entities` with same (manufacturer, model) → if found, propose `installed_instance_of` edge.
2. If not found, propose new `kg_entity` of type `component_template`.
3. Optionally proposes `installed_at` edge to the inferred asset (from `asset_hint`, prior session, or UNS path match).
4. Writes one `ai_suggestions` row per proposal (entity + each edge).

### Tag classification (from PLC / Ignition CSV)

Worker: new `mira-crawler/ingest/extractors/tag_classifier.py`.

```python
class TagClassification(BaseModel):
    tag_path: str
    category: Literal[
        "signal_input", "signal_output", "fault", "alarm",
        "command", "status", "setpoint", "process_value",
        "diagnostic", "unknown"
    ]
    candidate_component_type: str | None    # e.g. "photoeye", "motor"
    candidate_line_token: str | None        # e.g. "Line5"
    candidate_asset_token: str | None       # e.g. "B16"
    suggested_uns_path: str | None
    confidence: float
```

Pipeline: classify each row → propose `kg_entity` of type `tag` + `belongs_to` edge to the inferred asset (or `needs_review` if no asset matches). One `ai_suggestions` row per tag.

### Namespace matching (string → existing node)

Worker: `mira-bots/shared/uns_resolver.py` (above). Returns `CandidateContext[]`.

### Relationship proposal (subject/verb/object)

Reuses existing triple-extractor target (per `knowledge-graph-spec.md` known issues: "triple extractor at runtime is not yet wired into the engine"). When wired, every extraction:
1. Writes to `kg_triples_log` (append-only audit).
2. If the relationship is *new* or *changes an existing edge*, also writes an `ai_suggestions` row.

```python
class RelationshipProposal(BaseModel):
    subject_id: UUID            # kg_entities.id
    relation_type: str          # 'mounted_on' | 'wired_to' | 'controlled_by' | … (controlled vocabulary from CI architecture spec line 66)
    object_id: UUID
    evidence: list[Evidence]
    confidence: float           # 0.0 – 1.0 (per CI spec scoring)
    risk_level: Literal["low","medium","high","safety_critical"]
    requires_human_review: bool
```

Safety-critical or `risk_level >= medium` proposals are pinned at `needs_review` regardless of confidence.

## Approval Workflow + Role Matrix

Roles inherit from existing user model + tenant membership. New `roles` mapping for namespace operations:

| Role | Can propose | Can confirm KG edge | Can move namespace nodes | Can promote `proposed → verified` | Can restructure | Can manage users |
|---|---|---|---|---|---|---|
| **Technician** | ✅ | ❌ (their proposals flag for lead review) | ❌ | ❌ | ❌ | ❌ |
| **Lead technician** | ✅ | ✅ (component-level at their site) | ❌ | ✅ (component edges only) | ❌ | ❌ |
| **Controls engineer** | ✅ | ✅ (PLC tag mappings + electrical edges) | ✅ (limited) | ✅ (tag + electrical) | ❌ | ❌ |
| **Maintenance manager** | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Admin** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **External consultant** | ✅ | scope-limited via project grant | ❌ | ❌ | ❌ | ❌ |

Every approval action writes `approvals.decided_by`. The actor's role at the time of the decision is captured in `approvals.decision_payload` for audit even if the user later changes roles.

## Health-Score Calculation

Event-driven by default (recompute when an `ai_suggestions` row changes status, or when a `kg_*` row is written). Manual `POST /api/v1/readiness/recalculate` available for managers.

### Levels (anchored to namespace state, not to the manual `/assess` rubric)

| Level | Threshold (per node and aggregated up the tree) |
|---|---|
| **L0** | < 1 confirmed asset under the node |
| **L1** | Company / site / area / line hierarchy confirmed under the node |
| **L2** | ≥ 80% of expected child assets are confirmed (managers can mark "expected count" per line) |
| **L3** | ≥ 60% of components have `(manufacturer, model)` + linked manual |
| **L4** | ≥ 50% of components have a linked PLC / Ignition tag (verified) |
| **L5** | ≥ 50% of recurring fault patterns have linked WOs + linked component + linked manual/section |
| **L6** | ≥ 6 months of WO history aggregated + downtime / parts patterns surface in `/feed` |

### Score (continuous, 0.0 – 1.0)

Score is the **fractional progress toward the next level**, computed from the same per-dimension counts that pin the level. Stored in `health_scores.score`. The `missing` JSONB holds the prioritized list of what would lift the score:

```json
[
  {"category": "components_without_model", "count": 12, "next_action": "Take photos of motor nameplates on Line 5"},
  {"category": "missing_manuals", "count": 7, "next_action": "Upload VFD manuals (model: PowerFlex 525)"},
  {"category": "unmapped_tags", "count": 41, "next_action": "Run tag-import wizard with your Ignition CSV"},
  {"category": "unconfirmed_proposals", "count": 23, "next_action": "Review 23 pending proposals in /proposals"}
]
```

Sales-relevant rendering: the `next_action` strings are also the CTAs that drive consulting upsell on the marketing site.

## Configuration

| Var | Required | Purpose | Default |
|---|---|---|---|
| `MIRA_UNS_GATE_ENABLED` | yes | Feature flag for the UNS Location-Confirmation Gate | `true` post Phase 1 |
| `MIRA_UNS_GATE_CONFIDENCE_THRESHOLD` | no | Skip-confirmation threshold for single-candidate match | `0.85` |
| `MIRA_UNS_GATE_TIMEOUT_TURNS` | no | Auto-cancel gate after N off-topic turns | `3` |
| `MIRA_SUGGESTION_EXPIRY_DAYS` | no | `ai_suggestions` expiry default | `60` |
| `MIRA_HEALTH_SCORE_RECALC_THRESHOLD` | no | Debounce window for health-score recalculation | `300` (sec) |
| `MCP_REST_API_KEY` | yes | Bearer token for `/api/v1/ingestion/*` | (Doppler) |
| `NEON_DATABASE_URL` | yes | Existing | (Doppler) |
| `MIRA_TENANT_ID` | yes | Existing per-container | (Doppler) |

All secrets via Doppler `factorylm/prd`. Never in committed `.env` files.

## Quality Standards

| Metric | Current | Target |
|---|---|---|
| UNS gate confirmation latency (resolve + render) | n/a (not built) | ≤ 600 ms p95 |
| UNS gate false-positive rate (confidently confirms wrong asset) | n/a | < 1% on golden cases |
| UNS gate false-negative rate (asks for confirmation when it had it) | n/a | < 15% on golden cases (preference: ask too much over too little) |
| Proposal review latency (page render) | n/a | ≤ 200 ms p95 with 1000 pending suggestions |
| Health-score recalc latency (per node, event-driven) | n/a | ≤ 2 s p95 |
| Cross-tenant data leakage | must be 0 | RLS regression test on every new endpoint |
| Suggestion → approval round-trip | n/a | unit + e2e: photo upload → proposal → confirm → `kg_entity` written |
| Golden cases for UNS gate | none | ≥ 6 (see above) |
| Property tests for FSM `AWAITING_UNS_CONFIRMATION` transitions | none | added in Phase 1 alongside the new state |
| Migration 008 reversibility | n/a | DOWN migration tested on staging before merge |

## Acceptance Criteria

1. **UNS Gate — vague:** Message "fault on line 5" enters `AWAITING_UNS_CONFIRMATION` and asks for asset/component.
2. **UNS Gate — clear:** Message "Conveyor B16 occupied too long" reaches troubleshooting without a confirmation card (confidence ≥ 0.85, one-line ack only).
3. **UNS Gate — ambiguous:** Message "B16 fault" returns a card with top candidate + alt list.
4. **UNS Gate — correction:** After a card for B16, "no it's B17" re-resolves and presents B17.
5. **UNS Gate — stale resume:** Prior session asked about B16; new message "still broken" reuses prior context without re-asking.
6. **UNS Gate — safety override:** A safety keyword in any state bypasses the gate (existing safety branch wins).
7. **UNS Gate — backstop:** With `MIRA_UNS_GATE_ENABLED=false`, the engine behaves identically to today.
8. **Schema — RLS:** A query against any new table without `app.current_tenant_id` returns zero rows.
9. **Schema — backfill safety:** Migration 008 applied to staging DB does not mutate existing `kg_*` rows beyond setting `approval_state='verified'`.
10. **Proposal write:** `POST /api/v1/ingestion/photo` with a sample motor nameplate JPG returns `ingestion_job_id` AND creates ≥ 1 `ai_suggestions` row of type `component_profile`.
11. **Proposal decide:** `POST /api/v1/proposals/:id/decide` with `decision='confirm'` writes an `approvals` row AND promotes the corresponding `kg_entity` (or writes `kg_relationships`) with `approval_state='verified'`.
12. **Reject preserves audit:** A `decision='reject'` flow does NOT write to `kg_*` but DOES write the `approvals` row + sets `ai_suggestions.status='rejected'`.
13. **Edit captures diff:** `decision='edit'` records the edited payload in `approvals.decision_payload` AND applies the edited version.
14. **Tag import:** Uploading a sample 100-row Ignition CSV creates ≤ 100 `ai_suggestions` rows of type `tag_mapping`; reconciliation table renders them grouped by inferred asset.
15. **Wizard resume:** A user completes wizard step 1, logs out, logs back in → `GET /api/v1/wizard` returns the saved payload and the wizard resumes at step 2.
16. **Health score — L0 tenant:** A brand-new tenant has `level=0` and missing list includes "Create your first site / line."
17. **Health score — escalation:** Confirming the last component in a "must reach L3" set triggers a recalculation that moves the node to L3 within `MIRA_HEALTH_SCORE_RECALC_THRESHOLD` seconds.
18. **Namespace tree — move:** A manager dragging an asset to a different line writes to `kg_relationships(part_of)`, snapshots `namespace_versions` (reason=`before_bulk_move` if > 5 children), and reflects in `/api/v1/namespace/tree` on next fetch.
19. **QR — create-on-scan:** Scanning an `asset_tag` not yet bound in `qr_codes` (status=`unbound`) routes the technician to `/m/[assetTag]/capture` for the create-asset flow; binding the QR writes back to the row.
20. **Citation enforced when gate active:** A reply emitted from `AWAITING_UNS_CONFIRMATION` → confirmed flow MUST contain at least one citation marker; the existing `citation_compliance.py` is upgraded from "observational" to "enforcing" for this path only.
21. **No Anthropic regression:** No new code path introduces an Anthropic provider. The cascade remains Groq → Cerebras → Gemini.
22. **No PLC writes:** No new endpoint accepts a write to PLC / Ignition control tags. Tag-import and live-data endpoints are read-only.
23. **Smoke pass after deploy:** `bash install/smoke_test.sh` returns clean after Phase 1 deploy.

## Known Issues / Open Questions

- **KG schema canonicalization** — Hub `001_knowledge_graph.sql` vs. `docs/migrations/004_kg_entities.sql` are still parallel (`knowledge-graph-spec.md` Known Issues). Phase 1 must resolve this; this spec assumes the NeonDB 004 + 007 flavor.
- **`uns-message-resolver-spec.md`** — referenced in `.claude/CLAUDE.md` but not present in `docs/specs/`. This spec subsumes its role; the CLAUDE.md reference will be updated to point here.
- **Health-score L6 ("Business Intelligence")** — definition currently leans on aggregated WO history. May need refinement after the first 3 tenants reach L5.
- **Web Hub vs. Slack drift** — both adapters must call the same UNS gate. Phase 2's Hub chat work (per `manual-intelligence-self-serve-spec.md` Gap 1) needs to integrate with the gate, not bypass it.
- **`/m/[assetTag]/capture` permissions** — the unauthenticated mobile landing should NOT be able to create assets without a paired JWT or magic-link token. This is enforced by the QR `status='unbound'` requiring an authenticated bind.
- **Triple-extractor wiring at runtime** — `knowledge-graph-spec.md` flags this as Known Issue. This spec assumes it lands as part of Phase 1; if it slips, the `ai_suggestions` queue can be populated from explicit worker outputs (photo, tag, manual ingest) without runtime triple extraction in the chat path.

## Change Log

- **2026-05-15** — Initial draft. Establishes the UNS Location-Confirmation Gate, AI-proposal queue (`ai_suggestions` / `approvals`), automated L0–L6 readiness score, wizard / namespace / proposal Hub surfaces, photo + tag ingestion API, and role matrix. Distinguishes from `dt-scorecard-spec.md` (manual self-rating) and `mira-scan-spec.md` (asset-tag flow, which this spec extends rather than replaces).
- **2026-05-15 (correction)** — Reframed UNS gate section after `git fetch origin main` revealed the Stage-1 gate is already merged (PRs #1220, #1280, #1295, #1314). The spec now defines the **additive plant-hierarchy extension** on top of the existing vendor / model / fault-code resolver, not a from-scratch build. Phase 1 starts with an audit of the existing implementation, then adds site/area/line/asset hierarchy resolution + the `AWAITING_UNS_CONFIRMATION` side state.
