import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import {
  appendManualContext,
  buildGroundedContext,
  chunksToSources,
  retrieveManualChunks,
  retrieveNodeChunks,
  type ManualChunk,
} from "../manual-rag";

function makeClient(scriptedRows: Array<Record<string, unknown>[]>): {
  client: PoolClient;
  calls: Array<{ sql: string; params: unknown[] }>;
} {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[]) => {
    calls.push({ sql, params });
    const rows = scriptedRows.shift() ?? [];
    return { rows };
  });
  return { client: { query } as unknown as PoolClient, calls };
}

const row = (overrides: Partial<Record<string, unknown>> = {}) => ({
  content: "Set torque to 35 ft-lbs on motor mount bolts.",
  manufacturer: "Allen-Bradley",
  model_number: "PowerFlex 525",
  source_url: "https://example.com/pf525.pdf",
  source_page: 42,
  title: "PowerFlex 525 Service Manual",
  rank: 0.42,
  ...overrides,
});

describe("retrieveManualChunks", () => {
  it("returns empty for empty query without touching DB", async () => {
    const { client, calls } = makeClient([]);
    const out = await retrieveManualChunks(client, "tenant-1", "   ");
    expect(out).toEqual([]);
    expect(calls.length).toBe(0);
  });

  it("applies manufacturer filter and returns mapped chunks", async () => {
    const { client, calls } = makeClient([[row()]]);
    const out = await retrieveManualChunks(client, "tenant-1", "what is the torque", {
      manufacturer: "Allen-Bradley",
      topK: 4,
    });
    expect(out).toHaveLength(1);
    expect(out[0].manufacturer).toBe("Allen-Bradley");
    expect(out[0].sourcePage).toBe(42);
    expect(out[0].title).toBe("PowerFlex 525 Service Manual");
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain("manufacturer ILIKE");
    expect(calls[0].params).toEqual([
      "tenant-1",
      "what is the torque",
      "%Allen-Bradley%",
      4,
    ]);
  });

  it("falls back to tenant-only retrieval when the manufacturer scope is fully empty", async () => {
    // Each scope now tries AND then OR, so the mfr scope must exhaust both
    // (AND empty, OR empty) before the tenant-only query runs.
    const { client, calls } = makeClient([[], [], [row({ manufacturer: "Generic" })]]);
    const out = await retrieveManualChunks(client, "tenant-1", "torque", {
      manufacturer: "Allen-Bradley",
    });
    expect(out).toHaveLength(1);
    expect(calls).toHaveLength(3);
    expect(calls[0].sql).toContain("manufacturer ILIKE"); // mfr AND
    expect(calls[1].sql).toContain("manufacturer ILIKE"); // mfr OR
    expect(calls[2].sql).not.toContain("manufacturer ILIKE"); // tenant-only
  });

  it("falls back to an OR tsquery when the precise AND query is empty (no mfr)", async () => {
    const { client, calls } = makeClient([[], [row()]]);
    const out = await retrieveManualChunks(client, "tenant-1", "what does oC mean");
    expect(out).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toContain("plainto_tsquery('english', $2)");
    expect(calls[0].sql).not.toContain("replace(");
    expect(calls[1].sql).toContain("replace(plainto_tsquery('english', $2)::text, ' & ', ' | ')");
  });

  it("keeps the precise AND result and does NOT run the OR fallback when AND matches", async () => {
    const { client, calls } = makeClient([[row()]]);
    const out = await retrieveManualChunks(client, "tenant-1", "torque spec PowerFlex");
    expect(out).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).not.toContain("replace(");
  });

  it("skips manufacturer filter entirely when none provided", async () => {
    const { client, calls } = makeClient([[row()]]);
    await retrieveManualChunks(client, "tenant-1", "torque");
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).not.toContain("manufacturer ILIKE");
  });
});

const nodeRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  content: "GS10 fault code oC indicates an overcurrent condition on the drive output.",
  source_url: "node-doc/u1/gs10_fault_codes.pdf",
  source_page: 2,
  page_start: 2,
  section_path: null,
  filename: "gs10_fault_codes.pdf",
  rank: 0.4,
  ...overrides,
});

describe("retrieveNodeChunks", () => {
  it("returns empty for empty query without touching DB", async () => {
    const { client, calls } = makeClient([]);
    const out = await retrieveNodeChunks(client, "t-1", "  ", { nodeId: "n-1", unsPath: null });
    expect(out).toEqual([]);
    expect(calls.length).toBe(0);
  });

  it("falls back to an OR tsquery when the precise AND query is empty", async () => {
    // unsPath null → skip the subtree node-id lookup; call[0]=AND, call[1]=OR.
    const { client, calls } = makeClient([[], [nodeRow()]]);
    const out = await retrieveNodeChunks(client, "t-1", "What does GS10 fault code oC mean?", {
      nodeId: "n-1",
      unsPath: null,
    });
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("gs10_fault_codes.pdf");
    expect(calls).toHaveLength(2);
    // First query is the precise AND (plainto), with the BM25 content match.
    expect(calls[0].sql).toContain("plainto_tsquery('english', $2)");
    expect(calls[0].sql).not.toContain("replace(");
    // Fallback rewrites '&' → '|' so a conversational question still grounds.
    expect(calls[1].sql).toContain("replace(plainto_tsquery('english', $2)::text, ' & ', ' | ')");
    // node scoping + route discriminator preserved on both queries.
    expect(calls[1].sql).toContain("ingest_route = 'v2'");
    expect(calls[1].sql).toContain("metadata->>'node_id'");
  });

  it("keeps the precise AND result and does NOT fall back when AND matches", async () => {
    const { client, calls } = makeClient([[nodeRow()]]);
    const out = await retrieveNodeChunks(client, "t-1", "GS10 oC overcurrent", {
      nodeId: "n-1",
      unsPath: null,
    });
    expect(out).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).not.toContain("replace(");
  });

  it("resolves the subtree before retrieving when unsPath is set", async () => {
    // call[0]=subtree ids, call[1]=AND (match) → no OR fallback.
    const { client, calls } = makeClient([[{ id: "n-1" }, { id: "child-1" }], [nodeRow()]]);
    const out = await retrieveNodeChunks(client, "t-1", "oC overcurrent", {
      nodeId: "n-1",
      unsPath: "enterprise.garage.demo_cell.cv_101",
    });
    expect(out).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toContain("uns_path <@ $2::ltree");
    // retrieval is scoped to the resolved subtree ids
    expect(calls[1].params[2]).toEqual(["n-1", "child-1"]);
  });
});

describe("buildGroundedContext", () => {
  it("returns empty string for no chunks", () => {
    expect(buildGroundedContext([])).toBe("");
  });

  it("emits numbered [n] blocks with manufacturer + page", () => {
    const chunks: ManualChunk[] = [
      {
        content: "Torque: 35 ft-lbs.",
        manufacturer: "Allen-Bradley",
        modelNumber: "PowerFlex 525",
        sourceUrl: "u",
        sourcePage: 42,
        title: "t",
        rank: 1,
      },
    ];
    const ctx = buildGroundedContext(chunks);
    expect(ctx).toContain("[1] Allen-Bradley PowerFlex 525, p.42");
    expect(ctx).toContain("Torque: 35 ft-lbs.");
  });
});

describe("appendManualContext", () => {
  it("instructs the model when no chunks matched", () => {
    const out = appendManualContext("BASE", []);
    expect(out).toContain("BASE");
    expect(out).toMatch(/No OEM documentation matched/i);
  });

  it("includes citation rule and context when chunks present", () => {
    const out = appendManualContext("BASE", [
      {
        content: "x",
        manufacturer: "AB",
        modelNumber: "PF525",
        sourceUrl: "u",
        sourcePage: 1,
        title: "t",
        rank: 1,
      },
    ]);
    expect(out).toContain("[n] markers");
    expect(out).toContain("[1] AB PF525, p.1");
  });
});

describe("chunksToSources", () => {
  it("dedupes by (url, page)", () => {
    const c: ManualChunk = {
      content: "a",
      manufacturer: "AB",
      modelNumber: "PF525",
      sourceUrl: "https://x/y.pdf",
      sourcePage: 7,
      title: "",
      rank: 1,
    };
    const sources = chunksToSources([c, { ...c, content: "b" }, { ...c, sourcePage: 8 }]);
    expect(sources).toHaveLength(2);
    expect(sources[0].title).toBe("AB PF525");
    expect(sources[1].page).toBe(8);
  });
});
