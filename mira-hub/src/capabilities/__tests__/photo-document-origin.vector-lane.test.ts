/**
 * The vector lane is a fourth place a passage can first be seen (after the
 * lexical passes, the exact-token lanes and the cover pass). Admission is one
 * predicate for all of them, and so is the question it asks about a
 * photo-shaped document: do the upload records say the product wrote it?
 * (review round 1 on #5389). Here the vector lane is the ONLY lane that finds
 * the document, in a node-scoped ask, where no cover pass runs.
 *
 * Run: npx vitest run src/capabilities/__tests__/photo-document-origin.vector-lane.test.ts
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { retrieveNodeChunks } from "../../lib/manual-rag";
import { PHOTO_READING_BODY_MARK, PHOTO_READING_OPENER } from "../photo-document-text";

const VEC = Array.from({ length: 768 }, (_, i) => (i % 5) / 10);
const DOC = "5a7ec000-0000-4000-8000-0000000000b1";
const TENANT = "5a7ec000-0000-4000-8000-0000000000b0";
// A sibling's cover under the product's photo-reading line, with a passing mention of the asked model.
const HEADING = `${PHOTO_READING_OPENER}\nNorthfield RX410 Logic Controller\nHardware User Guide\n${PHOTO_READING_BODY_MARK}\nThis guide is sometimes kept beside the RX420 on the same line.`;
const ROW = {
  content: "Supply voltage 24 V DC.",
  doc_id: DOC,
  source_url: `node-doc/${DOC}/notes.txt`,
  source_page: 1,
  page_start: 1,
  section_path: null,
  filename: "notes.txt",
  document_heading: HEADING,
  verified: true,
  lexemes: ["suppli", "voltag"],
  rank: 0,
  vscore: 0.9,
};

function client(recordedAs: string | null) {
  const statements: string[] = [];
  const query = vi.fn(async (sql: string) => {
    statements.push(sql.replace(/\s+/g, " ").trim().slice(0, 60));
    if (sql.includes("document-origin")) return { rows: recordedAs ? [{ doc_id: DOC, written_as: recordedAs }] : [] };
    if (sql.includes("<=>")) return { rows: [ROW] };
    return { rows: [] };
  });
  return { client: { query } as unknown as PoolClient, statements };
}

const ask = (c: PoolClient) =>
  retrieveNodeChunks(c, TENANT, "RX420 supply voltage?", { nodeId: "n-1", unsPath: null, rawQuery: "RX420 supply voltage?", topK: 3 });

function enableHybrid() {
  vi.stubEnv("NOTEBOOK_HYBRID_RETRIEVAL", "1");
  vi.stubEnv("NOTEBOOK_RERANK", "0");
  vi.stubEnv("OLLAMA_BASE_URL", "http://embedder.test");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ embedding: VEC }), { status: 200 })));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("a photo-shaped document found only by the vector lane", () => {
  it("with no record that the product wrote it, its cover decides: the sibling's guide is refused", async () => {
    enableHybrid();
    const { client: c, statements } = client(null);
    expect(await ask(c)).toEqual([]);
    // Precondition: the vector lane really ran and the records really were asked.
    expect(statements.some((s) => s.includes("document-origin"))).toBe(true);
    expect(vi.mocked(c.query).mock.calls.some(([sql]) => String(sql).includes("<=>"))).toBe(true);
  });

  it("recorded as the product's photo reading, the same words are a reading and it answers", async () => {
    enableHybrid();
    const { client: c } = client("photo_text");
    const hits = await ask(c);
    expect(hits.map((h) => h.docId)).toEqual([DOC]);
  });

  it("recorded as a different kind of product-written document, it is still judged by its cover", async () => {
    enableHybrid();
    const { client: c } = client("nameplate_text");
    expect(await ask(c)).toEqual([]);
  });
});
