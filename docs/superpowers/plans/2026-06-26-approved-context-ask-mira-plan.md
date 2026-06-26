# Approved Context Ask MIRA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make answer-facing Ask MIRA paths use only approved/verified asset context, or return a missing-context refusal before any model/provider call.

**Architecture:** Reuse the existing approval spine instead of adding a new store or retrieval system. `kg_entities`/`kg_relationships` expose only `approval_state = 'verified'`, manual retrieval exposes only `knowledge_entries.verified = true` when the existing flag is enabled, and live telemetry is exposed only through `approved_tags.enabled = true`. The PR adds a small reusable approved-context gate, then wires existing Hub answer routes through that gate under feature flags.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, Postgres/Neon, existing `manual-rag`, `health-score`, i3X approval helpers, and Hub SQL migrations.

## Global Constraints

- Do not introduce a new database, graph store, vector store, or answer architecture.
- Do not bypass approval gates; anything not explicitly approved fails closed.
- Do not add live write/control paths; live telemetry remains read-only.
- Prefer existing feature flags and add only a narrow flag alias if needed.
- Keep PR stacked after `codex/context-spine-readiness-checklist` unless #2307/#2308 are rebased first.
- Every new behavior needs a failing test before implementation.
- Mark unverified or unknown context as unavailable instead of asking the model to infer.

---

## Research Snapshot

- Last completed objective is PR #2308, `[codex] Add readiness missing-context checklist`, stacked on `codex/context-spine-db-integration`; local `gh pr view 2308` reported open draft with `mergeStateStatus: CLEAN` on 2026-06-26. This is command evidence, not a source file.
- Base PR #2307, `[codex] Wire contextualizer imports into Hub DB spine`, is still open draft; local `gh pr view 2307` reported `mergeStateStatus: DIRTY` on 2026-06-26. This is command evidence, not a source file.
- The Phase 4 product requirement is already documented as "Make MIRA Answer Only From Approved Asset Context" in `docs/plans/2026-06-25-context-spine-unification-plan.md:120`; it calls out `MIRA_ENFORCE_APPROVED_RETRIEVAL` at `docs/plans/2026-06-25-context-spine-unification-plan.md:126` and zero approved-source refusal at `docs/plans/2026-06-25-context-spine-unification-plan.md:128`.
- `/api/mira/ask` already has a namespace/session gate: it loads a troubleshooting session at `mira-hub/src/app/api/mira/ask/route.ts:130` and returns a 412 namespace gate unless the session is confirmed with an asset at `mira-hub/src/app/api/mira/ask/route.ts:149`.
- `/api/mira/ask` reads KG relationships at `mira-hub/src/app/api/mira/ask/route.ts:189`, but the SQL only filters by tenant and ids at `mira-hub/src/app/api/mira/ask/route.ts:197`; the prompt then labels those rows "Verified relationships" at `mira-hub/src/app/api/mira/ask/route.ts:331`.
- `/api/mira/ask` calls `cascadeComplete` after prompt construction at `mira-hub/src/app/api/mira/ask/route.ts:393`; the approved-context refusal must occur before that line.
- `/api/mira/ask` reads recent live events at `mira-hub/src/app/api/mira/ask/route.ts:205` and current live cache at `mira-hub/src/app/api/mira/ask/route.ts:221`; neither query currently joins `approved_tags`.
- `approved_tags` is the existing live telemetry allowlist table, with `enabled BOOLEAN NOT NULL DEFAULT true` at `mira-hub/db/migrations/035_approved_tags.sql:60` and an enabled index at `mira-hub/db/migrations/035_approved_tags.sql:116`.
- Manual retrieval already has the feature flag `MIRA_ENFORCE_APPROVED_RETRIEVAL` at `mira-hub/src/lib/manual-rag.ts:50` and emits `AND verified = true` when enabled at `mira-hub/src/lib/manual-rag.ts:54`.
- Manual and node retrieval already apply that filter in SQL at `mira-hub/src/lib/manual-rag.ts:315` and `mira-hub/src/lib/manual-rag.ts:422`.
- Manual no-doc fallback already tells the model not to guess at `mira-hub/src/lib/manual-rag.ts:510` through `mira-hub/src/lib/manual-rag.ts:514`.
- Asset chat counts verified manual sources at `mira-hub/src/app/api/assets/[id]/chat/route.ts:307` through `mira-hub/src/app/api/assets/[id]/chat/route.ts:308` and emits `approved_source_count` at `mira-hub/src/app/api/assets/[id]/chat/route.ts:337`, but it does not refuse before provider calls.
- Node chat counts verified manual sources at `mira-hub/src/app/api/namespace/node/[id]/chat/route.ts:285` through `mira-hub/src/app/api/namespace/node/[id]/chat/route.ts:286` and emits `approved_source_count` at `mira-hub/src/app/api/namespace/node/[id]/chat/route.ts:307`, but it does not refuse before provider calls.
- The canonical exposure state is `EXPOSABLE_APPROVAL_STATE = "verified"` in `mira-hub/src/lib/i3x/approval.ts:16`; `isExposable` fails closed unless that state is present at `mira-hub/src/lib/i3x/approval.ts:23`.
- Migration 029 added `kg_relationships.approval_state` with default `proposed` at `mira-hub/db/migrations/029_kg_approval_state.sql:23` and `kg_entities.approval_state` at `mira-hub/db/migrations/029_kg_approval_state.sql:29`.
- Existing i3X data access requires verified entities and approved live tags for readings at `mira-hub/src/lib/i3x/data-access.ts:103` and `mira-hub/src/lib/i3x/data-access.ts:110`.
- Existing KG context builder reads entities and relationships without approval filters at `mira-hub/src/lib/knowledge-graph/context-builder.ts:90`, `mira-hub/src/lib/knowledge-graph/context-builder.ts:118`, and `mira-hub/src/lib/knowledge-graph/context-builder.ts:131`.
- Existing KG traversal paths join `kg_relationships` without approval filters at `mira-hub/src/lib/knowledge-graph/traversal.ts:157`, `mira-hub/src/lib/knowledge-graph/traversal.ts:416`, `mira-hub/src/lib/knowledge-graph/traversal.ts:450`, `mira-hub/src/lib/knowledge-graph/traversal.ts:460`, `mira-hub/src/lib/knowledge-graph/traversal.ts:473`, `mira-hub/src/lib/knowledge-graph/traversal.ts:481`, `mira-hub/src/lib/knowledge-graph/traversal.ts:489`, `mira-hub/src/lib/knowledge-graph/traversal.ts:499`, and `mira-hub/src/lib/knowledge-graph/traversal.ts:508`.
- Readiness has an existing missing-context item type at `mira-hub/src/lib/health-score.ts:47` and existing checklist keys for approved documents and verified relationships at `mira-hub/src/lib/health-score.ts:153` and `mira-hub/src/lib/health-score.ts:174`.
- UNKNOWN: there is no direct `/api/mira/ask` test file in the inspected tree.
- UNKNOWN: no DB-backed traversal/context-builder approval-state integration test was found; current context-builder/traversal tests are formatter/classifier oriented.

---

## Files To Create Or Modify

- Create `mira-hub/src/lib/approved-context.ts`: a pure helper for feature flag checks, approved-context summaries, and refusal payloads.
- Create `mira-hub/src/lib/__tests__/approved-context.test.ts`: pure unit coverage for the helper.
- Create `mira-hub/src/app/api/mira/ask/__tests__/route.test.ts`: route-level tests for verified KG filters, approved live-tag filters, and pre-provider refusal.
- Modify `mira-hub/src/app/api/mira/ask/route.ts`: add verified KG filters, approved-tag joins, approved-context summary, and refusal before `cascadeComplete`.
- Modify `mira-hub/src/app/api/namespace/node/[id]/chat/route.ts`: when enforcement is enabled, return approved-context refusal before opening a stream if `approvedSourceCount === 0`.
- Modify `mira-hub/src/app/api/namespace/node/[id]/chat/__tests__/route.test.ts`: add route coverage for zero-approved-source refusal and no provider call.
- Modify `mira-hub/src/app/api/assets/[id]/chat/route.ts`: when enforcement is enabled, return approved-context refusal before opening a stream if no approved manual/KG context exists.
- Create `mira-hub/src/app/api/assets/[id]/chat/__tests__/route.test.ts`: add a minimal route test seam if no asset-chat test exists.
- Modify `mira-hub/src/lib/knowledge-graph/context-builder.ts`: require verified entities/relationships for answer-facing KG context.
- Modify `mira-hub/src/lib/knowledge-graph/traversal.ts`: require verified entities/relationships in answer-facing traversal helpers used by `buildGraphContext`.
- Modify `mira-hub/src/lib/knowledge-graph/__tests__/context-builder.test.ts` and `mira-hub/src/lib/knowledge-graph/__tests__/traversal.test.ts`: add query-capture tests or extracted SQL helper tests for verified filters.
- Do not modify graph visualization APIs in this PR unless a test proves they are used for Ask MIRA answer grounding. `mira-hub/src/app/api/kg/graph/route.ts:45` is a discovered gap, but it is not the smallest answer-path PR.

---

### Task 1: Shared Approved-Context Gate

**Files:**
- Create: `mira-hub/src/lib/approved-context.ts`
- Test: `mira-hub/src/lib/__tests__/approved-context.test.ts`

**Interfaces:**
- Consumes: `MissingContextItem` from `mira-hub/src/lib/health-score.ts:47`.
- Produces:
  - `approvedAskEnforcementEnabled(env?: NodeJS.ProcessEnv): boolean`
  - `ApprovedContextSummary`
  - `approvedContextReady(summary: ApprovedContextSummary): boolean`
  - `buildApprovedContextRefusal(summary: ApprovedContextSummary): ApprovedContextRefusal`

- [ ] **Step 1: Write the failing helper tests**

Create `mira-hub/src/lib/__tests__/approved-context.test.ts`:

```ts
import {
  approvedAskEnforcementEnabled,
  approvedContextReady,
  buildApprovedContextRefusal,
} from "../approved-context";

describe("approved context gate", () => {
  it("is enabled by the dedicated Ask flag", () => {
    expect(approvedAskEnforcementEnabled({ MIRA_ENFORCE_APPROVED_ASK: "true" })).toBe(true);
  });

  it("is enabled by the existing retrieval flag", () => {
    expect(approvedAskEnforcementEnabled({ MIRA_ENFORCE_APPROVED_RETRIEVAL: "true" })).toBe(true);
  });

  it("is disabled when both flags are absent", () => {
    expect(approvedAskEnforcementEnabled({})).toBe(false);
  });

  it("treats any approved source, verified relationship, or approved live signal as answer context", () => {
    expect(approvedContextReady({ approvedSourceCount: 1, verifiedRelationshipCount: 0, approvedLiveSignalCount: 0 })).toBe(true);
    expect(approvedContextReady({ approvedSourceCount: 0, verifiedRelationshipCount: 1, approvedLiveSignalCount: 0 })).toBe(true);
    expect(approvedContextReady({ approvedSourceCount: 0, verifiedRelationshipCount: 0, approvedLiveSignalCount: 1 })).toBe(true);
    expect(approvedContextReady({ approvedSourceCount: 0, verifiedRelationshipCount: 0, approvedLiveSignalCount: 0 })).toBe(false);
  });

  it("builds the existing missing-context checklist shape for refusal", () => {
    const refusal = buildApprovedContextRefusal({
      approvedSourceCount: 0,
      verifiedRelationshipCount: 0,
      approvedLiveSignalCount: 0,
    });

    expect(refusal).toMatchObject({
      gate: "approved_context",
      reason: "MIRA needs approved asset context before answering.",
    });
    expect(refusal.missingContext).toContainEqual(
      expect.objectContaining({
        key: "approved_documents",
        status: "missing",
        required: 1,
      }),
    );
    expect(refusal.missingContext).toContainEqual(
      expect.objectContaining({
        key: "verified_relationships",
        status: "needs_review",
        required: 1,
      }),
    );
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```powershell
cd mira-hub
npm test -- src/lib/__tests__/approved-context.test.ts
```

Expected: FAIL because `../approved-context` does not exist.

- [ ] **Step 3: Implement the pure helper**

Create `mira-hub/src/lib/approved-context.ts`:

```ts
import type { MissingContextItem } from "./health-score";

export interface ApprovedContextSummary {
  approvedSourceCount: number;
  verifiedRelationshipCount: number;
  approvedLiveSignalCount: number;
}

export interface ApprovedContextRefusal {
  gate: "approved_context";
  reason: string;
  approved_source_count: number;
  verified_relationship_count: number;
  approved_live_signal_count: number;
  missingContext: MissingContextItem[];
}

export function approvedAskEnforcementEnabled(
  env: Pick<NodeJS.ProcessEnv, "MIRA_ENFORCE_APPROVED_ASK" | "MIRA_ENFORCE_APPROVED_RETRIEVAL"> = process.env,
): boolean {
  return env.MIRA_ENFORCE_APPROVED_ASK === "true" || env.MIRA_ENFORCE_APPROVED_RETRIEVAL === "true";
}

export function approvedContextReady(summary: ApprovedContextSummary): boolean {
  return (
    summary.approvedSourceCount > 0 ||
    summary.verifiedRelationshipCount > 0 ||
    summary.approvedLiveSignalCount > 0
  );
}

export function buildApprovedContextRefusal(summary: ApprovedContextSummary): ApprovedContextRefusal {
  return {
    gate: "approved_context",
    reason: "MIRA needs approved asset context before answering.",
    approved_source_count: summary.approvedSourceCount,
    verified_relationship_count: summary.verifiedRelationshipCount,
    approved_live_signal_count: summary.approvedLiveSignalCount,
    missingContext: [
      {
        key: "approved_documents",
        label: "Approved document context",
        status: summary.approvedSourceCount > 0 ? "ready" : "missing",
        count: summary.approvedSourceCount,
        required: 1,
        action: "Upload and approve a manual, PLC tag list, or evidence document.",
      },
      {
        key: "verified_relationships",
        label: "Verified relationships",
        status: summary.verifiedRelationshipCount > 0 ? "ready" : "needs_review",
        count: summary.verifiedRelationshipCount,
        required: 1,
        action: "Accept grounded proposals until at least one relationship is verified.",
      },
    ],
  };
}
```

- [ ] **Step 4: Run the helper test and verify it passes**

Run:

```powershell
cd mira-hub
npm test -- src/lib/__tests__/approved-context.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```powershell
git add mira-hub/src/lib/approved-context.ts mira-hub/src/lib/__tests__/approved-context.test.ts
git commit -m "test: add approved context gate helper"
```

---

### Task 2: `/api/mira/ask` Verified KG Refusal Gate

**Files:**
- Create: `mira-hub/src/app/api/mira/ask/__tests__/route.test.ts`
- Modify: `mira-hub/src/app/api/mira/ask/route.ts:189-203`, `mira-hub/src/app/api/mira/ask/route.ts:330-393`

**Interfaces:**
- Consumes: `approvedAskEnforcementEnabled`, `approvedContextReady`, and `buildApprovedContextRefusal` from Task 1.
- Produces: a 412 JSON response with `gate: "approved_context"` before `cascadeComplete` when enforcement is enabled and no approved context is present.

- [ ] **Step 1: Write the route test for verified KG filtering and refusal**

Create `mira-hub/src/app/api/mira/ask/__tests__/route.test.ts` with a mock style matching `mira-hub/src/app/api/namespace/node/[id]/chat/__tests__/route.test.ts:17` through `mira-hub/src/app/api/namespace/node/[id]/chat/__tests__/route.test.ts:53`:

```ts
import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ sessionOrDemo: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));
vi.mock("@/lib/llm/cascade", () => ({ cascadeComplete: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  clientIpHash: vi.fn(() => "ip-hash"),
  rateLimited: vi.fn(() => false),
}));
vi.mock("@/lib/signal-recorder", () => ({ countTransitions: vi.fn() }));

import { cascadeComplete } from "@/lib/llm/cascade";
import { sessionOrDemo } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { POST } from "../route";

const tenantId = "tenant-1";
const sessionId = "11111111-1111-1111-1111-111111111111";
const assetId = "22222222-2222-2222-2222-222222222222";

function req(question = "What fails when this conveyor stops?") {
  return new Request("http://localhost/api/mira/ask", {
    method: "POST",
    body: JSON.stringify({ session_id: sessionId, question }),
  });
}

function mockClient(rowsBySql: Array<{ match: string; rows: Array<Record<string, unknown>> }>, calls: string[]) {
  return {
    query: vi.fn(async (sql: string) => {
      calls.push(sql);
      const hit = rowsBySql.find((entry) => sql.includes(entry.match));
      return { rows: hit?.rows ?? [] };
    }),
  };
}

describe("POST /api/mira/ask approved-context gate", () => {
  const oldEnv = process.env;

  beforeEach(() => {
    process.env = { ...oldEnv, NEON_DATABASE_URL: "postgres://test", MIRA_ENFORCE_APPROVED_ASK: "true" };
    vi.mocked(sessionOrDemo).mockResolvedValue({ tenantId, userId: "user-1" });
    vi.mocked(cascadeComplete).mockResolvedValue({ content: "answer", provider: "mock", latencyMs: 1 });
  });

  afterEach(() => {
    process.env = oldEnv;
    vi.clearAllMocks();
  });

  it("requires verified KG state in the relationship grounding query", async () => {
    const calls: string[] = [];
    const client = mockClient(
      [
        {
          match: "FROM troubleshooting_sessions",
          rows: [{
            id: sessionId,
            status: "confirmed",
            asset_id: assetId,
            component_id: null,
            transcript: [],
            asset_name: "Conveyor",
            asset_tag: "Plant.Line.Conveyor",
          }],
        },
        { match: "FROM kg_relationships r", rows: [{ relationship_type: "feeds", confidence: 1, s_type: "asset", s_name: "A", t_type: "asset", t_name: "B" }] },
        { match: "FROM live_signal_events e", rows: [] },
        { match: "FROM live_signal_cache cache", rows: [] },
      ],
      calls,
    );
    vi.mocked(withTenantContext).mockImplementation(async (_tenant, fn) => fn(client));

    const res = await POST(req());

    expect(res.status).toBe(200);
    const relationshipSql = calls.find((sql) => sql.includes("FROM kg_relationships r")) ?? "";
    expect(relationshipSql).toMatch(/r\.approval_state\s*=\s*'verified'/i);
    expect(relationshipSql).toMatch(/src\.approval_state\s*=\s*'verified'/i);
    expect(relationshipSql).toMatch(/tgt\.approval_state\s*=\s*'verified'/i);
  });

  it("returns approved_context without calling cascade when no approved context exists", async () => {
    const calls: string[] = [];
    const client = mockClient(
      [
        {
          match: "FROM troubleshooting_sessions",
          rows: [{
            id: sessionId,
            status: "confirmed",
            asset_id: assetId,
            component_id: null,
            transcript: [],
            asset_name: "Conveyor",
            asset_tag: "Plant.Line.Conveyor",
          }],
        },
      ],
      calls,
    );
    vi.mocked(withTenantContext).mockImplementation(async (_tenant, fn) => fn(client));

    const res = await POST(req());
    const body = await res.json();

    expect(res.status).toBe(412);
    expect(body.gate).toBe("approved_context");
    expect(body.missingContext).toEqual(expect.any(Array));
    expect(cascadeComplete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the new route test and verify it fails**

Run:

```powershell
cd mira-hub
npm test -- src/app/api/mira/ask/__tests__/route.test.ts
```

Expected: FAIL because the relationship SQL does not include verified filters and the route still calls `cascadeComplete` with zero approved context.

- [ ] **Step 3: Add verified filters and pre-provider refusal**

Modify `mira-hub/src/app/api/mira/ask/route.ts`:

```ts
import {
  approvedAskEnforcementEnabled,
  approvedContextReady,
  buildApprovedContextRefusal,
} from "@/lib/approved-context";
```

Add verified filters to the relationship query:

```sql
          WHERE r.tenant_id = $1
            AND r.approval_state = 'verified'
            AND src.approval_state = 'verified'
            AND tgt.approval_state = 'verified'
            AND (r.source_id = $2 OR r.target_id = $2 OR r.source_id = ANY($3::uuid[]))
```

After `grounding` is built and before `const messages: CascadeMessage[] = [`:

```ts
  const approvedSummary = {
    approvedSourceCount: 0,
    verifiedRelationshipCount: grounding.edges.length,
    approvedLiveSignalCount:
      ((grounding.currentSignals as Array<Record<string, unknown>> | undefined)?.length ?? 0) +
      (grounding.recentSignals.length ?? 0),
  };

  if (approvedAskEnforcementEnabled() && !approvedContextReady(approvedSummary)) {
    return NextResponse.json(buildApprovedContextRefusal(approvedSummary), { status: 412 });
  }
```

- [ ] **Step 4: Run the route test and helper test**

Run:

```powershell
cd mira-hub
npm test -- src/lib/__tests__/approved-context.test.ts src/app/api/mira/ask/__tests__/route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```powershell
git add mira-hub/src/app/api/mira/ask/route.ts mira-hub/src/app/api/mira/ask/__tests__/route.test.ts
git commit -m "feat: gate ask mira on verified kg context"
```

---

### Task 3: Approved Live Telemetry Filters For `/api/mira/ask`

**Files:**
- Modify: `mira-hub/src/app/api/mira/ask/route.ts:205-234`
- Test: `mira-hub/src/app/api/mira/ask/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `approved_tags` schema from `mira-hub/db/migrations/035_approved_tags.sql:39` through `mira-hub/db/migrations/035_approved_tags.sql:60`.
- Produces: live event/cache grounding that only includes `approved_tags.enabled = true`.

- [ ] **Step 1: Add failing assertions for approved live tag joins**

Append to the existing `/api/mira/ask` route test:

```ts
  it("requires approved_tags for recent and current live grounding", async () => {
    const calls: string[] = [];
    const client = mockClient(
      [
        {
          match: "FROM troubleshooting_sessions",
          rows: [{
            id: sessionId,
            status: "confirmed",
            asset_id: assetId,
            component_id: null,
            transcript: [],
            asset_name: "Conveyor",
            asset_tag: "Plant.Line.Conveyor",
          }],
        },
        { match: "FROM kg_relationships r", rows: [{ relationship_type: "feeds", confidence: 1, s_type: "asset", s_name: "A", t_type: "asset", t_name: "B" }] },
        { match: "FROM live_signal_events e", rows: [] },
        { match: "FROM live_signal_cache cache", rows: [] },
      ],
      calls,
    );
    vi.mocked(withTenantContext).mockImplementation(async (_tenant, fn) => fn(client));

    await POST(req());

    const recentSql = calls.find((sql) => sql.includes("FROM live_signal_events e")) ?? "";
    const currentSql = calls.find((sql) => sql.includes("FROM live_signal_cache cache")) ?? "";
    expect(recentSql).toMatch(/JOIN approved_tags/i);
    expect(recentSql).toMatch(/approved_tags[\s\S]+enabled\s*=\s*true/i);
    expect(currentSql).toMatch(/JOIN approved_tags/i);
    expect(currentSql).toMatch(/approved_tags[\s\S]+enabled\s*=\s*true/i);
  });
```

- [ ] **Step 2: Run the route test and verify it fails**

Run:

```powershell
cd mira-hub
npm test -- src/app/api/mira/ask/__tests__/route.test.ts
```

Expected: FAIL because recent/current live SQL does not join `approved_tags`.

- [ ] **Step 3: Add approved-tag joins to recent and current signal SQL**

Use `uns_path` when present, with normalized tag path fallback for existing rows:

```sql
           JOIN approved_tags at
             ON at.tenant_id = e.tenant_id
            AND at.enabled = true
            AND (
              at.uns_path = e.uns_path
              OR at.normalized_tag_path = e.plc_tag
            )
```

and:

```sql
           JOIN approved_tags at
             ON at.tenant_id = cache.tenant_id
            AND at.enabled = true
            AND (
              at.uns_path = cache.uns_path
              OR at.normalized_tag_path = cache.plc_tag
            )
```

If the concrete columns in `live_signal_events` differ, verify them from the migrations or `mira-hub/src/lib/signal-recorder.ts:179` through `mira-hub/src/lib/signal-recorder.ts:210` before editing. UNKNOWN: this plan has not re-read the live signal table migration in this turn.

- [ ] **Step 4: Run the route test**

Run:

```powershell
cd mira-hub
npm test -- src/app/api/mira/ask/__tests__/route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```powershell
git add mira-hub/src/app/api/mira/ask/route.ts mira-hub/src/app/api/mira/ask/__tests__/route.test.ts
git commit -m "feat: filter ask mira live context to approved tags"
```

---

### Task 4: Node And Asset Chat Zero-Approved-Source Refusal

**Files:**
- Modify: `mira-hub/src/app/api/namespace/node/[id]/chat/route.ts:284-286`
- Modify: `mira-hub/src/app/api/namespace/node/[id]/chat/__tests__/route.test.ts`
- Modify: `mira-hub/src/app/api/assets/[id]/chat/route.ts:306-308`
- Create: `mira-hub/src/app/api/assets/[id]/chat/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `approvedAskEnforcementEnabled`, `approvedContextReady`, and `buildApprovedContextRefusal`.
- Produces: answer routes that return 412 JSON before provider calls when enforcement is enabled and approved source count is zero.

- [ ] **Step 1: Add a node chat failing test**

Append to `mira-hub/src/app/api/namespace/node/[id]/chat/__tests__/route.test.ts`:

```ts
  it("returns approved_context without calling providers when enforced and no verified node docs exist", async () => {
    process.env.NEON_DATABASE_URL = "postgres://test";
    process.env.MIRA_ENFORCE_APPROVED_ASK = "true";
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(withTenantContext).mockImplementation(async (_tenantId, fn) =>
      fn({
        query: vi.fn(async (sql: string) => {
          if (sql.includes("FROM kg_entities")) return { rows: [{ name: "Motor", uns_path: "Plant.Line.Motor" }] };
          return { rows: [] };
        }),
      }),
    );

    const res = await POST(makeReq(userMsg("what does this fault mean?")), makeParams(VALID_UUID));
    const body = await res.json();

    expect(res.status).toBe(412);
    expect(body.gate).toBe("approved_context");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Create the smallest asset chat test**

Create `mira-hub/src/app/api/assets/[id]/chat/__tests__/route.test.ts` by copying only the session, tenant-context, and fetch mock pattern from the node chat test. The test must assert:

```ts
expect(res.status).toBe(412);
expect(body.gate).toBe("approved_context");
expect(fetchSpy).not.toHaveBeenCalled();
```

The asset test should mock `pool.connect().query()` so the `cmms_equipment` lookup returns one row and `retrieveManualChunks` returns no rows. If mocking the raw `pool` is too broad, extract a tiny helper in the asset route first and test that helper in the same task.

- [ ] **Step 3: Run the node and asset route tests and verify they fail**

Run:

```powershell
cd mira-hub
npm test -- "src/app/api/namespace/node/[id]/chat/__tests__/route.test.ts" "src/app/api/assets/[id]/chat/__tests__/route.test.ts"
```

Expected: FAIL because routes continue to stream and call providers with zero approved sources.

- [ ] **Step 4: Add refusal before stream construction**

In node chat, after `approvedSourceCount` is computed at `mira-hub/src/app/api/namespace/node/[id]/chat/route.ts:286` and before `const fullMessages`:

```ts
  const approvedSummary = {
    approvedSourceCount,
    verifiedRelationshipCount: 0,
    approvedLiveSignalCount: 0,
  };

  if (approvedAskEnforcementEnabled() && !approvedContextReady(approvedSummary)) {
    return NextResponse.json(buildApprovedContextRefusal(approvedSummary), { status: 412 });
  }
```

In asset chat, after `approvedSourceCount` is computed at `mira-hub/src/app/api/assets/[id]/chat/route.ts:308` and before `const fullMessages`:

```ts
  const approvedSummary = {
    approvedSourceCount,
    verifiedRelationshipCount: graphContext ? 1 : 0,
    approvedLiveSignalCount: 0,
  };

  if (approvedAskEnforcementEnabled() && !approvedContextReady(approvedSummary)) {
    return NextResponse.json(buildApprovedContextRefusal(approvedSummary), { status: 412 });
  }
```

Import the helper functions in both routes.

- [ ] **Step 5: Run the route tests**

Run:

```powershell
cd mira-hub
npm test -- src/lib/__tests__/approved-context.test.ts "src/app/api/namespace/node/[id]/chat/__tests__/route.test.ts" "src/app/api/assets/[id]/chat/__tests__/route.test.ts"
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```powershell
git add mira-hub/src/app/api/namespace/node/[id]/chat/route.ts mira-hub/src/app/api/namespace/node/[id]/chat/__tests__/route.test.ts mira-hub/src/app/api/assets/[id]/chat/route.ts mira-hub/src/app/api/assets/[id]/chat/__tests__/route.test.ts
git commit -m "feat: refuse unapproved asset chat context"
```

---

### Task 5: Answer-Facing KG Context Filters

**Files:**
- Modify: `mira-hub/src/lib/knowledge-graph/context-builder.ts:90`, `mira-hub/src/lib/knowledge-graph/context-builder.ts:118`, `mira-hub/src/lib/knowledge-graph/context-builder.ts:131`
- Modify: `mira-hub/src/lib/knowledge-graph/traversal.ts:95`, `mira-hub/src/lib/knowledge-graph/traversal.ts:157`, `mira-hub/src/lib/knowledge-graph/traversal.ts:416`, `mira-hub/src/lib/knowledge-graph/traversal.ts:450`, `mira-hub/src/lib/knowledge-graph/traversal.ts:460`, `mira-hub/src/lib/knowledge-graph/traversal.ts:473`, `mira-hub/src/lib/knowledge-graph/traversal.ts:481`, `mira-hub/src/lib/knowledge-graph/traversal.ts:489`, `mira-hub/src/lib/knowledge-graph/traversal.ts:499`, `mira-hub/src/lib/knowledge-graph/traversal.ts:508`
- Test: `mira-hub/src/lib/knowledge-graph/__tests__/context-builder.test.ts`
- Test: `mira-hub/src/lib/knowledge-graph/__tests__/traversal.test.ts`

**Interfaces:**
- Consumes: canonical verified state from `mira-hub/src/lib/i3x/approval.ts:16`.
- Produces: KG context used by asset chat that excludes proposed/rejected/missing approval rows.

- [ ] **Step 1: Add query-capture tests**

Add a context-builder test that calls the exported function with a mocked DB client and asserts any query reading `kg_entities` for an answer anchor includes:

```ts
expect(sql).toMatch(/approval_state\s*=\s*'verified'/i);
```

Add a relationship query assertion:

```ts
expect(sql).toMatch(/r\.approval_state\s*=\s*'verified'/i);
```

Add traversal query assertions for each helper used by `buildGraphContext`:

```ts
expect(sqlBlob).toMatch(/kg_relationships[\s\S]+approval_state\s*=\s*'verified'/i);
expect(sqlBlob).not.toMatch(/approval_state\s+IS\s+NULL/i);
```

- [ ] **Step 2: Run context-builder and traversal tests and verify they fail**

Run:

```powershell
cd mira-hub
npm test -- src/lib/knowledge-graph/__tests__/context-builder.test.ts src/lib/knowledge-graph/__tests__/traversal.test.ts
```

Expected: FAIL because the current queries are unfiltered.

- [ ] **Step 3: Add verified filters to answer-facing KG queries**

Use the literal value `'verified'` in SQL to align with the partial index created at `mira-hub/db/migrations/029_kg_approval_state.sql:33`.

For entity lookups:

```sql
WHERE tenant_id = $1
  AND approval_state = 'verified'
```

For relationship joins:

```sql
JOIN kg_relationships r
  ON ...
 AND r.approval_state = 'verified'
```

For joined entities:

```sql
JOIN kg_entities e
  ON ...
 AND e.approval_state = 'verified'
```

Do not change proposal writers or graph extraction writers in this task; those already route proposed context through proposals rather than directly to verified KG rows.

- [ ] **Step 4: Run the KG tests**

Run:

```powershell
cd mira-hub
npm test -- src/lib/knowledge-graph/__tests__/context-builder.test.ts src/lib/knowledge-graph/__tests__/traversal.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run answer-route tests that depend on KG context**

Run:

```powershell
cd mira-hub
npm test -- src/app/api/assets/[id]/chat/__tests__/route.test.ts src/app/api/mira/ask/__tests__/route.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```powershell
git add mira-hub/src/lib/knowledge-graph/context-builder.ts mira-hub/src/lib/knowledge-graph/traversal.ts mira-hub/src/lib/knowledge-graph/__tests__/context-builder.test.ts mira-hub/src/lib/knowledge-graph/__tests__/traversal.test.ts
git commit -m "feat: restrict answer kg context to verified edges"
```

---

### Task 6: Verification, Stack Hygiene, And Draft PR

**Files:**
- Modify only if needed: `docs/plans/2026-06-25-context-spine-unification-plan.md`

**Interfaces:**
- Consumes: commits from Tasks 1-5.
- Produces: a draft PR stacked after #2308 with test evidence.

- [ ] **Step 1: Run targeted unit and route tests**

Run:

```powershell
cd mira-hub
npm test -- src/lib/__tests__/approved-context.test.ts src/lib/__tests__/manual-rag.test.ts src/lib/knowledge-graph/__tests__/context-builder.test.ts src/lib/knowledge-graph/__tests__/traversal.test.ts src/app/api/mira/ask/__tests__/route.test.ts "src/app/api/namespace/node/[id]/chat/__tests__/route.test.ts" "src/app/api/assets/[id]/chat/__tests__/route.test.ts"
```

Expected: PASS.

- [ ] **Step 2: Run lint**

Run:

```powershell
cd mira-hub
npm run lint
```

Expected: PASS or only pre-existing unrelated warnings. If lint fails in touched files, fix before PR.

- [ ] **Step 3: Run build if targeted tests pass**

Run:

```powershell
cd mira-hub
npm run build
```

Expected: PASS. If build is blocked by an external service/env requirement, capture the exact failure in the PR body.

- [ ] **Step 4: Check stack state**

Run:

```powershell
git status --short --branch
gh pr view 2308 --json number,state,isDraft,mergeStateStatus,baseRefName,headRefName,url
gh pr view 2307 --json number,state,isDraft,mergeStateStatus,baseRefName,headRefName,url
```

Expected: working tree has only intentional changes; #2308 remains the intended base or has been merged/rebased.

- [ ] **Step 5: Create a stacked draft PR**

Use the branch name:

```powershell
git switch -c codex/context-spine-approved-ask-mira
git push -u origin codex/context-spine-approved-ask-mira
gh pr create --draft --base codex/context-spine-readiness-checklist --head codex/context-spine-approved-ask-mira --title "[codex] Gate Ask MIRA on approved context" --body-file .superpowers/pr-approved-context-ask-mira.md
```

PR body must include:

```markdown
## Summary
- Gates `/api/mira/ask` before provider calls unless approved context exists.
- Restricts answer-facing KG relationships/entities to `approval_state = 'verified'`.
- Restricts live Ask MIRA grounding to `approved_tags.enabled = true`.
- Uses existing missing-context checklist shape for refusal.

## Tests
- `npm test -- src/lib/__tests__/approved-context.test.ts ...`
- `npm run lint`
- `npm run build`

## Safety
- No new database or graph store.
- No live write/control paths.
- Enforcement remains feature-flagged through `MIRA_ENFORCE_APPROVED_ASK` or `MIRA_ENFORCE_APPROVED_RETRIEVAL`.
```

---

## Risks And Follow-Ups

- `MIRA_ENFORCE_APPROVED_RETRIEVAL` already changes manual retrieval behavior at `mira-hub/src/lib/manual-rag.ts:51`; adding `MIRA_ENFORCE_APPROVED_ASK` as an alias keeps answer refusal explicit without breaking existing environments.
- `approved_tags` joins in Task 3 must be checked against the actual live signal table columns before editing. The plan found signal cache writes in `mira-hub/src/lib/signal-recorder.ts:179`, but did not re-read the table migration in this planning pass.
- Graph UI and namespace node read APIs have unfiltered gaps, including `mira-hub/src/app/api/kg/graph/route.ts:45` and `mira-hub/src/app/api/namespace/node/[id]/route.ts:146`. Keep them out of this PR unless answer-path tests prove they feed MIRA responses.
- `mira-hub/src/lib/knowledge-graph/graph-view.ts:86` currently defaults null approval state to `verified`; that should be a follow-up PR because it may affect UI visualization semantics outside Ask MIRA.
- If #2307 remains dirty against `main`, refresh that base before marking any stacked PR ready for review.

## Smallest Possible PR Plan

1. Add the approved-context helper and tests.
2. Add `/api/mira/ask` route tests and enforce verified KG plus approved live telemetry under flags.
3. Add zero-approved-source refusal to node/asset chat using existing counts.
4. Filter answer-facing KG context builder/traversal paths to verified rows.
5. Open a draft PR stacked on #2308 with targeted test, lint, and build evidence.
