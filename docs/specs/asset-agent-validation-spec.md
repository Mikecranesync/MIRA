# Asset Agent Validation Spec

**Status:** PARTIAL — read-path spine implemented (migration + state machine + Ignition gate); write-path (Validate UI + approve endpoint) pending
**Authored:** 2026-06-07
**Owner:** Mike Harper
**Implementation status (2026-06-07):**
- ✅ Migration `mira-hub/db/migrations/046_asset_agent_status.sql` (both tables + RLS) — *written, not yet applied to any DB.*
- ✅ State machine + gate logic `mira-bots/shared/asset_agent_transition.py` (+ `mira-bots/tests/test_asset_agent_transition.py`, 27 passing).
- ✅ HMI deployment gate wired in `mira-pipeline/ignition_chat.py` behind `ENFORCE_ASSET_AGENT_GATE` (default OFF), covering both `asset_id` and `asset_context`-only turns — no bypass (+ `mira-pipeline/tests/test_ignition_chat_gate.py`, 11 passing).
- ⚠️ **`_lookup_agent_state` is NON-FUNCTIONAL until an Ignition-tag/asset_context → `kg_entity` mapping exists.** An Ignition asset_id is a tag path and asset_context fields are display names; neither matches `entity_id`/`uns_path`(ltree)/`id` today, so with the gate ON it returns None for every asset → refuse-all. **Do not enable `ENFORCE_ASSET_AGENT_GATE` until that mapping ships (next PR).**
- 🔲 Ignition-tag → `kg_entity` resolver, Validate UI (`/assets/[id]` tab), approve endpoint, TS transition twin — next PR (where the write-path gets its first caller).
- 🔲 Migrations applied dev→staging→prod; golden/e2e case; `mira-run-hallucination-audit` extension.
**Parent doctrine:** `docs/THEORY_OF_OPERATIONS.md` · `.claude/rules/train-before-deploy.md`
**Phase fit:** sits under `docs/plans/2026-06-07-path-to-beta.md` (the beta gate) and the master plan `docs/plans/2026-06-01-mira-master-architecture-plan.md`.

> **One sentence.** An *Asset Agent* is a trained-and-validated MIRA scoped to one `kg_entity`. This
> spec defines the lifecycle (`draft → training → validating → approved → deployed`) that gates when
> that agent is allowed to answer on a deployment surface (Ignition / HMI), and the validation
> evidence required to advance it.

---

## 1. Why this exists

MIRA's product direction is **train before deploy** (`.claude/rules/train-before-deploy.md`):

- **FactoryLM Command Center** (`mira-hub`, `app.factorylm.com`) is where a customer builds the
  namespace, uploads docs, **validates** MIRA's answers on a specific asset, and **approves** them.
- **Ignition / HMI "Ask MIRA"** is a *deployment surface* for **approved** asset agents — not the
  onboarding system.

Today the architecture has the *build* half (namespace surfaces, proposals, AssetChat with
citations) and the *grounding* half (tenant-scoped retrieval, engine groundedness scoring), but it
has **no explicit per-asset lifecycle** and **no deployment gate**: `mira-pipeline/ignition_chat.py`
answers for any asset-bound turn with a valid HMAC, regardless of whether that asset has grounded
docs or any validated answers (verified this session — `ignition_chat.py` has no readiness check).

This spec closes that gap by composing primitives that **already exist** rather than inventing new
scoring. It is the contract the deployment gate consults.

## 2. What already exists (compose, don't rebuild)

| Primitive | Where | Role in this spec |
|---|---|---|
| `kg_entities.approval_state` (`proposed`/`verified`/`rejected`/`needs_review`/`deprecated`) | `mira-hub/db/migrations/029_kg_approval_state.sql` | The asset entity itself must be `verified` before its agent can leave `draft`. |
| `ai_suggestions` (tenant-scoped work queue, RLS, 6 `suggestion_type`s) | `mira-hub/db/migrations/027_ai_suggestions.sql` | The proposals that *fill* the asset's namespace/docs during `training`. |
| Namespace readiness **L0–L6** (per-tenant) | `mira-hub/src/lib/health-score.ts`, mig `021` | Namespace-level gate. **Distinct granularity** — see §3. An asset agent can't validate until its branch reaches ~L4 (grounded to data). |
| Engine groundedness **1–5** + `_is_grounded()` + low-groundedness episode tracking | `mira-bots/shared/engine.py` (`groundedness` score ~L280, `_is_grounded` L5182) | The per-answer score recorded on each validation Q&A. No new scorer. |
| `evidence_utilization` / `evidence_packet` | `mira-bots/shared/benchmark_db.py` | Per-answer evidence metrics carried onto the validation record. |
| Tenant-scoped retrieval (`WHERE tenant_id = :tid OR tenant_id = :shared_tid`) | `mira-bots/shared/neon_recall.py::recall_knowledge` | Why an asset agent's answers are isolated to its tenant (+ the shared OEM pool). |
| Citation rendering | `mira-hub/src/components/AssetChat.tsx`, manual-rag | Where the human sees the cited answer they approve/reject. |

**Net:** the only genuinely new state is (a) a per-asset lifecycle record and (b) a place to store
validation Q&A verdicts. Everything else is read from the tables above.

## 3. Granularity — `asset_agent_status` is NOT the health score

These are different objects and must not be conflated:

| | Health score (L0–L6) | Asset agent status |
|---|---|---|
| Scope | **Per-tenant namespace** (whole plant) | **Per `kg_entity`** (one asset/component) |
| Source | `health-score.ts` (counts) | this spec (lifecycle row) |
| Answers | "How AI-ready is this plant?" | "Is *this asset's* agent approved to answer on the HMI?" |
| Used by | Sales widget, onboarding next-step | The deployment gate in `ignition_chat.py` |

A plant at L5 can still have an individual asset whose agent is `draft` (no docs uploaded yet). The
deployment gate asks the *asset* question, not the *plant* question.

## 4. The lifecycle

```
 draft ──► training ──► validating ──► approved ──► deployed
   │           │             │             │            │
   │           │             └─►(fail)─────┘            │
   │           │                                        │
   └───────────┴────────────── rejected ◄───────────────┘   (admin can reject from any state)
                                                            deprecated ◄── (doc/asset retired)
```

| State | Meaning | Entry condition | Who advances |
|---|---|---|---|
| `draft` | Asset entity exists; agent not started. | `kg_entities` row created. | system (on entity create) |
| `training` | Docs/tags being attached; proposals flowing. | ≥1 doc upload OR ≥1 `ai_suggestions` row for this entity. | system |
| `validating` | Namespace branch grounded (~L4); validation Q&A in progress. | asset entity `approval_state='verified'` AND ≥1 citable `knowledge_entries` chunk grounded to the asset's UNS subtree. | system |
| `approved` | Human signed off: validation questions pass with cited, grounded answers. | §5 acceptance met AND an admin/technician approval action. | **admin/technician only** |
| `deployed` | Agent is live on a deployment surface (HMI). | `approved` AND a deploy action (or auto on first HMI turn once approved — config). | admin |
| `rejected` | Validation failed or asset agent pulled. | admin action from any state. | admin |
| `deprecated` | Underlying asset/docs retired. | asset entity `approval_state='deprecated'`. | system/admin |

**Invariant:** promotion to `approved` is **always a human action** — same rule as KG edge promotion
(`docs/THEORY_OF_OPERATIONS.md` Invariant 4). No auto-approve. A code path that sets `approved`
without a recorded `approved_by` actor is a bug.

## 5. Acceptance criteria for `approved`

An asset agent may be advanced to `approved` only when **all** hold (thresholds configurable per
tenant; defaults below):

1. Asset `kg_entities.approval_state = 'verified'`.
2. **Citation coverage:** ≥ `MIN_VALIDATION_QUESTIONS` (default 5) validation questions answered,
   each with ≥1 citation resolving to a `knowledge_entries` chunk in the asset's UNS subtree.
3. **Groundedness:** every approved validation answer has engine groundedness `score ≥ 4` (1–5).
4. **Human verdict:** every counted validation answer has `reviewer_verdict = 'good'`.
5. **No open safety_critical proposals** on the asset (`ai_suggestions.risk_level='safety_critical'
   AND status='pending'` → block; safety review first).
6. A recorded `approved_by` actor and `approved_at` timestamp.

The beta gate (`tests/beta/beta_ready_upload_retrieval_citation.py`) is the *minimum* of #2 — a
single uploaded manual becoming citable. This spec is the per-asset generalization.

## 6. Data model (proposed — next free migration ≥ 038 per `docs/mira/` numbering)

Two new tenant-scoped tables. Do **not** widen `kg_entities` with lifecycle columns (keeps the KG
table about graph structure, lifecycle about agents).

```sql
-- asset_agent_status: one row per kg_entity that has (or is building toward) an agent.
CREATE TABLE IF NOT EXISTS asset_agent_status (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    kg_entity_id    UUID NOT NULL,                 -- FK → kg_entities.id (the asset/component)
    state           TEXT NOT NULL DEFAULT 'draft'
        CHECK (state IN ('draft','training','validating','approved','deployed','rejected','deprecated')),
    approved_by     TEXT,                           -- 'human:user_<uuid>' — REQUIRED to enter 'approved'
    approved_at     TIMESTAMPTZ,
    deployed_at     TIMESTAMPTZ,
    deploy_surface  TEXT,                           -- 'ignition' | 'perspective' | 'hub_display' | 'qr'
    citation_coverage  INTEGER NOT NULL DEFAULT 0,  -- # validation Q with ≥1 citation
    min_groundedness   SMALLINT,                    -- lowest groundedness across counted answers
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, kg_entity_id)
);

-- asset_validation_qa: the validation transcript an approver signs off on.
CREATE TABLE IF NOT EXISTS asset_validation_qa (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    kg_entity_id    UUID NOT NULL,
    question        TEXT NOT NULL,
    mira_answer     TEXT,
    citations       JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{doc_id, page, source_url}]
    groundedness    SMALLINT,                            -- engine 1–5, copied from the turn
    evidence_utilization REAL,                            -- from benchmark_db
    reviewer_verdict TEXT
        CHECK (reviewer_verdict IS NULL OR reviewer_verdict IN ('good','bad','needs_review')),
    reviewed_by     TEXT,
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Both tables: `ENABLE ROW LEVEL SECURITY` + the standard `tenant_id = current_setting('app.tenant_id'...)`
policy (mirror `027_ai_suggestions.sql`), and `GRANT SELECT, INSERT, UPDATE … TO factorylm_app`.
Status transitions go through a helper (`mira-hub/lib/asset-agent-transition.ts` +
`mira_bots/shared/asset_agent_transition.py`) per the ADR-0017 pattern — no raw `UPDATE … SET state`.

## 7. The deployment gate (the load-bearing change)

`mira-pipeline/ignition_chat.py` (and every direct-connection surface in
`.claude/rules/direct-connection-uns-certified.md`) MUST, **in beta**, consult the agent state
before answering:

```
resolve asset_id / asset_context → kg_entity_id
look up asset_agent_status.state for (tenant_id, kg_entity_id)
  state == 'deployed'  → answer (grounded, as today)
  state == 'approved'  → answer + auto-set 'deployed' (config: AUTO_DEPLOY_ON_FIRST_TURN)
  otherwise            → refuse with a "this asset isn't validated yet" message
                         (NOT a chat-gate question — the connection is certified; it's the
                          *agent* that isn't ready). Log for the readiness dashboard.
```

This is additive to the existing HMAC + `source="direct_connection"` flow; it does not change the
UNS certification model. It is **beta-gated**: behind `ENFORCE_ASSET_AGENT_GATE` (default off until
the lifecycle is populated), so it can ship dark and flip on per-tenant.

## 8. Command Center surfaces (where humans drive the lifecycle)

Reuse existing surfaces; add the lifecycle affordances:

- **`/assets/[id]`** (`AssetChat.tsx`) — add a **"Validate"** tab: ask a question, see the cited
  answer, click **good / bad** (writes `asset_validation_qa`). A status chip shows the lifecycle
  state. **No new chat engine** — this is the existing AssetChat with a verdict control.
- **Approve action** — when §5 is met, an admin sees an **"Approve for HMI"** button → records
  `approved_by`/`approved_at`, advances state.
- **Readiness column** on the assets list and Command Center tree: `draft/training/validating/
  approved/deployed` chip, driven by `asset_agent_status`.

## 9. Out of scope / non-goals

- ❌ Auto-approval. Promotion to `approved` is a human action (Invariant 4).
- ❌ A separate per-asset LLM or fine-tune. An "asset agent" is the *same* engine scoped by UNS
  subtree + this lifecycle gate — not a distinct model. (Train-before-deploy is about *grounding +
  approval*, not model training.)
- ❌ Any PLC write. Deployment means "allowed to *answer* on the HMI," never "allowed to act."
- ❌ Replacing the namespace L0–L6 health score (§3).

## 10. Acceptance (for the eventual implementation PR)

1. Migrations create both tables with RLS; `dry-run` then `apply` dev→staging→prod.
2. Transition helpers reject illegal transitions and `approved` without an actor.
3. `ignition_chat.py` gate behind `ENFORCE_ASSET_AGENT_GATE`, with a unit test for each branch
   (`deployed`/`approved`/`draft`).
4. `/assets/[id]` Validate tab writes `asset_validation_qa`; approve button enforces §5.
5. A golden/e2e case: build an asset to `approved`, confirm the HMI gate answers; flip to `draft`,
   confirm it refuses.
6. `mira-run-hallucination-audit` extended to flag a direct-connection answer for a non-`deployed`
   asset when the gate is enforced.

## 11. Cross-references

- `.claude/rules/train-before-deploy.md` — the doctrine this implements
- `docs/THEORY_OF_OPERATIONS.md` — Invariants 4 (human promotion), 6 (grounded), 7 (confirm)
- `.claude/rules/direct-connection-uns-certified.md` — the surfaces the gate applies to
- `docs/specs/maintenance-namespace-builder-spec.md` — readiness levels, ai_suggestions
- `docs/adr/0017-proposal-state-machine-mapping.md` — the transition-helper pattern
- `docs/plans/2026-06-07-path-to-beta.md` — the beta gate (the minimum of §5)
- `mira-pipeline/ignition_chat.py` — where the gate lands
- `mira-hub/db/migrations/027_ai_suggestions.sql`, `029_kg_approval_state.sql` — composed primitives
