import { afterEach, describe, expect, it } from "vitest";
import pages from "./manual-safety-statement.real-pages.json";
import {
  printedPageOffset,
  retrieveSafetyChapterChunks,
  safetyChapterPage,
  SAFETY_CHAPTER_BUDGET_CHARS,
  SAFETY_CHAPTER_DIRECTIVE,
  SAFETY_CHAPTER_ROWS_PER_PAGE,
  SAFETY_MARKER_LINE,
  SAFETY_CHAPTER_REF_SQL,
} from "./manual-safety-chapter";
import { extractManualSafetyStatement } from "./manual-safety-statement";
import type { PoolClient } from "pg";
import { buildManualUserContent, type ManualChunk } from "@/lib/manual-rag";
import { chunkText } from "@/lib/node-knowledge-ingest";

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

type Row = { id: string; doc_id: string; content: string; source_url: string; page: number; page_label?: string; chunk_index?: number };

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
      if (!sql.includes("ROW_NUMBER")) {
        // #4509's notice reader (the pre-r5 chapter path): id order, keyset cursor, LIMIT per batch —
        // modelled so a test can show its first-hit-per-page exit.
        const [, docs, urls, pageNos, candidate] = params as [string, string[], string[], number[], string];
        const cand = new RegExp(candidate, "i");
        const limit = Number(/LIMIT (\d+)/.exec(sql)?.[1] ?? Infinity);
        const cursorParam = /AND id > \$(\d+)::uuid/.exec(sql)?.[1];
        const after = cursorParam ? String(params[Number(cursorParam) - 1]) : null;
        const out = rows
          .filter((r) => docs.some((d, i) => d === r.doc_id && urls[i] === r.source_url && pageNos[i] === r.page) && cand.test(r.content))
          .filter((r) => after === null || r.id > after)
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .slice(0, limit);
        return { rows: out.map((r) => ({ id: r.id, content: r.content, source_url: r.source_url, page: r.page })) };
      }
      // The chapter read: per (file, page), no keyword filter; rank marker line first, then prerequisite
      // kinds named, then isolation words, then chunk index (absent last), then id; keep rank <= the
      // per-page cap; return in (file, page, chunk index, id) order — the same semantics as the SQL.
      const [, docs, urls, pageNos, marker, kinds, isolation, perPage] = params as [
        string, string[], string[], number[], string, string[], string, number,
      ];
      const mark = new RegExp(marker);
      const kindRes = kinds.map((k) => new RegExp(k, "i"));
      const iso = new RegExp(isolation, "i");
      const hits = rows.filter((r) => docs.some((d, i) => d === r.doc_id && urls[i] === r.source_url && pageNos[i] === r.page));
      const idx = (r: Row) => r.chunk_index ?? Number.MAX_SAFE_INTEGER;
      const groups = new Map<string, Row[]>();
      for (const r of hits) groups.set(`${r.source_url}|${r.page}`, [...(groups.get(`${r.source_url}|${r.page}`) ?? []), r]);
      const score = (r: Row) => [
        mark.test(r.content) ? 0 : 1,
        -kindRes.filter((re) => re.test(r.content)).length,
        iso.test(r.content) ? 0 : 1,
      ] as const;
      const kept = [...groups.values()].flatMap((g) =>
        g
          .sort((a, b) => score(a)[0] - score(b)[0] || score(a)[1] - score(b)[1] || score(a)[2] - score(b)[2] || idx(a) - idx(b) || (a.id < b.id ? -1 : 1))
          .slice(0, perPage),
      );
      kept.sort((a, b) => (a.source_url < b.source_url ? -1 : a.source_url > b.source_url ? 1 : a.page - b.page || idx(a) - idx(b) || (a.id < b.id ? -1 : 1)));
      return { rows: kept.map((r) => ({ id: r.id, content: r.content, source_url: r.source_url, page: r.page, chunk_index: r.chunk_index ?? null })) };
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
    // PDF page for rereads; the manual's printed page as the label (Codex r4 F8).
    expect(added.map((c) => [c.sourcePage, c.pageLabel])).toEqual([[21, "17"]]);
  });

  it("printed page offset on the document-level lookup comes from the referring row's own label", async () => {
    const referring: Row = { ...row("00000000-0000-0000-0000-000000000376", P372, 376), page_label: "372" };
    const client = fakeClient([referring, row("00000000-0000-0000-0000-000000000022", P18, 22)]);
    const added = await retrieveSafetyChapterChunks(client, "tenant", [chunk(P355, 355)]);
    const read = client.calls.find((c) => c.sql.includes("unnest"))!;
    expect(read.params[3]).toEqual([21, 22, 23, 24]);
    expect(added.map((c) => [c.sourcePage, c.pageLabel])).toEqual([[22, "18"]]);
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

  it("fills each manual's character budget and emits in page order", async () => {
    const many = Array.from({ length: 9 }, (_, i) => row(`00000000-0000-0000-0000-0000000001${i}0`, `${P18}\n(${i})`, 18 + (i % 3)));
    const added = await retrieveSafetyChapterChunks(fakeClient([...many, CORPUS[3]]), "tenant", [chunk(P372, 372)]);
    const used = added.reduce((n, c) => n + Math.min(c.content.length, 1200), 0);
    expect(used).toBeLessThanOrEqual(SAFETY_CHAPTER_BUDGET_CHARS);
    expect(used + Math.min(many[0].content.length, 1200)).toBeGreaterThan(SAFETY_CHAPTER_BUDGET_CHARS); // full: one more would not fit
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
    // Each manual has its own budget: A keeps its 4 pages and the ACS355 still keeps page 18.
    expect(added.map((c) => `${c.docId === DOC ? "acs" : "a"}:${c.sourcePage}`)).toEqual(["a:1", "a:2", "a:3", "a:4", "acs:18"]);
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
    // Each manual keeps its own chapter (2 pages each here); the fifth still keeps page 18.
    expect(added.map((c) => c.docId)).toEqual([...docs.flatMap((d) => [d.id, d.id]), DOC]);
    expect(added[8]).toMatchObject({ sourceUrl: URL, sourcePage: 18, content: P18 });
  });

  it("three manuals: the applicable manual's second chapter chunk is not given to earlier manuals (Codex r3 F4)", async () => {
    const mk = (n: number) => ({ id: `aaaaaaaa-0000-0000-0000-00000000000${n}`, url: `hub://drive-${n}.pdf` });
    const [A, B, C] = [mk(1), mk(2), mk(3)];
    const warn = (d: { id: string; url: string }, p: number, body: string): Row => ({ id: `${d.id}-${p}`, doc_id: d.id, content: body, source_url: d.url, page: p });
    const STEPS = "WARNING! Wait for 5 minutes after disconnecting the input power. Measure with a multimeter that there is no voltage.";
    const rows = [
      warn(A, 1, "WARNING! Drive A: only qualified electricians may install this drive."),
      warn(A, 2, "WARNING! Drive A: do not work on the drive while it is powered."),
      warn(B, 1, "WARNING! Drive B: only qualified electricians may install this drive."),
      warn(B, 2, "WARNING! Drive B: do not work on the drive while it is powered."),
      warn(C, 1, "WARNING! Drive C: only qualified electricians may install this drive."),
      warn(C, 2, STEPS), // the required procedure lives only in C's second chunk
    ];
    const ref = "WARNING! Read and follow the instructions in chapter Safety on page 1.";
    const retrieved = [A, B, C].map((d) => ({ ...chunk(ref, 40, d.id), sourceUrl: d.url }));
    const added = await retrieveSafetyChapterChunks(fakeClient(rows), "tenant", retrieved);
    const c2 = added.find((c) => c.content === STEPS);
    expect(c2).toMatchObject({ docId: C.id, sourceUrl: C.url, sourcePage: 2 });
    expect(added.filter((c) => c.docId === C.id)).toHaveLength(2);
  });

  it("four generic warnings on the chapter's first page cannot push out the procedure on the next (Codex r4 F7)", async () => {
    const STEPS = "WARNING! Wait for 5 minutes after disconnecting the input power. Measure with a multimeter that there is no voltage.";
    const generic = [1, 2, 3, 4].map((i) =>
      row(`00000000-0000-0000-0000-00000000017${i}`, `WARNING! Generic warning ${i}: only qualified electricians may install this drive.`, 17),
    );
    const rows = [...generic, row("00000000-0000-0000-0000-000000000180", STEPS, 18), CORPUS[3]];
    const added = await retrieveSafetyChapterChunks(fakeClient(rows), "tenant", [chunk(P372, 372)]);
    expect(added.map((c) => c.sourcePage)).toEqual([17, 17, 17, 17, 18]);
    expect(added[4]).toMatchObject({ docId: DOC, sourceUrl: URL, sourcePage: 18, content: STEPS });
  });

  it("a page with more than 200 early generic warnings still yields its later procedure (Codex r5 F11)", async () => {
    const STEPS = "WARNING! Wait for 5 minutes after disconnecting the input power. Measure with a multimeter that there is no voltage.";
    const generic = Array.from({ length: 250 }, (_, i) =>
      row(`00000000-0000-0000-0000-${String(1000 + i).padStart(12, "0")}`, `WARNING! Generic notice ${i}: only qualified electricians may install this drive.`, 17 + (i % 4)),
    );
    const late = row("ffffffff-0000-0000-0000-000000000001", STEPS, 18); // highest id: last in any id-ordered scan
    const added = await retrieveSafetyChapterChunks(fakeClient([...generic, late, CORPUS[3]]), "tenant", [chunk(P372, 372)]);
    expect(added.find((c) => c.content === STEPS)).toMatchObject({ docId: DOC, sourceUrl: URL, sourcePage: 18 });
  });

  it("a dense upload stays inside the budget and keeps the procedure (Codex r5 F12)", async () => {
    const STEPS = "WARNING! Wait for 5 minutes after disconnecting the input power. Measure with a multimeter that there is no voltage.";
    const dense = Array.from({ length: 3000 }, (_, i) =>
      row(`00000000-0000-0000-0000-${String(5000 + i).padStart(12, "0")}`, `WARNING! Dense notice ${i}: ${"read the manual. ".repeat(70)}`, 17 + (i % 3)),
    );
    const client = fakeClient([...dense, row("ffffffff-0000-0000-0000-000000000002", STEPS, 20), CORPUS[3]]);
    const added = await retrieveSafetyChapterChunks(client, "tenant", [chunk(P372, 372)]);
    const used = added.reduce((n, c) => n + Math.min(c.content.length, 1200), 0);
    expect(used).toBeLessThanOrEqual(SAFETY_CHAPTER_BUDGET_CHARS);
    expect(added.some((c) => c.content === STEPS)).toBe(true);
    // The read itself is bounded per page; one query, no batches.
    const reads = client.calls.filter((c) => c.sql.includes("ROW_NUMBER"));
    expect(reads).toHaveLength(1);
    expect(reads[0].params[7]).toBe(SAFETY_CHAPTER_ROWS_PER_PAGE);
    // The fake applies the cap from the bound value; the SQL must actually filter on it.
    expect(reads[0].sql).toMatch(/WHERE rn <= \$8\s+ORDER BY/);
    // No keyword filter on the page read, and pages come back in chunk order (#5059 Codex r1 F1).
    expect(reads[0].sql).not.toMatch(/AND content ~\*/);
    expect(reads[0].sql).toMatch(/ORDER BY source_url, page, chunk_index NULLS LAST, id`?\s*$/);
  });

  it("an isolation warning outranks generic boilerplate for the budget", async () => {
    const generic = Array.from({ length: 30 }, (_, i) =>
      row(`00000000-0000-0000-0000-${String(14000 + i).padStart(12, "0")}`, `WARNING! Only qualified people may service unit ${i}. `.padEnd(300, "Read the manual. "), 17),
    );
    expect(generic.every((r) => !/wait|minute|discharg|measur|multimeter|voltage|isolat|disconnect|lock.?out|de-?energi/i.test(r.content))).toBe(true);
    const iso = row("ffffffff-0000-0000-0000-000000000006", "WARNING! Disconnect and lock out the supply before servicing.", 18);
    const added = await retrieveSafetyChapterChunks(fakeClient([...generic, iso, CORPUS[3]]), "tenant", [chunk(P372, 372)]);
    expect(added.find((c) => c.content === iso.content)).toMatchObject({ sourcePage: 18 });
  });

  it("40 earlier disconnect warnings on the same page cannot take the read slots of the wait and voltage check (Codex r6 F13)", async () => {
    const STEPS = "WARNING! Wait for 5 minutes after disconnecting the input power. Measure with a multimeter that there is no voltage.";
    const isolation = Array.from({ length: 40 }, (_, i) =>
      row(`00000000-0000-0000-0000-${String(12000 + i).padStart(12, "0")}`, `WARNING! Disconnect the supply before task ${i}.`, 18),
    );
    const late = row("ffffffff-0000-0000-0000-000000000004", STEPS, 18); // ties every earlier row on marker and isolation words
    const client = fakeClient([...isolation, late, CORPUS[3]]);
    const added = await retrieveSafetyChapterChunks(client, "tenant", [chunk(P372, 372)]);
    expect(added.find((c) => c.content === STEPS)).toMatchObject({ docId: DOC, sourceUrl: URL, sourcePage: 18 });
  });

  it("disconnect warnings on an earlier page cannot spend the budget ahead of the wait and voltage check (Codex r6 F13)", async () => {
    const STEPS = "WARNING! Wait for 5 minutes after disconnecting the input power. Measure with a multimeter that there is no voltage.";
    const isolation = Array.from({ length: 30 }, (_, i) =>
      // 300 characters each: 20 of them fill the budget exactly, leaving no room after them.
      row(`00000000-0000-0000-0000-${String(13000 + i).padStart(12, "0")}`, `WARNING! Disconnect the supply before task ${i}. `.padEnd(300, "Follow the site rules. "), 17),
    );
    expect(SAFETY_CHAPTER_BUDGET_CHARS % 300).toBe(0);
    expect(isolation.reduce((n, r) => n + r.content.length, 0)).toBeGreaterThan(SAFETY_CHAPTER_BUDGET_CHARS);
    const added = await retrieveSafetyChapterChunks(fakeClient([...isolation, row("ffffffff-0000-0000-0000-000000000005", STEPS, 18), CORPUS[3]]), "tenant", [chunk(P372, 372)]);
    expect(added.find((c) => c.content === STEPS)).toMatchObject({ sourcePage: 18 });
    expect(added.reduce((n, c) => n + Math.min(c.content.length, 1200), 0)).toBeLessThanOrEqual(SAFETY_CHAPTER_BUDGET_CHARS);
  });

  it("the per-page rank puts a real WARNING ahead of chunks that merely say wait (#4509 r4 trap)", async () => {
    const waitOnly = Array.from({ length: 120 }, (_, i) =>
      row(`00000000-0000-0000-0000-${String(9000 + i).padStart(12, "0")}`, `Step ${i}: wait for the display to update.`, 18),
    );
    const real = row("ffffffff-0000-0000-0000-000000000003", "WARNING! Disconnect all power before servicing.", 18);
    const added = await retrieveSafetyChapterChunks(fakeClient([...waitOnly, real, CORPUS[3]]), "tenant", [chunk(P372, 372)]);
    expect(added.map((c) => c.content)).toEqual([real.content]);
  });

  it("the marker grammar matches extractManualSafetyStatement on line-opening markers only", () => {
    const re = new RegExp(SAFETY_MARKER_LINE);
    expect(re.test("WARNING! Read the chapter.")).toBe(true);
    expect(re.test("intro\n  \u26a0 DANGER: high voltage")).toBe(true);
    expect(re.test("the display shows WARNING: ACTIVE")).toBe(false);
    expect(re.test("warning: lowercase is not a printed marker")).toBe(false);
  });

  it("the marker grammar ranks every standalone heading line that yields a statement (#4509 r5 F4)", () => {
    const re = new RegExp(SAFETY_MARKER_LINE);
    for (const text of [
      "WARNING\nDisconnect all power before servicing.",
      "DANGER\nHazardous voltage inside.",
      "SHOCK HAZARD\nDo not touch the terminals while energized.",
      "  ⚠ WARNING\n\nDisconnect all power before servicing.",
    ]) {
      expect(extractManualSafetyStatement(text)).not.toBeNull();
      expect(re.test(text)).toBe(true);
    }
    expect(extractManualSafetyStatement("WARNINGS\nSee chapter 2.")).toBeNull();
    expect(re.test("WARNINGS\nSee chapter 2.")).toBe(false);
  });

  it("two manuals with byte-identical warnings each keep their own (Codex r3 F6)", async () => {
    const A = { id: "aaaaaaaa-0000-0000-0000-000000000001", url: "hub://acs355-rev-b.pdf" };
    const rows = [...CORPUS, { id: "a-18", doc_id: A.id, content: P18, source_url: A.url, page: 18 }];
    const retrieved = [{ ...chunk(P372, 372, A.id), sourceUrl: A.url }, chunk(P372, 372)];
    const added = await retrieveSafetyChapterChunks(fakeClient(rows), "tenant", retrieved);
    expect(added.map((c) => [c.docId, c.sourceUrl, c.sourcePage])).toEqual([
      [A.id, A.url, 18],
      [DOC, URL, 18],
    ]);
  });

  it("the document lookup recognises a curly-quoted reference (Codex r3 F5)", async () => {
    const curly = row("00000000-0000-0000-0000-000000000099", "Read chapter \u201cSafety\u201d on page 17 before you start.", 99);
    const client = fakeClient([curly, CORPUS[1], CORPUS[2]]);
    const added = await retrieveSafetyChapterChunks(client, "tenant", [chunk(P355, 355)]);
    expect(client.calls.some((c) => c.sql.includes("DISTINCT ON"))).toBe(true);
    expect(added.map((c) => c.sourcePage)).toEqual([18]);
  });

  it("one grammar: the inline matcher and the lookup pattern accept the same quote forms", () => {
    for (const q of ['chapter Safety on page 17', 'chapter "Safety" on page 17', "chapter \u201cSafety\u201d on page 17"]) {
      expect(safetyChapterPage(q)).toBe(17);
      expect(new RegExp(SAFETY_CHAPTER_REF_SQL, "i").test(q)).toBe(true);
    }
  });

  it("a chapter page split by the production chunker reaches the prompt whole (#5059 Codex r1 F1)", async () => {
    const pieces = chunkText(P18);
    expect(pieces.length).toBe(3);
    expect(pieces.slice(1).every((p) => extractManualSafetyStatement(p) === null)).toBe(true);
    // Ids run against chunk order, so only chunk_index can put the page back together.
    const rows = pieces.map((content, i) => ({ ...row(`00000000-0000-0000-0000-00000000180${9 - i}`, content, 18), chunk_index: i }));
    const retrieved = [chunk(P372, 372)];
    const added = await retrieveSafetyChapterChunks(fakeClient([CORPUS[0], ...rows, CORPUS[3]]), "tenant", retrieved);
    expect(added.map((c) => c.content)).toEqual(pieces);
    const prompt = buildManualUserContent("How do I replace the cooling fan", [...retrieved, ...added]);
    for (const step of [
      "wait for 5 minutes",
      "measuring with a multimeter",
      "Externally supplied control circuits may carry dangerous",
      "Disconnect the internal EMC filter when installing the drive on an IT system",
      "zone of equipotential bonding",
      "dangerous voltage is present at the power",
    ]) expect(prompt).toContain(step);
  });

  it("a wait step and a measurement-only step in later chunks stay with their warning (#5059 Codex r1 F1)", async () => {
    const page = [
      "WARNING! Hazardous voltage. Before you open the drive cover, follow every step below.",
      "Isolate the drive from the supply at the main disconnect. ".repeat(18),
      "Wait 10 minutes for the DC bus capacitors to drain. ".repeat(16),
      "Check with a multimeter that U1, V1 and W1 read 0 V to ground. ".repeat(24),
    ].join("\n\n");
    const pieces = chunkText(page);
    expect(pieces.length).toBe(4);
    expect(extractManualSafetyStatement(pieces[0])).not.toBeNull();
    expect(pieces.slice(1).every((p) => extractManualSafetyStatement(p) === null)).toBe(true);
    const waitAt = pieces.findIndex((p) => /Wait 10 minutes/.test(p));
    const measureAt = pieces.findIndex((p) => /0 V to ground/.test(p) && !/Wait|WARNING/.test(p));
    expect(waitAt).toBeGreaterThan(0);
    expect(measureAt).toBeGreaterThan(waitAt);
    const rows = pieces.map((content, i) => ({ ...row(`00000000-0000-0000-0000-00000000190${9 - i}`, content, 18), chunk_index: i }));
    const retrieved = [chunk(P372, 372)];
    const added = await retrieveSafetyChapterChunks(fakeClient([...rows, CORPUS[3]]), "tenant", retrieved);
    const prompt = buildManualUserContent("How do I replace the cooling fan", [...retrieved, ...added]);
    expect(prompt).toContain("Wait 10 minutes for the DC bus capacitors to drain.");
    expect(prompt).toContain("read 0 V to ground");
    expect(added.map((c) => c.content)).toEqual(pieces);
  });

  it("chunks before the page's first warning are not continuations of it", async () => {
    const intro = { ...row("00000000-0000-0000-0000-000000002001", "Contents of this chapter: wiring, fans, voltage ratings.", 18), chunk_index: 0 };
    const warn = { ...row("00000000-0000-0000-0000-000000002002", "WARNING! Disconnect all power before servicing.", 18), chunk_index: 1 };
    const tail = { ...row("00000000-0000-0000-0000-000000002003", "then wait 5 minutes and measure the DC voltage.", 18), chunk_index: 2 };
    const added = await retrieveSafetyChapterChunks(fakeClient([intro, warn, tail, CORPUS[3]]), "tenant", [chunk(P372, 372)]);
    expect(added.map((c) => c.content)).toEqual([warn.content, tail.content]);
  });

  it("a row without a chunk index is never taken as a continuation", async () => {
    const warn = row("00000000-0000-0000-0000-000000002101", "WARNING! Disconnect all power before servicing.", 18);
    const loose = row("00000000-0000-0000-0000-000000002102", "Fan kit part numbers and torque values.", 18);
    expect(warn.chunk_index).toBeUndefined();
    const added = await retrieveSafetyChapterChunks(fakeClient([warn, loose, CORPUS[3]]), "tenant", [chunk(P372, 372)]);
    expect(added.map((c) => c.content)).toEqual([warn.content]);
  });

  it("a run that runs out of budget stops there; it does not skip to a later chunk", async () => {
    const steps = "Wait 5 minutes for the capacitors to discharge, then measure the voltage. ";
    const first = [0, 1, 2, 3].map((i) => ({
      ...row(`00000000-0000-0000-0000-00000000220${i}`, `${i === 0 ? "WARNING! " : ""}Part ${i}. ${steps.repeat(17)}`, 17),
      chunk_index: i,
    }));
    expect(first.every((r) => r.content.length >= 1200)).toBe(true); // 4 x 1200 of the 6000 spent
    expect(new Set(first.map((r) => r.content)).size).toBe(4); // distinct, so none is deduped away
    const head = { ...row("00000000-0000-0000-0000-000000002301", "WARNING! Keep the cover closed while running.", 18), chunk_index: 0 };
    const middle = { ...row("00000000-0000-0000-0000-000000002302", "Keep it closed. ".repeat(80), 18), chunk_index: 1 };
    const tail = { ...row("00000000-0000-0000-0000-000000002303", "Then close the door.", 18), chunk_index: 2 };
    const added = await retrieveSafetyChapterChunks(fakeClient([...first, head, middle, tail, CORPUS[3]]), "tenant", [chunk(P372, 372)]);
    const kept = added.map((c) => c.content);
    expect(kept).toContain(head.content);
    expect(first.every((r) => kept.includes(r.content))).toBe(true);
    expect(kept).not.toContain(middle.content);
    expect(kept).not.toContain(tail.content);
  });

  it("the directive asks for the steps only on physical work", () => {
    expect(SAFETY_CHAPTER_DIRECTIVE).toMatch(/physically work/);
    expect(SAFETY_CHAPTER_DIRECTIVE).toMatch(/no physical work/);
  });
});
