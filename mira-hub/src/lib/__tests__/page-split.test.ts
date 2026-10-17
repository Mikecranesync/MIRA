import { afterEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import {
  endsMidPassage,
  evidenceKey,
  fetchPageSplitNeighbors,
  neighborPage,
  pickNextAdjacentChunk,
  type PageSplitNeighborRow,
} from "../page-split";
import {
  retrieveNodeChunks,
  chunksToSources,
  buildGroundedContext,
  type ManualChunk,
} from "../manual-rag";

const TM172 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const LXM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const OTHER_DOC = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";

function neighbor(overrides: Partial<PageSplitNeighborRow> = {}): PageSplitNeighborRow {
  return {
    content: "placeholder",
    doc_id: TM172,
    source_url: "node-doc/u1/tm172.pdf",
    source_page: 93,
    page_start: 93,
    section_path: null,
    filename: "tm172.pdf",
    chunk_index: 0,
    verified: true,
    ...overrides,
  };
}

describe("endsMidPassage", () => {
  it("treats the TQ-20 connector half as truncated", () => {
    expect(
      endsMidPassage(
        "The TM172 controllers and TM172E••R expansion modules have a CAN connector (CAN_H, GND, CAN_L) for a 120 Ω cable",
      ),
    ).toBe(true);
  });

  it("treats the TQ-23 wiring-check half as truncated", () => {
    expect(
      endsMidPassage("Verifying the Wiring. Carry out wiring checks with the devices switched off"),
    ).toBe(true);
  });

  it("does not stitch a finished sentence", () => {
    expect(
      endsMidPassage("GS10 fault code oC indicates an overcurrent condition on the drive output."),
    ).toBe(false);
  });

  it("ignores very short fragments", () => {
    expect(endsMidPassage("CAN bus")).toBe(false);
  });
});

describe("pickNextAdjacentChunk — report cases", () => {
  // TQ-20: retrieved p.93 connector chunk; termination text is the next same-page chunk.
  it("TQ-20: pulls the unread termination half on the same page", () => {
    const head = neighbor({
      content:
        "The TM172 controllers and TM172E••R expansion modules have a CAN connector (CAN_H, GND, CAN_L) for a 120 Ω cable",
      chunk_index: 0,
    });
    const tail = neighbor({
      content: "Terminate the CAN expansion bus with a 120 Ω resistor on the last module",
      chunk_index: 1,
    });
    const next = pickNextAdjacentChunk(
      { docId: TM172, sourcePage: 93, content: head.content },
      [head, tail],
    );
    expect(next?.content).toContain("Terminate the CAN expansion bus");
    expect(neighborPage(next!)).toBe(93);
  });

  // TQ-23: retrieved p.34 wiring-check chunk; ohm thresholds are the next same-page chunk.
  it("TQ-23: pulls the unread ohm-threshold half on the same page", () => {
    const head = neighbor({
      doc_id: LXM,
      source_url: "node-doc/u1/lxm.pdf",
      filename: "lxm.pdf",
      source_page: 34,
      page_start: 34,
      chunk_index: 0,
      content: "Verifying the Wiring. Carry out wiring checks with the devices switched off",
    });
    const tail = neighbor({
      doc_id: LXM,
      source_url: "node-doc/u1/lxm.pdf",
      filename: "lxm.pdf",
      source_page: 34,
      page_start: 34,
      chunk_index: 1,
      content: "R > 65 Ω means a missing terminator. R < 50 Ω (for example 40 Ω) means too many terminators",
    });
    const next = pickNextAdjacentChunk(
      { docId: LXM, sourcePage: 34, content: head.content },
      [head, tail],
    );
    expect(next?.content).toContain("R > 65");
    expect(next?.content).toContain("40 Ω");
    expect(neighborPage(next!)).toBe(34);
  });

  it("pulls the first chunk of the next page at a page-break split", () => {
    const head = neighbor({
      content: "The CAN expansion bus between a TM172 controller and its expansions is terminated",
      page_start: 93,
      source_page: 93,
      chunk_index: 4,
    });
    const tail = neighbor({
      content: "with a 120 Ω resistor at each end of the bus.",
      page_start: 94,
      source_page: 94,
      chunk_index: 5,
    });
    const next = pickNextAdjacentChunk(
      { docId: TM172, sourcePage: 93, content: head.content },
      [head, tail],
    );
    expect(next?.content).toContain("120 Ω resistor");
    expect(neighborPage(next!)).toBe(94);
  });

  it("does not jump two pages ahead", () => {
    const head = neighbor({ chunk_index: 0, content: "The CAN expansion bus is terminated" });
    const skip = neighbor({
      page_start: 95,
      source_page: 95,
      chunk_index: 8,
      content: "unrelated later chapter",
    });
    expect(
      pickNextAdjacentChunk({ docId: TM172, sourcePage: 93, content: head.content }, [head, skip]),
    ).toBeNull();
  });

  it("does not take a neighbor from another document", () => {
    const head = neighbor({ content: "The CAN expansion bus is terminated" });
    const other = neighbor({
      doc_id: OTHER_DOC,
      content: "Terminate with a 120 Ω resistor",
      chunk_index: 1,
    });
    expect(
      pickNextAdjacentChunk({ docId: TM172, sourcePage: 93, content: head.content }, [head, other]),
    ).toBeNull();
  });
});

describe("citation pages after a stitch", () => {
  it("TQ-20 same-page halves share one chip on p.93", () => {
    const chunks: ManualChunk[] = [
      {
        content: "The TM172 controllers have a CAN connector for a 120 Ω cable",
        docId: TM172,
        manufacturer: "",
        modelNumber: "",
        sourceUrl: "node-doc/u1/tm172.pdf",
        sourcePage: 93,
        title: "tm172.pdf",
        rank: 0.4,
      },
      {
        content: "Terminate the CAN expansion bus with a 120 Ω resistor on the last module",
        docId: TM172,
        manufacturer: "",
        modelNumber: "",
        sourceUrl: "node-doc/u1/tm172.pdf",
        sourcePage: 93,
        title: "tm172.pdf",
        rank: 0.4,
      },
    ];
    const sources = chunksToSources(chunks);
    expect(sources).toEqual([
      expect.objectContaining({ index: 1, page: 93, title: "tm172.pdf" }),
    ]);
    const ctx = buildGroundedContext(chunks);
    expect(ctx).toContain("[1] tm172.pdf, p.93");
    expect(ctx).toContain("120 Ω cable");
    expect(ctx).toContain("Terminate the CAN expansion bus");
    expect(ctx).not.toContain("p.94");
  });

  it("page-break stitch keeps both page citations", () => {
    const chunks: ManualChunk[] = [
      {
        content: "The CAN expansion bus between a TM172 controller and its expansions is terminated",
        docId: TM172,
        manufacturer: "",
        modelNumber: "",
        sourceUrl: "node-doc/u1/tm172.pdf",
        sourcePage: 93,
        title: "tm172.pdf",
        rank: 0.4,
      },
      {
        content: "with a 120 Ω resistor at each end of the bus.",
        docId: TM172,
        manufacturer: "",
        modelNumber: "",
        sourceUrl: "node-doc/u1/tm172.pdf",
        sourcePage: 94,
        title: "tm172.pdf",
        rank: 0.4,
      },
    ];
    const sources = chunksToSources(chunks);
    expect(sources.map((s) => s.page)).toEqual([93, 94]);
    expect(sources.map((s) => s.index)).toEqual([1, 2]);
  });
});

describe("retrieveNodeChunks page-split stitch", () => {
  afterEach(() => {
    delete process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL;
  });

  const nodeOpts = {
    nodeId: "n-1",
    unsPath: null as string | null,
    docIds: [TM172],
    validatedDocScope: true,
  };

  function clientFor(head: Record<string, unknown>, neighbors: Record<string, unknown>[]) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const query = vi.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      if (sql.includes("COALESCE(page_start, source_page) = ANY($3::int[])")) {
        return { rows: neighbors };
      }
      return { rows: [head] };
    });
    return { client: { query } as unknown as PoolClient, calls };
  }

  const tq20Head = {
    content:
      "The TM172 controllers and TM172E••R expansion modules have a CAN connector (CAN_H, GND, CAN_L) for a 120 Ω cable",
    doc_id: TM172,
    source_url: "node-doc/u1/tm172.pdf",
    source_page: 93,
    page_start: 93,
    section_path: null,
    filename: "tm172.pdf",
    rank: 0.4,
    verified: true,
  };
  const tq20Tail = {
    ...tq20Head,
    content: "Terminate the CAN expansion bus with a 120 Ω resistor on the last module",
    chunk_index: 1,
    rank: 0,
  };

  it("TQ-20: retrieved connector chunk is joined with the same-page termination chunk", async () => {
    const { client, calls } = clientFor(tq20Head, [tq20Head, tq20Tail]);
    const out = await retrieveNodeChunks(client, "tenant-a", "CAN expansion bus termination", nodeOpts);
    expect(out.map((c) => c.content)).toEqual([tq20Head.content, tq20Tail.content]);
    expect(out.every((c) => c.sourcePage === 93)).toBe(true);
    expect(out.every((c) => c.docId === TM172)).toBe(true);
    const stitch = calls.find((c) => c.sql.includes("COALESCE(page_start, source_page)"));
    expect(stitch, "stitch query was not issued").toBeTruthy();
    expect(stitch!.params[0]).toBe("tenant-a");
    expect(stitch!.params[1]).toEqual([TM172]);
    expect(stitch!.sql).toContain("tenant_id = $1");
    expect(stitch!.sql).toContain("ingest_route = 'v2'");
    expect(stitch!.sql).toContain("doc_id = ANY($2::uuid[])");
    expect(chunksToSources(out)).toEqual([
      expect.objectContaining({ index: 1, page: 93 }),
    ]);
  });

  it("TQ-23: retrieved wiring-check chunk is joined with the ohm-threshold chunk", async () => {
    const head = {
      content: "Verifying the Wiring. Carry out wiring checks with the devices switched off",
      doc_id: LXM,
      source_url: "node-doc/u1/lxm.pdf",
      source_page: 34,
      page_start: 34,
      section_path: null,
      filename: "lxm.pdf",
      rank: 0.3,
      verified: true,
    };
    const tail = {
      ...head,
      content: "R > 65 Ω means a missing terminator. R < 50 Ω (for example 40 Ω) means too many terminators",
      chunk_index: 1,
      rank: 0,
    };
    const { client } = clientFor(head, [head, tail]);
    const out = await retrieveNodeChunks(client, "tenant-a", "CAN expansion bus termination", {
      ...nodeOpts,
      docIds: [LXM],
    });
    expect(out.map((c) => c.content)).toEqual([head.content, tail.content]);
    expect(out.every((c) => c.sourcePage === 34 && c.docId === LXM)).toBe(true);
    expect(buildGroundedContext(out)).toContain("R > 65");
  });

  it("does not query neighbors when the ranked chunk already ends a sentence", async () => {
    const { client, calls } = clientFor(
      {
        content: "GS10 fault code oC indicates an overcurrent condition on the drive output.",
        doc_id: TM172,
        source_url: "node-doc/u1/tm172.pdf",
        source_page: 2,
        page_start: 2,
        filename: "tm172.pdf",
        rank: 0.4,
      },
      [],
    );
    const out = await retrieveNodeChunks(client, "tenant-a", "CAN expansion bus termination", nodeOpts);
    expect(out).toHaveLength(1);
    expect(calls.every((c) => !c.sql.includes("COALESCE(page_start, source_page)"))).toBe(true);
  });

  it("does not stitch a neighbor from another document even if the mock returns one", async () => {
    const { client } = clientFor(tq20Head, [
      tq20Head,
      { ...tq20Tail, doc_id: OTHER_DOC, content: "Terminate the OTHER manual bus" },
    ]);
    const out = await retrieveNodeChunks(client, "tenant-a", "CAN expansion bus termination", nodeOpts);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe(tq20Head.content);
  });

  it("gate on: stitch binds the approved set as $5 and keeps tenant/doc pins", async () => {
    process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL = "true";
    const { client, calls } = clientFor(tq20Head, [tq20Head, tq20Tail]);
    await retrieveNodeChunks(client, "tenant-a", "CAN expansion bus termination", {
      ...nodeOpts,
      approvedSourceDocIds: [TM172],
    });
    const stitch = calls.find((c) => c.sql.includes("COALESCE(page_start, source_page)"));
    expect(stitch, "stitch query was not issued").toBeTruthy();
    expect(stitch!.sql).toContain("is_private = true AND doc_id = ANY($5::uuid[])");
    expect(stitch!.params).toHaveLength(5);
    expect(stitch!.params[0]).toBe("tenant-a");
    expect(stitch!.params[1]).toEqual([TM172]);
    expect(stitch!.params[4]).toEqual([TM172]);
  });

  it("does not duplicate a continuation already in the ranked window", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const query = vi.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      if (sql.includes("COALESCE(page_start, source_page)")) {
        return { rows: [tq20Head, tq20Tail] };
      }
      return { rows: [tq20Head, tq20Tail] };
    });
    const out = await retrieveNodeChunks(
      { query } as unknown as PoolClient,
      "tenant-a",
      "CAN expansion bus termination",
      { ...nodeOpts, topK: 6 },
    );
    const terminations = out.filter((c) => c.content.includes("Terminate the CAN"));
    expect(terminations).toHaveLength(1);
  });
});

describe("fetchPageSplitNeighbors scope", () => {
  it("binds tenant, docs, pages, and nodes and never omits tenant_id", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        return { rows: [] };
      }),
    } as unknown as PoolClient;
    await fetchPageSplitNeighbors(client, {
      tenantId: "tenant-a",
      docIds: [TM172],
      pages: [93, 94],
      nodeIds: ["n-1"],
      docScopeOnly: true,
      admitApproved: false,
      approvedSourceDocIds: [],
      approvalClause: "",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual(["tenant-a", [TM172], [93, 94], ["n-1"]]);
    expect(calls[0].sql).toContain("WHERE tenant_id = $1");
    expect(calls[0].sql).toContain("doc_id = ANY($2::uuid[])");
    expect(calls[0].sql).not.toContain("is_private = false");
  });
});

describe("evidenceKey", () => {
  it("distinguishes same-page halves", () => {
    expect(evidenceKey(TM172, 93, "connector half")).not.toBe(evidenceKey(TM172, 93, "termination half"));
    const header = "X".repeat(80);
    expect(evidenceKey(TM172, 93, `${header} first row`)).not.toBe(evidenceKey(TM172, 93, `${header} second row`));
  });
});
