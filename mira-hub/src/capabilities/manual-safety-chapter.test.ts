import { afterEach, describe, expect, it } from "vitest";
import pages from "./manual-safety-statement.real-pages.json";
import {
  printedPageOffset,
  retrieveSafetyChapterChunks,
  safetyChapterPage,
  SAFETY_CHAPTER_DIRECTIVE,
  SAFETY_CHAPTER_MAX_CHUNKS,
} from "./manual-safety-chapter";
import type { PoolClient } from "pg";
import type { ManualChunk } from "@/lib/manual-rag";

// Real ACS355 page text from the frozen manual (#4509's 50-page corpus).
const text = (id: string) => (pages as Array<{ id: string; text: string }>).find((p) => p.id === id)!.text;
const P372 = text("acs355-q3"); // "WARNING! Read and follow the instructions in chapter Safety on page\n17."
const P355 = text("acs355-q4"); // alarm table, no safety reference
const P18 = text("acs355-q2"); // Safety chapter: wait 5 minutes, multimeter, external control circuits

const DOC = "5e5036b4-68bc-492c-9f57-a9288056b37d";
const URL = "hub://acs355.pdf";
const chunk = (content: string, page: number, docId: string | null = DOC): ManualChunk => ({
  content, docId, sourceUrl: URL, sourcePage: page, manufacturer: "ABB", modelNumber: "ACS355", title: "acs355.pdf", rank: 1,
});

type Row = { id: string; doc_id: string; content: string; source_url: string; page: number; page_label?: string };

/**
 * A knowledge_entries stand-in that answers the two reads the module makes, and records them.
 * Like Postgres, it rejects a bind count that does not match the highest placeholder.
 */
function fakeClient(rows: Row[]) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      const needed = Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
      if (needed !== params.length) {
        throw new Error(`bind message supplies ${params.length} parameters, but prepared statement requires ${needed}`);
      }
      calls.push({ sql, params });
      if (sql.startsWith("SET LOCAL")) return { rows: [] };
      if (sql.includes("DISTINCT ON (doc_id)")) {
        const docs = params[1] as string[];
        const re = new RegExp(String(params[2]), "i");
        const hits = rows.filter((r) => docs.includes(r.doc_id) && re.test(r.content));
        return { rows: hits.slice(0, 1).map((r) => ({ doc_id: r.doc_id, content: r.content, page: r.page, page_label: r.page_label ?? null })) };
      }
      const [, docs, urls, pageNos, pattern] = params as [string, string[], string[], number[], string];
      const re = new RegExp(pattern, "i");
      const out = rows.filter((r) =>
        docs.some((d, i) => d === r.doc_id && urls[i] === r.source_url && pageNos[i] === r.page) && re.test(r.content),
      );
      return { rows: out };
    },
  };
  return Object.assign(client as unknown as PoolClient, { calls });
}

const row = (id: string, content: string, page: number): Row => ({ id, doc_id: DOC, content, source_url: URL, page });
const CORPUS = [
  row("00000000-0000-0000-0000-000000000017", "Safety\nWhat this chapter contains\nUse of warnings", 17),
  row("00000000-0000-0000-0000-000000000018", P18, 18),
  row("00000000-0000-0000-0000-000000000355", P355, 355),
  row("00000000-0000-0000-0000-000000000372", P372, 372),
];

const GATE = "MIRA_ENFORCE_APPROVED_RETRIEVAL";
const gateBefore = process.env[GATE];
afterEach(() => {
  if (gateBefore === undefined) delete process.env[GATE];
  else process.env[GATE] = gateBefore;
});

describe("safetyChapterPage", () => {
  it("reads the manual's own reference, across the line break the PDF puts in it", () => {
    expect(safetyChapterPage(P372)).toBe(17);
    expect(safetyChapterPage('see chapter "Safety" on page 9')).toBe(9);
  });
  it("is null for a page with no reference", () => {
    expect(safetyChapterPage(P355)).toBeNull();
    expect(safetyChapterPage("Safety on page 17")).toBeNull();
  });
});

describe("retrieveSafetyChapterChunks", () => {
  it("acs355-q3: the retrieved fan page's reference adds the p.18 warning, after the retrieved chunks", async () => {
    const client = fakeClient(CORPUS);
    const added = await retrieveSafetyChapterChunks(client, "tenant", [chunk(P372, 372)], { approvedSourceDocIds: [DOC] });
    expect(added.map((c) => c.sourcePage)).toEqual([18]);
    expect(added[0].content).toBe(P18);
    expect(added[0]).toMatchObject({ docId: DOC, sourceUrl: URL, pageLabel: "18", title: "acs355.pdf" });
    expect(added[0].content).toMatch(/wait for 5 minutes/);
    expect(added[0].content).toMatch(/multimeter/);
    // The reference came from the retrieved chunk, so no document-level lookup ran.
    expect(client.calls.some((c) => c.sql.includes("DISTINCT ON"))).toBe(false);
    // Pages 17..20 of that one document were read.
    const read = client.calls.find((c) => c.sql.includes("unnest"))!;
    expect(read.params[3]).toEqual([17, 18, 19, 20]);
  });

  it("acs355-q4: a cited page without a reference still reaches the chapter through the document", async () => {
    const client = fakeClient(CORPUS);
    const added = await retrieveSafetyChapterChunks(client, "tenant", [chunk(P355, 355)], { approvedSourceDocIds: [DOC] });
    expect(added.map((c) => c.sourcePage)).toEqual([18]);
    expect(added[0].content).toMatch(/external control circuits/i);
    const lookup = client.calls.find((c) => c.sql.includes("DISTINCT ON"))!;
    expect(lookup.params[1]).toEqual([DOC]);
  });

  it("approval gate OFF: the document lookup binds exactly its three values (acs355-q4 path)", async () => {
    delete process.env[GATE];
    const client = fakeClient(CORPUS);
    const added = await retrieveSafetyChapterChunks(client, "tenant", [chunk(P355, 355)], { approvedSourceDocIds: [DOC] });
    expect(added.map((c) => c.sourcePage)).toEqual([18]);
    const lookup = client.calls.find((c) => c.sql.includes("DISTINCT ON"))!;
    expect(lookup.params).toHaveLength(3);
    expect(lookup.sql).not.toContain("verified");
  });

  it("approval gate ON: the lookup carries the approved-source predicate and its fourth value", async () => {
    process.env[GATE] = "true";
    const client = fakeClient(CORPUS);
    const added = await retrieveSafetyChapterChunks(client, "tenant", [chunk(P355, 355)], { approvedSourceDocIds: [DOC] });
    expect(added.map((c) => c.sourcePage)).toEqual([18]);
    const lookup = client.calls.find((c) => c.sql.includes("DISTINCT ON"))!;
    expect(lookup.params).toEqual(["tenant", [DOC], expect.any(String), [DOC]]);
    expect(lookup.sql).toContain("doc_id = ANY($4::uuid[])");
  });

  it("approval gate ON with no admission set: the global verified-only rule, three values", async () => {
    process.env[GATE] = "true";
    const client = fakeClient(CORPUS);
    await retrieveSafetyChapterChunks(client, "tenant", [chunk(P355, 355)]);
    const lookup = client.calls.find((c) => c.sql.includes("DISTINCT ON"))!;
    expect(lookup.params).toHaveLength(3);
    expect(lookup.sql).toContain("verified = true");
  });

  it("printed page offset: a manual with front matter reads the chapter at its PDF page", async () => {
    // Printed page 13 sits on PDF page 17, so "chapter Safety on page 17" is PDF page 21.
    const client = fakeClient([...CORPUS, row("00000000-0000-0000-0000-000000000021", P18, 21)]);
    const referring = { ...chunk("WARNING! Read and follow the instructions in chapter Safety on page 17.", 17), pageLabel: "13" };
    const added = await retrieveSafetyChapterChunks(client, "tenant", [referring]);
    const read = client.calls.find((c) => c.sql.includes("unnest"))!;
    expect(read.params[3]).toEqual([21, 22, 23, 24]);
    expect(added.map((c) => c.sourcePage)).toEqual([21]);
  });

  it("printed page offset on the document-level lookup comes from the referring row's own label", async () => {
    const referring: Row = { ...row("00000000-0000-0000-0000-000000000376", P372, 376), page_label: "372" };
    const client = fakeClient([referring, row("00000000-0000-0000-0000-000000000022", P18, 22)]);
    const added = await retrieveSafetyChapterChunks(client, "tenant", [chunk(P355, 355)]);
    const read = client.calls.find((c) => c.sql.includes("unnest"))!;
    expect(read.params[3]).toEqual([21, 22, 23, 24]);
    expect(added.map((c) => c.sourcePage)).toEqual([22]);
  });

  it("printedPageOffset: only a plain-number label shifts the page", () => {
    expect(printedPageOffset(17, "13")).toBe(4);
    expect(printedPageOffset(17, "17")).toBe(0);
    expect(printedPageOffset(17, null)).toBe(0);
    expect(printedPageOffset(17, "6-12")).toBe(0);
    expect(printedPageOffset(17, "xiv")).toBe(0);
    expect(printedPageOffset(null, "13")).toBe(0);
  });

  it("control: a document that never refers to a Safety chapter adds nothing", async () => {
    const client = fakeClient([row("00000000-0000-0000-0000-000000000355", P355, 355)]);
    expect(await retrieveSafetyChapterChunks(client, "tenant", [chunk(P355, 355)])).toEqual([]);
    expect(client.calls.some((c) => c.sql.includes("unnest"))).toBe(false);
  });

  it("does not repeat a chapter chunk retrieval already returned (acs355-q2)", async () => {
    const client = fakeClient(CORPUS);
    expect(await retrieveSafetyChapterChunks(client, "tenant", [chunk(P372, 372), chunk(P18, 18)])).toEqual([]);
  });

  it("OEM chunks carry no document id, so nothing is read", async () => {
    const client = fakeClient(CORPUS);
    expect(await retrieveSafetyChapterChunks(client, "tenant", [chunk(P372, 372, null)])).toEqual([]);
    expect(client.calls).toEqual([]);
  });

  it("caps the chunks it adds", async () => {
    const many = Array.from({ length: 9 }, (_, i) => row(`00000000-0000-0000-0000-0000000001${i}0`, `${P18}\n(${i})`, 18 + (i % 3)));
    const added = await retrieveSafetyChapterChunks(fakeClient([...many, CORPUS[3]]), "tenant", [chunk(P372, 372)]);
    expect(added).toHaveLength(SAFETY_CHAPTER_MAX_CHUNKS);
    const pageNos = added.map((c) => c.sourcePage ?? -1);
    expect(pageNos).toEqual([...pageNos].sort((a, b) => a - b));
  });

  it("two manuals: a low-numbered chapter in one cannot crowd out the other's warning", async () => {
    const A = "aaaaaaaa-0000-0000-0000-000000000001";
    const A_URL = "hub://other-drive.pdf";
    const aRow = (p: number): Row => ({ id: `a-${p}`, doc_id: A, content: `${P18}\n(other drive p${p})`, source_url: A_URL, page: p });
    const client = fakeClient([...CORPUS, aRow(1), aRow(2), aRow(3), aRow(4)]);
    const aTask = { ...chunk("WARNING! Read and follow the instructions in chapter Safety on page 1.", 40, A), sourceUrl: A_URL, title: "other-drive.pdf" };
    const added = await retrieveSafetyChapterChunks(client, "tenant", [aTask, chunk(P372, 372)]);
    expect(added).toHaveLength(SAFETY_CHAPTER_MAX_CHUNKS);
    const acs = added.filter((c) => c.docId === DOC);
    expect(acs.map((c) => c.sourcePage)).toEqual([18]);
    expect(acs[0]).toMatchObject({ sourceUrl: URL, title: "acs355.pdf" });
    // Every chunk keeps its own document's identity.
    for (const c of added.filter((x) => x.docId === A)) expect(c).toMatchObject({ sourceUrl: A_URL, title: "other-drive.pdf" });
  });

  it("five manuals: the last-retrieved manual's chapter still gets a warning (Codex r2 F2)", async () => {
    const docs = [1, 2, 3, 4].map((n) => ({ id: `aaaaaaaa-0000-0000-0000-00000000000${n}`, url: `hub://drive-${n}.pdf` }));
    const extra: Row[] = docs.flatMap((d) =>
      [1, 2].map((p) => ({ id: `${d.id}-${p}`, doc_id: d.id, content: `${P18}\n(${d.url} p${p})`, source_url: d.url, page: p })),
    );
    const retrieved = [
      ...docs.map((d) => ({ ...chunk("WARNING! Read and follow the instructions in chapter Safety on page 1.", 40, d.id), sourceUrl: d.url })),
      chunk(P372, 372), // the ACS355 task page, fifth in relevance order
    ];
    const added = await retrieveSafetyChapterChunks(fakeClient([...CORPUS, ...extra]), "tenant", retrieved);
    expect(added).toHaveLength(5); // one per manual: the cap grows to cover every manual with a chapter
    expect(added.map((c) => c.docId)).toEqual([...docs.map((d) => d.id), DOC]);
    expect(added[4]).toMatchObject({ sourceUrl: URL, sourcePage: 18, content: P18 });
  });

  it("the directive asks for the steps only on physical work", () => {
    expect(SAFETY_CHAPTER_DIRECTIVE).toMatch(/physically work/);
    expect(SAFETY_CHAPTER_DIRECTIVE).toMatch(/no physical work/);
  });
});
