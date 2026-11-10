import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { retrieveNodeChunks } from "@/lib/manual-rag";

// Lives here, not in src/lib/__tests__/manual-rag.test.ts: that file is in the
// frozen older tree and takes no new tests. Same stand-ins as that file.

/** Bookkeeping reads (code selectivity, question-IDF, rare-term recall, savepoints) are not passage lanes. */
const isBookkeeping = (sql: string) =>
  sql.includes("WITH ORDINALITY") || sql.includes("names_document") || sql.includes("quote_literal(lex)") || /^\s*(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)\b/.test(sql);

/** Records every statement and returns nothing: for asserting how the lanes were asked. */
function makeClient(): { client: PoolClient; calls: Array<{ sql: string; params: unknown[] }> } {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[]) => {
    calls.push({ sql, params });
    return { rows: [] };
  });
  return { client: { query } as unknown as PoolClient, calls };
}
const lanes = (calls: Array<{ sql: string; params: unknown[] }>) =>
  calls.filter((c) => !isBookkeeping(c.sql) && !c.sql.includes("document-eligibility"));

const nodeRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  content: "Communication settings are configured in the controller properties.",
  source_url: "node-doc/u1/manual.pdf",
  source_page: 2,
  page_start: 2,
  section_path: null,
  filename: "manual.pdf",
  rank: 0.4,
  ...overrides,
});

// Codex round 1 on #5389 (F2). The two checks added for #5369 also refuse
// rows AFTER the SQL LIMIT: the unlisted-number check (a question or a
// carried number the detector has no pattern for) and the project check (a
// confirmed machine against a cover that declares another product). With one
// shared window a large refused manual fills LIMIT and the applicable manual
// is never fetched, so a supported question abstains.
describe("each attached manual has its own candidate window wherever a check can refuse after LIMIT", () => {
  const DOCS = ["d-1", "d-2"];
  /** A database stand-in that honours document scope and LIMIT, best rank first. */
  const limitedClient = (table: Record<string, unknown>[]) => {
    const query = vi.fn(async (sql: string, params: unknown[]) => {
      if (isBookkeeping(sql)) return { rows: [] };
      const scope = params.find((p): p is string[] => Array.isArray(p) && p.length > 0 && p.every((d) => DOCS.includes(String(d))));
      const limit = params.find((p): p is number => typeof p === "number");
      expect(scope, "every lane must be scoped to the selected documents").toBeDefined();
      // The cover-only read has no LIMIT: one row per selected document.
      if (sql.includes("document-eligibility"))
        return { rows: scope!.flatMap((d) => table.filter((r) => r.doc_id === d).slice(0, 1)) };
      expect(limit, "every passage lane must carry a LIMIT").toBeGreaterThan(0);
      const rows = table
        .filter((r) => scope!.includes(String(r.doc_id)))
        .sort((a, b) => Number(b.rank) - Number(a.rank))
        .slice(0, limit);
      return { rows };
    });
    return { query } as unknown as PoolClient;
  };
  /** More passages than any candidate window holds, all from the manual that must be refused, all ranked above the right one. */
  const crowd = (heading: string, filename: string) =>
    Array.from({ length: 40 }, (_, i) =>
      nodeRow({ doc_id: "d-1", filename, document_heading: heading, source_page: i + 1, page_start: i + 1, rank: 0.9 - i * 0.001, content: `Communication settings, part ${i + 1}, are configured in the controller properties.` }),
    );
  const answer = (heading: string, filename: string) =>
    nodeRow({ doc_id: "d-2", filename, document_heading: heading, source_page: 7, page_start: 7, rank: 0.2, content: "Communication settings are configured in the controller properties." });
  const base = { nodeId: "n-1", unsPath: null, docIds: DOCS, validatedDocScope: true } as const;

  it("a question that names a number the detector has no pattern for: the sibling's 40 passages do not hide the right manual", async () => {
    const rows = await retrieveNodeChunks(
      limitedClient([...crowd("RX410 Logic Controller User Manual", "rx410-um.pdf"), answer("RX420 Logic Controller User Manual", "rx420-um.pdf")]),
      "t-1", "RX420 communication settings", base,
    );
    expect(JSON.stringify(rows)).toContain("rx420-um.pdf");
    expect(JSON.stringify(rows), "the refused sibling is never returned").not.toContain("rx410-um.pdf");
  });

  it("a project recorded by a number the detector cannot read: another product's 40 passages do not hide the part's own sheet", async () => {
    const rows = await retrieveNodeChunks(
      limitedClient([
        ...crowd("Micro820 Programmable Controllers User Manual", "2080-um005.pdf"),
        answer("TeSys CA3KN22BD Control Relay Data Sheet", "ca3kn22bd.pdf"),
      ]),
      "t-1", "communication settings",
      { ...base, identity: { manufacturer: "Schneider Electric", model: "CA3KN22BD" }, identityStatus: "user_confirmed" },
    );
    expect(JSON.stringify(rows)).toContain("ca3kn22bd.pdf");
    expect(JSON.stringify(rows)).not.toContain("2080-um005.pdf");
  });

  it("the first lane asks for each document separately in both cases", async () => {
    const unlisted = makeClient();
    await retrieveNodeChunks(unlisted.client, "t-1", "RX420 communication settings", base);
    expect(lanes(unlisted.calls).slice(0, 2).map((c) => c.params[4])).toEqual([["d-1"], ["d-2"]]);

    const project = makeClient();
    await retrieveNodeChunks(project.client, "t-1", "communication settings", {
      ...base, identity: { manufacturer: "Schneider Electric", model: "CA3KN22BD" }, identityStatus: "user_confirmed",
    });
    expect(lanes(project.calls).slice(0, 2).map((c) => c.params[4])).toEqual([["d-1"], ["d-2"]]);
  });

  it("and when the number comes from an earlier question, or the question names the project's own number", async () => {
    const carried = makeClient();
    await retrieveNodeChunks(carried.client, "t-1", "communication settings", { ...base, subjectQueries: ["RX420 will not start"] });
    expect(lanes(carried.calls).slice(0, 2).map((c) => c.params[4])).toEqual([["d-1"], ["d-2"]]);

    const own = makeClient();
    await retrieveNodeChunks(own.client, "t-1", "CA3KN22BD communication settings", {
      ...base, identity: { manufacturer: "Schneider Electric", model: "CA3KN22BD" }, identityStatus: "user_confirmed",
    });
    expect(lanes(own.calls).slice(0, 2).map((c) => c.params[4])).toEqual([["d-1"], ["d-2"]]);
  });

  it("control: a question with no model, no number and no confirmed machine keeps one shared window", async () => {
    const { client, calls } = makeClient();
    await retrieveNodeChunks(client, "t-1", "communication settings", base);
    expect(lanes(calls)[0].params[4]).toEqual(DOCS);
  });

  it("control: an unconfirmed machine number does not split the windows", async () => {
    const { client, calls } = makeClient();
    await retrieveNodeChunks(client, "t-1", "communication settings", {
      ...base, identity: { manufacturer: "Schneider Electric", model: "CA3KN22BD" }, identityStatus: "candidate",
    });
    expect(lanes(calls)[0].params[4]).toEqual(DOCS);
  });
});
