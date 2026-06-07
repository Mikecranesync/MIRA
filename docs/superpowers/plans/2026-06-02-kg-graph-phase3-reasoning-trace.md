# KG Relationship Graph — Phase 3 (Reasoning Trace) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** When MIRA answers a question using the knowledge graph, capture which entities/edges it traversed, and highlight that subgraph on `/graph` — "the visual becomes a window into the agent's reasoning."

**Architecture:** The Hub's answer endpoint (`POST /api/mira/ask`) already builds a `grounding` object containing the entities and edges it consulted — it just never persists it. Phase 3: (1) a `kg_query_traces` table; (2) a best-effort trace capture after each answer (never blocks the answer); (3) a `GET /api/kg/trace` fetch endpoint; (4) `/graph?session=<id>` fetches the trace and highlights those nodes/edges, dimming the rest. No changes to reasoning logic.

**Tech Stack:** Postgres migration, TypeScript, `pg` + `withTenantContext`, vitest, npm (bun not on PATH), `react-force-graph-2d`, `next/navigation` (`useSearchParams`).

**Branch:** `feat/kg-graph-reasoning-trace` (stacked on `feat/kg-graph-enrich` / PR #1671).

**Grounding facts (verified in code):**
- `src/app/api/mira/ask/route.ts`: `grounding.components` is `Array<Record<string,unknown>>` whose items carry `.id` (= `kg_entities.id`); `grounding.edges` carry `s_name`, `t_name`, `relationship_type`, `confidence`. `session.id` (= `troubleshooting_sessions.id`), `session.asset_id` (root equipment entity), `result.content`, `result.provider` are all in scope. Transcript is appended at lines 398-406; the trace capture goes right after.
- `troubleshooting_sessions` (migration 019) is the conversation table; trace rows FK to it.
- The graph's node ids are `kg_entities.id` UUIDs — the same ids in `grounding.components[].id` and `session.asset_id`, so highlight-by-node-id works directly.
- Edge highlight is derived: a link is "in the trace" iff BOTH endpoints are traced nodes (robust — avoids needing edge UUIDs the grounding doesn't expose).

---

## File structure

| File | Responsibility |
|---|---|
| `mira-hub/db/migrations/031_kg_query_traces.sql` | `kg_query_traces` table + indexes |
| `mira-hub/src/lib/knowledge-graph/trace.ts` | Pure `extractTrace(grounding, rootId)` + `recordQueryTrace(client, …)` writer |
| `mira-hub/src/lib/knowledge-graph/__tests__/trace.test.ts` | Unit tests for `extractTrace` |
| `mira-hub/src/app/api/mira/ask/route.ts` (modify) | Best-effort trace capture after transcript append |
| `mira-hub/src/app/api/kg/trace/route.ts` | `GET /api/kg/trace?sessionId=[&turn=]` |
| `mira-hub/src/components/kg/GraphCanvas.tsx` (modify) | `highlightNodeIds` → emphasize traced nodes/edges, dim the rest |
| `mira-hub/src/app/(hub)/graph/page.tsx` (modify) | Read `?session=`, fetch trace, banner + highlight |

---

### Task 1: Migration 031 — `kg_query_traces`

**Files:** Create `mira-hub/db/migrations/031_kg_query_traces.sql`

Wrap in `BEGIN; … COMMIT;` with a header comment in house style. Schema:
```sql
CREATE TABLE IF NOT EXISTS kg_query_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  session_id UUID NOT NULL REFERENCES troubleshooting_sessions(id) ON DELETE CASCADE,
  question_turn_index INT NOT NULL DEFAULT 0,
  root_id UUID,                 -- the anchor equipment entity
  question TEXT,
  answer_provider TEXT,
  entity_ids UUID[] NOT NULL DEFAULT '{}',   -- kg_entities.id traversed
  edges JSONB NOT NULL DEFAULT '[]',         -- [{sName,tName,type,confidence}]
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kg_traces_session ON kg_query_traces (session_id);
CREATE INDEX IF NOT EXISTS idx_kg_traces_tenant_session ON kg_query_traces (tenant_id, session_id, created_at DESC);
```

- [ ] **Step 1:** Write the migration (read `019_sessions_and_signals.sql` to confirm the `troubleshooting_sessions` table name + that `id` is UUID).
- [ ] **Step 2:** `node db/check-migration-order.mjs` → exit 0 (add an `-- Issue:` header only if siblings have one; 028-030 don't).
- [ ] **Step 3:** Commit — `git add db/migrations/031_kg_query_traces.sql && git commit -m "feat(kg): migration 031 — kg_query_traces (reasoning-trace store)"`

---

### Task 2: Trace extractor (pure, TDD) + writer + capture wiring

**Files:** Create `mira-hub/src/lib/knowledge-graph/trace.ts` + `__tests__/trace.test.ts`; modify `mira-hub/src/app/api/mira/ask/route.ts`

**Pure part — `extractTrace`:**
```ts
export interface TraceGroundingLike {
  components?: Array<{ id?: unknown }>;
  edges?: Array<{ s_name?: unknown; t_name?: unknown; relationship_type?: unknown; confidence?: unknown }>;
}
export interface TraceEdge { sName: string; tName: string; type: string; confidence: number; }
export interface ExtractedTrace { entityIds: string[]; edges: TraceEdge[]; }

export function extractTrace(grounding: TraceGroundingLike, rootId: string | null): ExtractedTrace {
  const entityIds: string[] = [];
  const seen = new Set<string>();
  const push = (v: unknown) => {
    if (typeof v === "string" && v.length > 0 && !seen.has(v)) { seen.add(v); entityIds.push(v); }
  };
  push(rootId);
  for (const c of grounding.components ?? []) push(c?.id);
  const edges: TraceEdge[] = (grounding.edges ?? []).map((e) => ({
    sName: String(e?.s_name ?? ""),
    tName: String(e?.t_name ?? ""),
    type: String(e?.relationship_type ?? ""),
    confidence: typeof e?.confidence === "number" ? e.confidence : Number(e?.confidence ?? 0) || 0,
  }));
  return { entityIds, edges };
}
```

**Writer — `recordQueryTrace`:**
```ts
import type { PoolClient } from "pg";
export interface RecordTraceInput {
  sessionId: string; questionTurnIndex: number; rootId: string | null;
  question: string; provider: string | null; extracted: ExtractedTrace;
}
export async function recordQueryTrace(client: PoolClient, tenantId: string, t: RecordTraceInput): Promise<void> {
  await client.query(
    `INSERT INTO kg_query_traces
       (tenant_id, session_id, question_turn_index, root_id, question, answer_provider, entity_ids, edges)
     VALUES ($1,$2,$3,$4,$5,$6,$7::uuid[],$8::jsonb)`,
    [tenantId, t.sessionId, t.questionTurnIndex, t.rootId, t.question, t.provider,
     t.extracted.entityIds, JSON.stringify(t.extracted.edges)],
  );
}
```

**Wiring in `ask/route.ts`** — immediately AFTER the transcript-append block (the `UPDATE troubleshooting_sessions … transcript` call), add a BEST-EFFORT capture that can never break the answer:
```ts
// ── 5b. Capture reasoning trace (best-effort; never blocks the answer) ──
try {
  const extracted = extractTrace(
    grounding as unknown as TraceGroundingLike,
    (session.asset_id as string | null) ?? null,
  );
  if (extracted.entityIds.length > 0) {
    await withTenantContext(ctx.tenantId, (c) =>
      recordQueryTrace(c, ctx.tenantId, {
        sessionId: session.id,
        questionTurnIndex: 0,
        rootId: (session.asset_id as string | null) ?? null,
        question: body.question,
        provider: result.provider,
        extracted,
      }),
    );
  }
} catch (err) {
  console.error("[mira/ask] trace capture failed (non-fatal):", err);
}
```
Add `import { extractTrace, recordQueryTrace, type TraceGroundingLike } from "@/lib/knowledge-graph/trace";` at the top. Verify the real field names in scope (`session.asset_id`, `result.provider`, `body.question`) and adapt if they differ — report any adaptation.

- [ ] **Step 1:** Write `trace.ts` (extractTrace + recordQueryTrace) and `__tests__/trace.test.ts` testing extractTrace: root+2 components → 3 ids root-first; dedup when a component id equals root or repeats; null rootId → components only; edges coerced (string/number defaults). Run `npm test -- trace` red→green.
- [ ] **Step 2:** Wire the best-effort capture into `ask/route.ts`.
- [ ] **Step 3:** `npx tsc --noEmit` (zero new errors) + `npx eslint` on `trace.ts` and `ask/route.ts` clean.
- [ ] **Step 4:** Commit — `git add src/lib/knowledge-graph/trace.ts src/lib/knowledge-graph/__tests__/trace.test.ts "src/app/api/mira/ask/route.ts" && git commit -m "feat(kg): capture reasoning trace on each MIRA answer (best-effort)"`

---

### Task 3: `GET /api/kg/trace` endpoint

**Files:** Create `mira-hub/src/app/api/kg/trace/route.ts`

Session-authed (mirror `/api/kg/graph`): `NEON_DATABASE_URL` guard, `sessionOr401()`, `withTenantContext`. Returns the latest trace for a session (or a specific turn). Tenant-filtered.
```ts
import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
export const dynamic = "force-dynamic";

interface TraceRow {
  question_turn_index: number; root_id: string | null; question: string | null;
  answer_provider: string | null; entity_ids: string[]; edges: unknown;
}

export async function GET(req: Request) {
  if (!process.env.NEON_DATABASE_URL) return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  const turn = url.searchParams.get("turn");
  try {
    const rows = await withTenantContext(ctx.tenantId, (c) =>
      c.query<TraceRow>(
        `SELECT question_turn_index, root_id, question, answer_provider, entity_ids, edges
           FROM kg_query_traces
          WHERE tenant_id = $1::uuid AND session_id = $2::uuid
            ${turn !== null ? "AND question_turn_index = $3" : ""}
          ORDER BY created_at DESC
          LIMIT 1`,
        turn !== null ? [ctx.tenantId, sessionId, Number(turn)] : [ctx.tenantId, sessionId],
      ),
    );
    const r = rows.rows[0];
    if (!r) return NextResponse.json({ error: "no trace for session" }, { status: 404 });
    return NextResponse.json({
      entityIds: r.entity_ids ?? [],
      edges: r.edges ?? [],
      rootId: r.root_id,
      question: r.question,
      provider: r.answer_provider,
      turnIndex: r.question_turn_index,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "internal error" }, { status: 500 });
  }
}
```

- [ ] **Step 1:** Create the file. `npx tsc --noEmit` + `npx eslint` clean.
- [ ] **Step 2:** Commit — `git add "src/app/api/kg/trace/route.ts" && git commit -m "feat(kg): GET /api/kg/trace — reasoning subgraph for a session"`

---

### Task 4: Graph UI — highlight the reasoning subgraph

**Files:** Modify `mira-hub/src/components/kg/GraphCanvas.tsx`, `mira-hub/src/app/(hub)/graph/page.tsx`

**GraphCanvas:** add optional `highlightNodeIds?: Set<string>`. When it is non-empty, dim everything except the trace:
- `nodeColor` accessor: traced node → `"#f5d90a"` (gold); else `"#2a2f3d"` (dim). When the set is empty/undefined, DON'T pass `nodeColor` (keep `nodeAutoColorBy`).
- `linkColor` accessor: when highlight active, a link whose BOTH endpoints are in the set → `"#f5d90a"`; else `"#20242e"`. Use an `endId` helper (string|{id}) like the page.
- `linkWidth`: traced link → 2, else keep existing logic.
Pass these conditionally so default (no highlight) behavior is unchanged.

**page.tsx:** use `useSearchParams()` (`"use client"` already). If `session` param present, `fetch('/api/kg/trace?sessionId=' + session + (turn?'&turn='+turn:''))`; store `trace = { ids: Set<string>, question, provider }` (or null on 404). Pass `highlightNodeIds={trace?.ids}` to `GraphCanvas`. Render a banner when a trace is active: `Reasoning trace — "<question>" · <provider>` with a "Clear" link that navigates to `/graph` (no param). Keep the existing HUD/filters working alongside.

- [ ] **Step 1:** Extend GraphCanvas (highlight props, conditional accessors, same any-narrowing style). `npx tsc --noEmit` clean.
- [ ] **Step 2:** Add the trace fetch + banner + highlight wiring to the page. Wrap `useSearchParams` usage per Next.js rules (the page is already a client component; if a Suspense boundary is required by the build, add one minimally).
- [ ] **Step 3:** `npx tsc --noEmit` + `npx eslint` on both files clean.
- [ ] **Step 4:** Commit — `git add src/components/kg/GraphCanvas.tsx "src/app/(hub)/graph/page.tsx" && git commit -m "feat(kg): /graph highlights the reasoning subgraph from ?session= trace"`

- [ ] **Step 5: Final review** — superpowers:requesting-code-review over `feat/kg-graph-enrich..HEAD`. Confirm: trace capture is best-effort (answer never blocked); trace endpoint is tenant-isolated; highlight degrades gracefully when a traced node isn't in the loaded graph (just fewer highlights); no PII beyond what the session already stores.

---

## Self-review notes

- **Spec coverage:** capture which entities/edges an answer traversed (Tasks 1–2 ✓), expose it (Task 3 ✓), highlight that subgraph on `/graph` (Task 4 ✓) = "window into the agent's reasoning." GraphRAG itself already exists (traversal ops + context-builder); Phase 3 adds the *provenance + visualization*, which is the novel piece.
- **Placeholder scan:** none — concrete SQL, signatures, route code, and accessors. Live run (answer → trace → highlight) needs Neon + a real session, documented as a deploy/verify step, mirroring Phases 1–2.
- **Type consistency:** `entityIds`/`edges` shapes match across `extractTrace`, the writer, the SQL (`uuid[]`, `jsonb`), the trace endpoint response, and the page's `Set<string>`. `highlightNodeIds` is the single prop name used in GraphCanvas and the page.
- **Safety:** capture is wrapped in try/catch and gated on `entityIds.length > 0`; it can never fail an answer. Highlight is purely additive on the client.
