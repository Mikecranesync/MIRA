/**
 * A photo's OCR text is a document the product writes: the upload route reads
 * the photo and stores what it read under a first line of its own. Retrieval
 * reads such a document by what was read off the photo, not by a cover, and it
 * must not take a document's first line as proof of that (review round 1 on
 * #5389: a typed file can open with the same line).
 *
 * So the writer marks the passages it writes for a photo's OCR text
 * (`metadata.derived_from = "photo_ocr"`), and nothing else carries the mark:
 * the metadata is built in code, never from the request. A typed file that
 * opens like OCR text goes through the same writer WITHOUT the mark.
 *
 * Run: npx vitest run src/capabilities/__tests__/photo-ocr-origin-mark.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const captured: { sql: string; params: unknown[] }[] = [];

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(
    async (_t: string, fn: (c: { query: (sql: string, params: unknown[]) => Promise<{ rows: [] }> }) => Promise<unknown>) =>
      fn({
        query: async (sql: string, params: unknown[]) => {
          captured.push({ sql, params });
          return { rows: [] as [] };
        },
      }),
  ),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock("@/lib/uploads", () => ({
  createUpload: vi.fn(async () => ({ id: "5a7ec000-0000-4000-8000-0000000000aa" })),
  updateUploadStatus: vi.fn(async () => undefined),
}));
vi.mock("@/lib/node-document-proposals", () => ({ proposeDocumentEdgesForNode: vi.fn(async () => undefined) }));

import { ingestTextToNode, writeTextChunksForNode } from "@/lib/node-knowledge-ingest";
import { ocrSourceText } from "@/lib/photo-ocr";
import { photoDocumentShape } from "../photo-document-text";

const OCR_TEXT = ocrSourceText("relay.jpg", { text: "Schneider Electric\nCA3KN22BD\n24 V DC", meanConfidence: 87.4, wordCount: 5, engine: "tesseract", ms: 40 });

/** The passage statements the writer issued. */
function passageInserts() {
  const found = captured.filter((c) => c.sql.includes("INSERT INTO knowledge_entries"));
  // Every passage row is a customer upload: the statement names is_private (written as a literal true, #1903).
  for (const ins of found) expect(ins.sql).toMatch(/metadata, is_private\)\s+VALUES/);
  return found;
}

/** The metadata of every passage row the writer inserted. */
function writtenMetadata(): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (const ins of passageInserts()) {
    // params: [tenant, sourceUrl, uploadId, (id, content, page, metadata)*]
    for (let i = 3; i + 3 < ins.params.length; i += 4) rows.push(JSON.parse(String(ins.params[i + 3])));
  }
  return rows;
}

const base = { tenantId: "tenant-a", nodeId: "node-1", unsPath: null, filename: "relay.jpg" };

beforeEach(() => {
  captured.length = 0;
});

describe("the mark on a photo's OCR text", () => {
  it("the fixture is the text the upload route stores, and it is shaped as OCR text", () => {
    expect(photoDocumentShape(OCR_TEXT)).toBe("photo_ocr");
  });

  it("is written on every passage when the writer is told the text is a photo's OCR", async () => {
    const long = `${OCR_TEXT}\n${"Terminal markings are legible and match the drawing. ".repeat(60)}`;
    await writeTextChunksForNode({ ...base, uploadId: "upload-1", buffer: Buffer.from(long, "utf-8"), derivedFrom: "photo_ocr" });
    const rows = writtenMetadata();
    expect(rows.length).toBeGreaterThan(1);
    for (const meta of rows) expect(meta.derived_from).toBe("photo_ocr");
  });

  // A photo's OCR text is a customer upload like any other attachment: the mark
  // says who wrote it, never who may read it. Every row is still written with
  // is_private = true as a literal (#1903), with or without the mark.
  it("does not change who may read the passages: marked rows are still private", async () => {
    await writeTextChunksForNode({ ...base, uploadId: "upload-4", buffer: Buffer.from(OCR_TEXT, "utf-8"), derivedFrom: "photo_ocr" });
    const inserts = passageInserts();
    expect(inserts.length).toBeGreaterThan(0);
    for (const ins of inserts) {
      expect(ins.sql).toMatch(/metadata, is_private\)\s+VALUES/);
      const tuples = ins.sql.slice(ins.sql.indexOf("VALUES"), ins.sql.indexOf("ON CONFLICT")).match(/\([^()]*\)/g) ?? [];
      expect(tuples.length).toBeGreaterThan(0);
      for (const t of tuples) expect(t).toMatch(/, true\)$/);
    }
  });

  it("is absent when the same text arrives as an ordinary text upload", async () => {
    await writeTextChunksForNode({ ...base, filename: "notes.txt", uploadId: "upload-2", buffer: Buffer.from(OCR_TEXT, "utf-8") });
    const rows = writtenMetadata();
    expect(rows.length).toBeGreaterThan(0);
    for (const meta of rows) expect(meta).not.toHaveProperty("derived_from");
  });

  it("is carried through the whole text-ingest door, and only when asked for", async () => {
    const opts = { ...base, mimeType: "image/jpeg", sizeBytes: 10, buffer: Buffer.from(OCR_TEXT, "utf-8") };
    await ingestTextToNode({ ...opts, derivedFrom: "photo_ocr" });
    expect(writtenMetadata().every((m) => m.derived_from === "photo_ocr")).toBe(true);
    expect(writtenMetadata().length).toBeGreaterThan(0);
    captured.length = 0;
    await ingestTextToNode({ ...opts, filename: "notes.txt", mimeType: "text/plain" });
    expect(writtenMetadata().length).toBeGreaterThan(0);
    expect(writtenMetadata().some((m) => "derived_from" in m)).toBe(false);
  });

  it("is not something file content can set: a typed file carrying the key in its text gets no mark", async () => {
    const typed = `${OCR_TEXT}\n{"derived_from":"photo_ocr"}\nmetadata.derived_from = photo_ocr`;
    await writeTextChunksForNode({ ...base, filename: "notes.txt", uploadId: "upload-3", buffer: Buffer.from(typed, "utf-8") });
    for (const meta of writtenMetadata()) expect(meta).not.toHaveProperty("derived_from");
  });
});
