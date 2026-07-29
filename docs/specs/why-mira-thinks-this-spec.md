# "Why MIRA Thinks This" — Decision-Trace Surfacing Spec

**Status:** DRAFT · **Created:** 2026-06-17 · **Owner phase:** Phase 2 of `docs/plans/2026-06-17-northstar-alignment-implementation-plan.md`
**PRD contract:** `docs/product/factorylm-maintenance-context-platform-and-mira-agent-prd.md` §11
**Primary agent:** `feature-dev:code-architect` → `maintenance-diagnostician` (trace fidelity) → `feature-dev:code-reviewer`
**Skills:** `slack-technician-ux-writer` (plain language), `bot-grounding-tests` (no grounding regression), `mira-uns-architecture` (UNS path display), `mira-hub-migrations` (migration safety)

---

## 1. Goal

Give every MIRA answer in the FactoryLM Hub an expandable **"Why MIRA Thinks This"** panel that shows the evidence, source references, confidence, and a "mark this answer" feedback control — turning MIRA from an opaque chatbot into a *challengeable* agent. This is the trust artifact the PRD calls for (§11) and a precondition for the train-before-deploy story.

**Northstar framing:** MIRA must *prove what FactoryLM context it used.* This spec makes that proof visible.

---

## 2. Ground truth (verified, file:line anchored)

> These facts were established by reading the code on `main` (commit at VERSION 3.26.1). They **correct** the plan's Phase 2 assumption that "the trace is already persisted, just surface it." It *is* persisted — but **only on the engine surfaces, not on the Hub chat the panel lives in.**

### 2.1 `decision_traces` table — `mira-hub/db/migrations/032_decision_traces.sql`
Columns: `trace_id` (UUID PK, `gen_random_uuid()`), `tenant_id` (UUID, NOT NULL), `session_id` (UUID, nullable FK → `troubleshooting_sessions`), `platform` (TEXT — "slack"|"telegram"|"ignition"|"hub"|"web"), `uns_path` (LTREE), `user_question` (TEXT NOT NULL), `tag_evidence`/`manual_evidence`/`kg_evidence` (JSONB DEFAULT `'[]'`), `recommendation` (TEXT), `citations_present` (BOOLEAN), `technician_confirmed` (BOOLEAN), `outcome` (TEXT — "resolved"|"handoff"|"kb_gap"|"gate_fired"|"engine_error"), `model_used` (TEXT), `latency_ms` (INTEGER), `ts` (TIMESTAMPTZ).
- **RLS:** `tenant_id = current_setting('app.tenant_id', true)::UUID OR …'app.current_tenant_id'…::UUID` (UUID-family — in-type cast is correct here).
- **Grants:** `GRANT SELECT, INSERT ON decision_traces TO factorylm_app;` `REVOKE UPDATE, DELETE FROM PUBLIC`.
- Same NeonDB the Hub reads. **No `confidence` column exists.**

### 2.2 Evidence JSONB shapes (as written by `mira-bots/shared/decision_trace.py`)
- `tag_evidence[]`: `{tag_path, uns_path, value, event_id, ts}` (Ignition variant: `{tag_path, value, quality, source}`)
- `manual_evidence[]`: `{chunk_id, doc, page, score}` (unstructured variant: `{rank, excerpt}`)
- `kg_evidence[]`: `{entity_id, rel, target}`

### 2.3 Who writes traces today
`decision_trace.write_trace(**kwargs) -> None` (fire-and-forget, returns nothing) is scheduled as a background task by `mira-bots/shared/engine.py` after the reply finalizes. **Only the Python engine surfaces write traces** (Slack, Telegram, and Ignition via `mira-pipeline/ignition_chat.py`).

### 2.4 The Hub chat surface does NOT use the engine
`mira-hub/src/components/AssetChat.tsx` POSTs to `/hub/api/assets/[id]/chat`. The route `mira-hub/src/app/api/assets/[id]/chat/route.ts` streams the answer **directly via the TS provider cascade** (Groq→Cerebras→Gemini), emits SSE chunks `{content}` / `{sources}` / `[DONE]`, generates a server-side `conversationId` that **is never returned**, and fires `extractAndStore(...)` for KG. **It never calls `write_trace`, so no `decision_traces` row exists for a Hub answer, and no id reaches the client.**

### 2.5 Trace-id correlation does not exist on any surface
The engine's internal `_make_result` dict has a `trace_id`, but that is a **telemetry** id (`tl_trace(...)`), not the `decision_traces.trace_id` (which the DB default generates inside `write_trace` and never returns). The Ignition HTTP response (`ignition_chat.py:527`) omits any trace id. **No surface can correlate an answer to its trace row today.**

### 2.6 Feedback today
`engine.log_feedback(chat_id, feedback, reason)` writes to a **SQLite** `feedback_log` (`chat_id`, `feedback`, `reason`, `last_reply`, `exchange_count`, `created_at`) — keyed by `chat_id`, **not** linked to a `trace_id`, and **not** in NeonDB. No feedback UI exists in the Hub (`AssetChat`).

### 2.7 Canonical Hub read pattern
Pure-tenant NeonDB reads use `withTenantContext(ctx.tenantId, c => c.query(... WHERE tenant_id = $1 ...))` with `sessionOr401()` (`ctx.tenantId` is always a UUID). Reference: `mira-hub/src/app/api/kg/trace/route.ts`. Hybrid reads that join `knowledge_entries` must instead use the raw pool + `(is_private = false OR tenant_id = $caller)` (`.claude/rules/knowledge-entries-tenant-scoping.md`). **The decision-trace read does NOT join `knowledge_entries`** (evidence is self-contained JSONB), so `withTenantContext` is correct here.

### 2.8 House UI conventions
Tailwind + CSS vars (`--surface-0/1`, `--foreground`, `--foreground-subtle`, `--border`, `--brand-blue`), `Button` from `@/components/ui/button.tsx` (CVA variants), `lucide-react` icons, expandable sections via `useState`. Reference: `mira-hub/src/components/AssetIntelligencePanel.tsx`.

---

## 3. Design decision

**Chosen: Option 1 — the Hub chat route writes its own `decision_traces` row and returns the `trace_id` to the client.** Self-contained in `mira-hub` (TypeScript), no Python/engine change, no staging-gate exposure, ships the panel where users actually chat today.

**Rejected: Option 2 — route Hub chat through `mira-pipeline`/engine so `write_trace` fires.** Larger blast radius (engine envelope change, staging gate, cross-service plumbing). Deferred as the *follow-up that unifies the panel across Slack/Telegram/Ignition* (those already write traces; they only need `trace_id` surfaced in their envelope — the plan's original "engine envelope" step). Tracked in §10.

Rationale: Karpathy simplicity + the environment rule that engine changes pass the staging gate. The Hub route already holds everything a trace needs (question, answer, sources, tenant, asset→uns, model, latency).

---

## 4. Scope

### 4.1 In scope (MVP)
- The Hub `AssetChat` answer surface gets a per-answer "Why MIRA Thinks This" expander.
- A `decision_traces` row is written for each Hub answer (`platform='hub'`).
- A read API `GET /api/decision-trace/[id]` (tenant-scoped).
- A trace-linked feedback store + `POST /api/decision-trace/[id]/feedback` (verdict: `good`|`bad`|`missing_context`|`needs_review`).
- Add a nullable `confidence TEXT` column to `decision_traces` (the panel needs it; the table lacks it).

### 4.2 Out of scope (honest — these fields are NOT persisted today)
The PRD §11 panel lists `decision_path`, `context_ignored`, and `next_check`. **None are stored in `decision_traces`.** The MVP panel will **omit** them (not fake them). They require structured emission from the answer producer and are deferred to **Phase 2.1 — trace enrichment** (§10). The MVP renders only fields we can truthfully populate.

### 4.3 Field availability matrix (what the MVP panel can show)

| PRD §11 field | Source | MVP? |
|---|---|---|
| Context used (tags) | `tag_evidence` | ✅ (empty on Hub chat — shown as "no live tags on this surface") |
| Context used (manuals) | `manual_evidence` | ✅ |
| Context used (KG) | `kg_evidence` | ✅ (likely empty in MVP — KG extraction is async) |
| Source references | `manual_evidence` (chunk_id/doc/page) + `citations_present` | ✅ |
| Confidence | new `confidence` column (heuristic set by route) | ✅ (labeled "heuristic") |
| Missing context | derived from `outcome='kb_gap'` | ✅ (minimal) |
| Freshness of live evidence | `tag_evidence[].quality/ts` | ⚠️ only when tags present (engine surfaces); N/A on Hub chat |
| Decision path | — | ❌ deferred (Phase 2.1) |
| Context ignored | — | ❌ deferred (Phase 2.1) |
| Next check | — | ❌ deferred (Phase 2.1) |
| Feedback controls | new `decision_trace_feedback` | ✅ |

---

## 5. Data model changes

### 5.1 Migration `0NN_decision_trace_confidence_and_feedback.sql`
Per `.claude/rules/mira-hub-migrations.md`: `decision_traces` is the **UUID** tenant family → `tenant_id UUID`, RLS casts the setting to `::UUID`, `GRANT … TO factorylm_app`, single transaction, idempotent.

```sql
BEGIN;

-- 1) Confidence on the trace (the panel needs it; table lacks it).
ALTER TABLE decision_traces
  ADD COLUMN IF NOT EXISTS confidence TEXT;  -- 'high' | 'medium' | 'low' | 'none' | NULL

-- 2) Trace-linked feedback (replaces the fragile chat_id-keyed SQLite feedback_log
--    for the Hub surface; seeds Phase 10 consolidation).
CREATE TABLE IF NOT EXISTS decision_trace_feedback (
    feedback_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trace_id     UUID NOT NULL REFERENCES decision_traces(trace_id) ON DELETE CASCADE,
    tenant_id    UUID NOT NULL,
    verdict      TEXT NOT NULL CHECK (verdict IN ('good','bad','missing_context','needs_review')),
    note         TEXT,
    created_by   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dtf_trace  ON decision_trace_feedback(trace_id);
CREATE INDEX IF NOT EXISTS idx_dtf_tenant ON decision_trace_feedback(tenant_id);

ALTER TABLE decision_trace_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dtf_tenant ON decision_trace_feedback;
CREATE POLICY dtf_tenant ON decision_trace_feedback
  USING      (tenant_id = current_setting('app.tenant_id', true)::UUID
              OR tenant_id = current_setting('app.current_tenant_id', true)::UUID)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID
              OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);

GRANT SELECT, INSERT ON decision_trace_feedback TO factorylm_app;
REVOKE UPDATE, DELETE ON decision_trace_feedback FROM PUBLIC;

COMMIT;
```
Apply dev → staging → prod via `apply-migrations.yml` (`dry-run` then `apply`). Verify the INSERT path under `SET ROLE factorylm_app` with a real UUID tenant before claiming done.

---

## 6. Server changes (`mira-hub`)

### 6.1 Write the trace + return its id — `src/app/api/assets/[id]/chat/route.ts`
After the answer fully streams (where `extractAndStore` fires today), insert one row and emit the id as the final SSE event before `[DONE]`:

```ts
const traceId = crypto.randomUUID();
// uns_path: resolve from the asset (equipment_uns_path) — already available on the asset record.
// model: the cascade provider that produced fullResponse.
// confidence (heuristic, MVP): manualSources.length ? "medium" : "low".
// outcome: manualSources.length ? "resolved" : "kb_gap".
// user_question: sanitize before persisting (mirror engine PII rules — IP/MAC/SN scrub).
await pool.query(
  `INSERT INTO decision_traces
     (trace_id, tenant_id, platform, uns_path, user_question,
      manual_evidence, recommendation, citations_present, confidence,
      outcome, model_used, latency_ms)
   VALUES ($1,$2,'hub',$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11)`,
  [traceId, ctx.tenantId, unsPath, sanitize(userText),
   JSON.stringify(manualEvidence), fullResponse, manualSources.length > 0,
   manualSources.length ? "medium" : "low",
   manualSources.length ? "resolved" : "kb_gap", modelUsed, latencyMs],
);
controller.enqueue(enc.encode(`data: ${JSON.stringify({ traceId })}\n\n`));
controller.enqueue(enc.encode(`data: [DONE]\n\n`));
```
Notes:
- `manual_evidence` is shaped from the same `manualSources` the route already emits: `[{chunk_id, doc, page, score}]`.
- `tag_evidence`/`kg_evidence` default to `[]` (Hub chat has neither synchronously) — honest, not faked.
- The INSERT is best-effort: wrap in try/catch and never block the stream (mirror the fire-and-forget posture of `extractAndStore`). If the insert fails, omit the `traceId` event (panel simply won't show for that answer).

### 6.2 Read API — `src/app/api/decision-trace/[id]/route.ts` (NEW)
```ts
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;                       // validate UUID shape → 400 if not
  const row = await withTenantContext(ctx.tenantId, (c) =>
    c.query(
      `SELECT trace_id, platform, uns_path, user_question,
              tag_evidence, manual_evidence, kg_evidence,
              recommendation, citations_present, confidence, outcome,
              model_used, latency_ms, ts
         FROM decision_traces
        WHERE trace_id = $1 AND tenant_id = $2
        LIMIT 1`,
      [id, ctx.tenantId],
    ).then((r) => r.rows[0] ?? null),
  );
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(row);
}
```
Pure-tenant table → `withTenantContext` (no `knowledge_entries` join). Cross-tenant id → 404 by construction (tenant predicate).

### 6.3 Feedback API — `src/app/api/decision-trace/[id]/feedback/route.ts` (NEW)
`POST` body `{ verdict, note? }`. `sessionOr401()` → `withTenantContext` INSERT into `decision_trace_feedback` (`trace_id=id`, `tenant_id=ctx.tenantId`, `created_by=ctx.userId`). Validate `verdict ∈ {good,bad,missing_context,needs_review}` → 422 otherwise. Idempotency: allow multiple rows (history), UI shows latest.

---

## 7. Client changes (`mira-hub`)

### 7.1 `AssetChat.tsx` — capture the trace id
In the SSE read loop, when a chunk parses to `{ traceId }`, attach it to the current assistant message in local state (`message.traceId`). Render a "Why MIRA thinks this" disclosure under that message only when `traceId` is present.

### 7.2 `WhyMiraThinksThis.tsx` (NEW component)
Props: `{ traceId: string }`. On expand, `GET /api/decision-trace/${traceId}`. House style (CSS vars, `Button`, `lucide-react`, expandable). Renders, in plain technician language (`slack-technician-ux-writer`):
- **Confidence** pill (label it *heuristic*).
- **Evidence from FactoryLM:** manual sources (doc · p.page · chunk), KG entities (if any), live tags (if any, with quality/freshness; show "No live tags on this surface" when empty).
- **Citations present:** yes/no badge.
- **Missing context:** when `outcome='kb_gap'` → "No manual grounding was found for this question."
- **Answer recap:** `recommendation`, `model_used`, `latency_ms`.
- **Feedback controls:** [Correct] [Wrong] [Missing context] [Needs review] → `POST …/feedback`; optimistic UI + toast.
- Deferred fields (`decision_path`, `context_ignored`, `next_check`) are simply absent in the MVP (no placeholders that imply data we don't have).

---

## 8. Test plan (TDD — see `superpowers:test-driven-development`)

| Test | Type | Asserts |
|---|---|---|
| `decision-trace read API` | route/unit | seeded row returns shaped JSON; **cross-tenant id → 404**; bad UUID → 400 |
| `feedback API` | route/unit | valid verdict inserts a row tied to `trace_id`+tenant; invalid verdict → 422 |
| `chat route writes trace` | route/integration | a Hub answer inserts exactly one `decision_traces` row (`platform='hub'`) and emits a `{traceId}` SSE event; insert failure does not break the stream |
| `WhyMiraThinksThis` | component render | renders evidence/sources/confidence/missing-context/feedback from a mock trace; no placeholders for deferred fields |
| `migration` | dry-run | `apply-migrations.yml --dry-run` on staging; INSERT under `SET ROLE factorylm_app` with a real UUID tenant succeeds; RLS blocks a foreign tenant |
| grounding regression | `bot-grounding-tests` | unchanged (no engine/retrieval edit in MVP) |

Evidence to capture: desktop (1440×900) + mobile (412×915) screenshots → `docs/promo-screenshots/` (Screenshot Rule).

---

## 9. Acceptance criteria

1. Every Hub `AssetChat` answer that produced a trace shows a working "Why MIRA Thinks This" expander.
2. The panel renders **only real data** (evidence, sources, citations, heuristic confidence, missing-context-from-outcome) — no faked decision path / next check.
3. A user can mark an answer **Correct / Wrong / Missing context / Needs review**, persisted to `decision_trace_feedback` and tenant-isolated.
4. Read + feedback APIs are tenant-scoped (cross-tenant → 404/empty).
5. Migration applies cleanly dev → staging (dry-run then apply); no prod hand-edits.
6. `bot-grounding-tests` unchanged; no engine/staging-gate exposure (MVP is Hub-only).

---

## 10. Follow-ups (explicitly deferred)

- **Phase 2.1 — Trace enrichment:** add structured `decision_path`, `context_ignored`, `next_check` to the trace producer so the panel can show the full PRD §11 contract. Requires the answer producer (Hub route and/or engine) to emit a structured reasoning object. (The Ignition/engine surface has anomaly-rule structure — `plc/conv_simple_anomaly` — that could feed `decision_path` first.)
- **Phase 2.2 — Engine-surface unification:** surface `decision_traces.trace_id` in the engine envelope (`engine.process_full` → adapters → `ignition_chat.py` HTTP response) so Slack/Telegram/Ignition answers can host the same panel and read API. This is the plan's original "engine envelope" step; it carries staging-gate + `mira-run-hallucination-audit` obligations.
- **Phase 10 link:** `decision_trace_feedback` is the trace-linked feedback store that Phase 10 (TechnicianFeedback consolidation) will unify with the SQLite `feedback_log` and `asset_validation_qa.reviewer_verdict`.

---

## 11. Execution

Generate the bite-sized task plan with the `Plan` agent (`superpowers:writing-plans`) from this spec, then implement with `superpowers:subagent-driven-development` in a worktree off `main`. Ship via `ship-pr`. Migration goes dev → staging first. No engine edit in the MVP → no staging-gate beyond the migration verify.
