# KG Relationship Graph — Phase 1 (Live Render) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the knowledge graph's *existing* edges live in a new `/hub/graph` page in the FactoryLM Hub, querying NeonDB directly — replacing the static `kg_relationship_sphere.html` snapshot.

**Architecture:** A new session-authed `GET /api/kg/graph` endpoint reads `kg_entities` + `kg_relationships` for the caller's tenant, runs a pure transform into `{nodes, links}` (degree precomputed, dangling links dropped), and returns JSON. A client page renders it with `react-force-graph-2d` (Obsidian-style: degree sizing, color-by-type, search, type filters, orphan toggle, click→detail panel). The pure transform is unit-tested; the thin SQL follows the existing `withTenantContext` pattern.

**Tech Stack:** Next.js App Router, TypeScript, `pg` + `withTenantContext` (RLS), vitest, bun, `react-force-graph-2d`.

**Scope decision (no silent caps):** The MVP loads the *full tenant graph at once* (current data is ~578 nodes / 289 edges — trivial for the renderer) and implements "expand/focus" as **client-side neighbor highlighting**. A server-side depth-limited neighborhood query (`?focus=&depth=`) and dashed "proposed" suggestion edges are **deferred to Phase 2** per the design spec. The endpoint caps nodes at 5000 and the response states if the cap was hit.

**Spec:** `docs/superpowers/specs/2026-06-02-kg-relationship-graph-design.md`

---

### Task 1: Pure graph-builder transform (the testable core)

**Files:**
- Create: `mira-hub/src/lib/knowledge-graph/graph-view.ts`
- Test: `mira-hub/src/lib/knowledge-graph/__tests__/graph-view.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// mira-hub/src/lib/knowledge-graph/__tests__/graph-view.test.ts
import { describe, test, expect } from "vitest";
import { buildGraphPayload, type EntityRow, type RelRow } from "../graph-view";

const entities: EntityRow[] = [
  { id: "a", entity_type: "equipment", name: "VFD-07", uns_path: "ent.site.vfd07" },
  { id: "b", entity_type: "manual", name: "PowerFlex Manual", uns_path: null },
  { id: "c", entity_type: "fault_code", name: "F004", uns_path: null }, // orphan
];

describe("buildGraphPayload", () => {
  test("maps nodes and labels (name, fallback to id)", () => {
    const p = buildGraphPayload(
      [{ id: "x", entity_type: "part", name: null, uns_path: null }],
      [],
    );
    expect(p.nodes[0]).toMatchObject({ id: "x", type: "part", label: "x", degree: 0 });
  });

  test("computes degree on both endpoints", () => {
    const rels: RelRow[] = [
      { source_id: "a", target_id: "b", relationship_type: "has_manual", confidence: 1, approval_state: "verified" },
    ];
    const p = buildGraphPayload(entities, rels);
    const byId = Object.fromEntries(p.nodes.map((n) => [n.id, n]));
    expect(byId["a"].degree).toBe(1);
    expect(byId["b"].degree).toBe(1);
    expect(byId["c"].degree).toBe(0); // orphan retained at degree 0
  });

  test("drops links whose endpoint is missing", () => {
    const rels: RelRow[] = [
      { source_id: "a", target_id: "ZZZ", relationship_type: "has_manual", confidence: 1, approval_state: "verified" },
    ];
    const p = buildGraphPayload(entities, rels);
    expect(p.links).toHaveLength(0);
    expect(p.nodes.find((n) => n.id === "a")?.degree).toBe(0);
  });

  test("defaults confidence=1 and state=verified when null", () => {
    const rels: RelRow[] = [
      { source_id: "a", target_id: "b", relationship_type: "has_manual", confidence: null, approval_state: null },
    ];
    const p = buildGraphPayload(entities, rels);
    expect(p.links[0]).toMatchObject({ confidence: 1, state: "verified" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mira-hub && bun run test -- graph-view`
Expected: FAIL — cannot find module `../graph-view`.

- [ ] **Step 3: Write minimal implementation**

```ts
// mira-hub/src/lib/knowledge-graph/graph-view.ts
/**
 * Pure transform from KG table rows into the {nodes, links} shape every
 * force-graph library consumes. No DB, no IO — unit-tested in isolation.
 * Degree is precomputed server-side so the client just maps nodeVal.
 */

export interface EntityRow {
  id: string;
  entity_type: string;
  name: string | null;
  uns_path: string | null;
}

export interface RelRow {
  source_id: string;
  target_id: string;
  relationship_type: string;
  confidence: number | null;
  approval_state: string | null;
}

export interface GraphNode {
  id: string;
  type: string;
  label: string;
  degree: number;
  unsPath: string | null;
}

export interface GraphLink {
  source: string;
  target: string;
  type: string;
  confidence: number;
  state: string;
}

export interface GraphPayload {
  nodes: GraphNode[];
  links: GraphLink[];
}

export function buildGraphPayload(entities: EntityRow[], rels: RelRow[]): GraphPayload {
  const nodes = new Map<string, GraphNode>();
  for (const e of entities) {
    nodes.set(e.id, {
      id: e.id,
      type: e.entity_type,
      label: e.name && e.name.length > 0 ? e.name : e.id,
      degree: 0,
      unsPath: e.uns_path,
    });
  }

  const links: GraphLink[] = [];
  for (const r of rels) {
    const src = nodes.get(r.source_id);
    const tgt = nodes.get(r.target_id);
    if (!src || !tgt) continue; // drop dangling edges
    src.degree += 1;
    tgt.degree += 1;
    links.push({
      source: r.source_id,
      target: r.target_id,
      type: r.relationship_type,
      confidence: r.confidence ?? 1,
      state: r.approval_state ?? "verified",
    });
  }

  return { nodes: [...nodes.values()], links };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mira-hub && bun run test -- graph-view`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add mira-hub/src/lib/knowledge-graph/graph-view.ts mira-hub/src/lib/knowledge-graph/__tests__/graph-view.test.ts
git commit -m "feat(kg): pure graph-view transform (rows -> nodes/links) with degree"
```

---

### Task 2: `GET /api/kg/graph` endpoint

**Files:**
- Create: `mira-hub/src/app/api/kg/graph/route.ts`

Follows the exact pattern of `mira-hub/src/app/api/proposals/route.ts`: `NEON_DATABASE_URL` guard → 503, `sessionOr401()` for tenant, `withTenantContext` for the query, explicit `tenant_id = $1::uuid` filter.

- [ ] **Step 1: Write the route**

```ts
// mira-hub/src/app/api/kg/graph/route.ts
/**
 * GET /api/kg/graph — live {nodes, links} for the caller's tenant.
 *
 * Reads kg_entities + kg_relationships and returns the force-graph payload
 * for the /hub/graph page. Session-authed (NOT the service-token internal
 * KG endpoint). Full-tenant graph for now; neighborhood/proposal edges are
 * Phase 2 (see design spec).
 *
 * Query params:
 *   types — optional comma-separated entity_type allow-list (e.g. "equipment,manual").
 */
import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { buildGraphPayload, type EntityRow, type RelRow } from "@/lib/knowledge-graph/graph-view";

export const dynamic = "force-dynamic";

const NODE_CAP = 5000;

export async function GET(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(req.url);
  const typeParam = url.searchParams.get("types");

  try {
    const { entities, rels } = await withTenantContext(ctx.tenantId, async (c) => {
      const e = await c.query<EntityRow>(
        `SELECT id, entity_type, name, uns_path::text AS uns_path
           FROM kg_entities
          WHERE tenant_id = $1::uuid
          LIMIT $2`,
        [ctx.tenantId, NODE_CAP],
      );
      const r = await c.query<RelRow>(
        `SELECT source_id, target_id, relationship_type, confidence, approval_state
           FROM kg_relationships
          WHERE tenant_id = $1::uuid`,
        [ctx.tenantId],
      );
      return { entities: e.rows, rels: r.rows };
    });

    let payload = buildGraphPayload(entities, rels);

    if (typeParam) {
      const types = new Set(typeParam.split(",").map((s) => s.trim()).filter(Boolean));
      const keep = new Set(payload.nodes.filter((n) => types.has(n.type)).map((n) => n.id));
      payload = {
        nodes: payload.nodes.filter((n) => keep.has(n.id)),
        links: payload.links.filter((l) => keep.has(l.source) && keep.has(l.target)),
      };
    }

    return NextResponse.json({
      ...payload,
      capped: entities.length >= NODE_CAP,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "internal error" },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Type-check and lint**

Run: `cd mira-hub && bunx tsc --noEmit && bun run lint`
Expected: no errors for the new file. (If `kg_entities.uns_path` does not exist in a given branch, the query errors at runtime, not compile — verified live in Task 6.)

- [ ] **Step 3: Commit**

```bash
git add mira-hub/src/app/api/kg/graph/route.ts
git commit -m "feat(kg): GET /api/kg/graph live nodes/links endpoint (session-authed)"
```

---

### Task 3: `GraphCanvas` client component

**Files:**
- Create: `mira-hub/src/components/kg/GraphCanvas.tsx`
- Modify: `mira-hub/package.json` (add `react-force-graph-2d`)

- [ ] **Step 1: Install the renderer**

Run: `cd mira-hub && bun add react-force-graph-2d`
Expected: `react-force-graph-2d` appears in `package.json` dependencies; `bun.lock` updated.

- [ ] **Step 2: Write the component**

```tsx
// mira-hub/src/components/kg/GraphCanvas.tsx
"use client";

import dynamic from "next/dynamic";
import type { GraphNode, GraphLink } from "@/lib/knowledge-graph/graph-view";

// react-force-graph-2d touches window/canvas → must be client-only.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

export interface GraphCanvasData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export function GraphCanvas({
  data,
  onNodeClick,
}: {
  data: GraphCanvasData;
  onNodeClick?: (node: GraphNode) => void;
}) {
  return (
    <ForceGraph2D
      graphData={data}
      backgroundColor="#0b0f1a"
      nodeAutoColorBy="type"
      nodeVal={(n: GraphNode) => 1 + n.degree}
      nodeLabel={(n: GraphNode) => `${n.label} — ${n.type}`}
      nodeRelSize={4}
      linkColor={(l: GraphLink) => (l.state === "proposed" ? "#6b7280" : "#3a4252")}
      linkWidth={(l: GraphLink) => (l.state === "proposed" ? 0.5 : 1)}
      onNodeClick={(n: object) => onNodeClick?.(n as GraphNode)}
      cooldownTicks={120}
    />
  );
}
```

Note: `react-force-graph-2d` ships its own type declarations. If `bunx tsc --noEmit` reports the generic-prop signatures don't match, narrow the offending callbacks to `(n: any)` with an inline `// eslint-disable-next-line @typescript-eslint/no-explicit-any` rather than fighting the upstream generics — the runtime contract above is correct.

- [ ] **Step 3: Type-check**

Run: `cd mira-hub && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add mira-hub/src/components/kg/GraphCanvas.tsx mira-hub/package.json mira-hub/bun.lock
git commit -m "feat(kg): GraphCanvas force-graph component (react-force-graph-2d, ssr:false)"
```

---

### Task 4: `/hub/graph` page — fetch + render

**Files:**
- Create: `mira-hub/src/app/(hub)/graph/page.tsx`

- [ ] **Step 1: Write the page (basic fetch + render)**

```tsx
// mira-hub/src/app/(hub)/graph/page.tsx
"use client";

import { useEffect, useState } from "react";
import { GraphCanvas } from "@/components/kg/GraphCanvas";
import type { GraphNode, GraphLink } from "@/lib/knowledge-graph/graph-view";

interface GraphResponse {
  nodes: GraphNode[];
  links: GraphLink[];
  capped?: boolean;
  error?: string;
}

export default function GraphPage() {
  const [data, setData] = useState<GraphResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/kg/graph")
      .then((r) => r.json())
      .then((j: GraphResponse) => {
        if (j.error) setError(j.error);
        else setData(j);
      })
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="p-6 text-red-400">Graph error: {error}</div>;
  if (!data) return <div className="p-6 text-slate-400">Loading relationship graph…</div>;

  return (
    <div className="relative h-[calc(100vh-4rem)] w-full">
      <div className="absolute left-4 top-4 z-10 rounded-md bg-slate-900/70 px-3 py-2 text-sm text-slate-200">
        <div className="font-semibold text-white">Relationship Graph</div>
        <div className="text-slate-400">
          {data.nodes.length} nodes · {data.links.length} edges
          {data.capped ? " (capped)" : ""}
        </div>
      </div>
      <GraphCanvas data={data} />
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd mira-hub && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "mira-hub/src/app/(hub)/graph/page.tsx"
git commit -m "feat(kg): /hub/graph page renders live KG via /api/kg/graph"
```

---

### Task 5: Page controls — search, type filter, orphan toggle, detail panel

**Files:**
- Modify: `mira-hub/src/app/(hub)/graph/page.tsx`

- [ ] **Step 1: Add controls and a node-detail panel**

Replace the body of `GraphPage` with the version below (adds: derived list of entity types with toggles, a search box that highlights/filters, an orphan toggle, and a right-hand detail panel populated on node click).

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { GraphCanvas } from "@/components/kg/GraphCanvas";
import type { GraphNode, GraphLink } from "@/lib/knowledge-graph/graph-view";

interface GraphResponse {
  nodes: GraphNode[];
  links: GraphLink[];
  capped?: boolean;
  error?: string;
}

export default function GraphPage() {
  const [raw, setRaw] = useState<GraphResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [showOrphans, setShowOrphans] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<GraphNode | null>(null);

  useEffect(() => {
    fetch("/api/kg/graph")
      .then((r) => r.json())
      .then((j: GraphResponse) => (j.error ? setError(j.error) : setRaw(j)))
      .catch((e) => setError(String(e)));
  }, []);

  const types = useMemo(
    () => [...new Set((raw?.nodes ?? []).map((n) => n.type))].sort(),
    [raw],
  );

  const view = useMemo(() => {
    if (!raw) return { nodes: [], links: [] };
    const q = query.trim().toLowerCase();
    const keep = new Set(
      raw.nodes
        .filter((n) => !hiddenTypes.has(n.type))
        .filter((n) => showOrphans || n.degree > 0)
        .filter((n) => !q || n.label.toLowerCase().includes(q))
        .map((n) => n.id),
    );
    return {
      nodes: raw.nodes.filter((n) => keep.has(n.id)),
      links: raw.links.filter((l) => keep.has(l.source) && keep.has(l.target)),
    };
  }, [raw, hiddenTypes, showOrphans, query]);

  if (error) return <div className="p-6 text-red-400">Graph error: {error}</div>;
  if (!raw) return <div className="p-6 text-slate-400">Loading relationship graph…</div>;

  return (
    <div className="relative h-[calc(100vh-4rem)] w-full">
      {/* HUD */}
      <div className="absolute left-4 top-4 z-10 w-64 space-y-2 rounded-md bg-slate-900/80 p-3 text-sm text-slate-200">
        <div className="font-semibold text-white">Relationship Graph</div>
        <div className="text-xs text-slate-400">
          {view.nodes.length}/{raw.nodes.length} nodes · {view.links.length} edges
          {raw.capped ? " (capped)" : ""}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search nodes…"
          className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs outline-none"
        />
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={showOrphans}
            onChange={(e) => setShowOrphans(e.target.checked)}
          />
          Show orphans
        </label>
        <div className="space-y-1">
          {types.map((t) => (
            <label key={t} className="flex cursor-pointer items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={!hiddenTypes.has(t)}
                onChange={(e) => {
                  setHiddenTypes((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.delete(t);
                    else next.add(t);
                    return next;
                  });
                }}
              />
              {t}
            </label>
          ))}
        </div>
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="absolute right-4 top-4 z-10 w-72 rounded-md bg-slate-900/90 p-4 text-sm text-slate-200">
          <button
            onClick={() => setSelected(null)}
            className="float-right text-slate-500 hover:text-slate-300"
          >
            ✕
          </button>
          <div className="mb-1 font-semibold text-white">{selected.label}</div>
          <div className="text-xs text-slate-400">type: {selected.type}</div>
          <div className="text-xs text-slate-400">degree: {selected.degree}</div>
          {selected.unsPath && (
            <div className="mt-2 break-words text-xs text-slate-400">
              {selected.unsPath}
            </div>
          )}
        </div>
      )}

      <GraphCanvas data={view} onNodeClick={setSelected} />
    </div>
  );
}
```

- [ ] **Step 2: Type-check and lint**

Run: `cd mira-hub && bunx tsc --noEmit && bun run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "mira-hub/src/app/(hub)/graph/page.tsx"
git commit -m "feat(kg): graph page controls — search, type filter, orphan toggle, detail panel"
```

---

### Task 6: Wire into Hub nav + live verification

**Files:**
- Modify: the Hub navigation config (locate in Step 1)

- [ ] **Step 1: Locate the nav config**

Run: `cd mira-hub && grep -rnE "href=\"/(hub/)?(proposals|namespace|knowledge)\"|/hub/proposals" src/app src/components | head`
This finds where existing hub destinations (e.g. `proposals`, `namespace`) are registered. Add a sibling entry for Graph pointing at `/hub/graph` (or `/graph` if the group uses bare paths — match the neighbors exactly), using a `lucide-react` icon already imported in that file (e.g. `Share2` or `Network`).

- [ ] **Step 2: Add the nav entry**

In the file found above, add an item mirroring the adjacent ones. Example shape (match the surrounding array's exact field names):

```tsx
{ label: "Graph", href: "/hub/graph", icon: Network },
```

If `Network` is not already imported from `lucide-react` in that file, add it to the existing `lucide-react` import line.

- [ ] **Step 3: Live verification against Neon**

```bash
cd mira-hub && bun run dev
```
Then, in a browser logged into a tenant that has KG data:
- Visit `http://localhost:3000/hub/graph`.
- Confirm: the HUD shows a non-zero node/edge count; nodes are colored by type; dragging/zoom works; typing in Search filters; toggling a type hides those nodes; "Show orphans" off removes degree-0 nodes; clicking a node opens the detail panel with type/degree/UNS path.

Capture a screenshot for the PR (Playwright MCP `browser_navigate` → `browser_take_screenshot`, or manual). Expected: the equipment↔manual web renders live, sourced from `/api/kg/graph` (verify in the Network tab the response is real JSON, not the static HTML).

- [ ] **Step 4: Run the full unit suite + type-check**

Run: `cd mira-hub && bun run test && bunx tsc --noEmit`
Expected: all tests pass (including `graph-view`), no type errors.

- [ ] **Step 5: Commit**

```bash
git add -A mira-hub/src
git commit -m "feat(kg): add Graph to hub nav; verify live render against Neon"
```

- [ ] **Step 6: Request code review**

Use superpowers:requesting-code-review before opening the PR. Confirm: tenant isolation (every query filters `tenant_id = $1`), no service-token endpoint exposed to the browser, `ssr:false` on the canvas, and the static `kg_relationship_sphere.html` is now superseded by the live page.

---

## Self-review notes

- **Spec coverage:** render existing edges live (Tasks 1–5 ✓), Obsidian-style degree sizing + color-by-type + search + orphan toggle + detail panel (Tasks 3–5 ✓), live from Neon not static (Task 2, Task 6 verify ✓), nav entry (Task 6 ✓). Deferred-by-design and stated explicitly: server-side neighborhood `?focus=&depth=`, dashed proposal/suggestion edges, 3D toggle, GraphRAG wiring (Phases 2–3).
- **Placeholder scan:** none — every code/test/command step is concrete. The two discovery steps (Task 6 nav location; the react-force-graph type-narrowing note) give exact commands/fallbacks rather than "TBD".
- **Type consistency:** `EntityRow`/`RelRow`/`GraphNode`/`GraphLink`/`GraphPayload` and `buildGraphPayload` are defined once in Task 1 and reused verbatim in Tasks 2–5. `state` values `"verified"|"proposed"` are consistent between the transform default and the `GraphCanvas` link styling.
