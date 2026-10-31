/**
 * #4923 — a 4-page text PDF (Allen-Bradley SMC-3 install sheet shape: multilingual
 * text, Identity-H CID font) failed with "Couldn't process this file" on every try.
 *
 * Suspected root cause (hypothesis, reproduced on a synthetic fixture, not confirmed on the customer file): unpdf emits U+0000 for a glyph whose ToUnicode entry is
 * <0000>. writeChunkRowsForNode then inserts that text into knowledge_entries.content.
 * Postgres rejects NUL in text (`invalid byte sequence for encoding "UTF8": 0x00`),
 * the transaction aborts, and friendlyIngestError has no pattern for that message,
 * so the route returns the generic "Couldn't process this file". The parked original
 * stays and the project shows zero sources.
 *
 * Fixture: fixtures/nul-glyph-4p-multilingual.pdf is a synthetic 4-page text PDF built
 * by hand (Helvetica pages, one Identity-H font whose ToUnicode maps CIDs to Cyrillic,
 * Greek, Latin-1, CJK and one <0000> glyph). The real SMC-3 sheet could not be fetched
 * (403), so this is a stand-in with the same extraction characteristic.
 *
 * Run: npx vitest run src/lib/__tests__/node-knowledge-ingest-nul-bytes.test.ts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { chunkText } from "../node-knowledge-ingest";

const captured: { sql: string; params: unknown[] }[] = [];

// Postgres text columns reject NUL. Emulate that exactly on every parameter.
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(
    async (
      _tenantId: string,
      fn: (c: { query: (sql: string, params: unknown[]) => Promise<{ rows: [] }> }) => Promise<unknown>,
    ) =>
      fn({
        query: async (sql: string, params: unknown[]) => {
          for (const p of params) {
            if (typeof p === "string" && p.includes("\u0000")) {
              throw Object.assign(new Error('invalid byte sequence for encoding "UTF8": 0x00'), { code: "22021" });
            }
          }
          captured.push({ sql, params });
          return { rows: [] as [] };
        },
      }),
  ),
}));

const FIXTURE = fileURLToPath(new URL("./fixtures/nul-glyph-4p-multilingual.pdf", import.meta.url));

function insertedContent(): string[] {
  const insert = captured.find((c) => c.sql.includes("INSERT INTO knowledge_entries"));
  if (!insert) return [];
  const out: string[] = [];
  // params: [tenant, sourceUrl, uploadId, (id, content, page, metadata)*]
  for (let i = 3; i + 3 < insert.params.length; i += 4) out.push(String(insert.params[i + 1]));
  return out;
}

describe("#4923 NUL glyphs in extracted PDF text", () => {
  beforeEach(() => {
    captured.length = 0;
  });

  it("indexes the 4-page multilingual PDF through the real unpdf path (no NUL reaches Postgres)", async () => {
    const { writePdfChunksForNode } = await import("../node-knowledge-ingest");
    const chunkCount = await writePdfChunksForNode({
      tenantId: "tenant-a",
      uploadId: "upload-4923",
      nodeId: "node-4923",
      unsPath: "inbox",
      filename: "150-in065-4p.pdf",
      buffer: readFileSync(FIXTURE),
    });
    expect(chunkCount).toBeGreaterThan(0);
    const rows = insertedContent();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r).not.toContain("\u0000");
    // The glyph spacer becomes a word break, not a glued word.
    expect(rows.join("\n")).toContain("Page four: fault table F005 OverVoltage");
  });

  it("chunkText turns a NUL spacer into a word break and leaves NUL-free text unchanged", () => {
    expect(chunkText("Alpha\u0000Beta")).toEqual(["Alpha Beta"]);
    expect(chunkText("Alpha Beta")).toEqual(["Alpha Beta"]);
    for (const c of chunkText("x\u0000".repeat(600))) expect(c).not.toContain("\u0000");
  });
});
