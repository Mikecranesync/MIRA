/**
 * #4923 — text PDFs (and text uploads) whose extraction contains U+0000 fail
 * with "Couldn't process this file". Postgres UTF8 rejects 0x00 (SQLSTATE
 * 22021); the route has no friendly branch for that message.
 *
 * Staging confirmed both SMC-3 uploads of smc3-150-in065.pdf died with
 * `invalid byte sequence for encoding "UTF8": 0x00`. This file does not live
 * under mira-hub/src/lib/__tests__ (lifecycle-guard tripwire on #5038).
 *
 * Run: npx vitest run src/capabilities/__tests__/node-knowledge-ingest-nul-bytes.test.ts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chunkText, stripNulBytes } from "@/lib/node-knowledge-ingest";

const captured: { sql: string; params: unknown[] }[] = [];
const pdf = vi.hoisted(() => ({
  pages: [] as string[],
  labels: null as unknown,
}));

vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(async () => ({})),
  extractText: vi.fn(async () => ({ text: pdf.pages })),
}));

vi.mock("@/capabilities/pdf-page-label-reader", () => ({
  readPageLabelsBounded: vi.fn(async () => pdf.labels),
}));

// Postgres text/JSONB columns reject NUL. Emulate that on every parameter.
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
              throw Object.assign(new Error('invalid byte sequence for encoding "UTF8": 0x00'), {
                code: "22021",
              });
            }
          }
          captured.push({ sql, params });
          return { rows: [] as [] };
        },
      }),
  ),
}));

const FIXTURE = fileURLToPath(new URL("./fixtures/nul-embedded.txt", import.meta.url));

function insertedRows(): Array<{ content: string; meta: Record<string, unknown> }> {
  const rows: Array<{ content: string; meta: Record<string, unknown> }> = [];
  for (const ins of captured.filter((c) => c.sql.includes("INSERT INTO knowledge_entries"))) {
    // Contract 13: is_private must appear near the INSERT string (the real
    // writer pins true; this test is not a writer).
    expect(ins.sql).toMatch(/is_private/);
    // params: [tenant, sourceUrl, uploadId, (id, content, page, metadata)*]
    for (let i = 3; i + 3 < ins.params.length; i += 4) {
      rows.push({
        content: String(ins.params[i + 1]),
        meta: JSON.parse(String(ins.params[i + 3])),
      });
    }
  }
  return rows;
}

beforeEach(() => {
  captured.length = 0;
  pdf.pages = [];
  pdf.labels = null;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

describe("#4923 NUL bytes never reach Postgres", () => {
  it("stripNulBytes / chunkText turn a NUL spacer into a word break", () => {
    expect(stripNulBytes("Alpha\u0000Beta")).toBe("Alpha Beta");
    expect(chunkText("Alpha\u0000Beta")).toEqual(["Alpha Beta"]);
    expect(chunkText("Alpha Beta")).toEqual(["Alpha Beta"]);
    for (const c of chunkText("x\u0000".repeat(600))) expect(c).not.toContain("\u0000");
  });

  it("writeTextChunksForNode indexes a fixture with an embedded NUL", async () => {
    const { writeTextChunksForNode } = await import("@/lib/node-knowledge-ingest");
    const buffer = readFileSync(FIXTURE);
    expect(buffer.includes(0x00)).toBe(true);

    const count = await writeTextChunksForNode({
      tenantId: "tenant-a",
      uploadId: "upload-4923-txt",
      nodeId: "node-4923",
      unsPath: "inbox\u0000line",
      filename: "smc3\u0000in065.txt",
      buffer,
    });
    expect(count).toBeGreaterThan(0);
    const rows = insertedRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.content).not.toContain("\u0000");
      expect(JSON.stringify(r.meta)).not.toContain("\u0000");
    }
    expect(rows.map((r) => r.content).join("\n")).toContain("F005 OverVoltage");
    expect(rows[0]?.meta.filename).toBe("smc3 in065.txt");
    expect(rows[0]?.meta.uns_path).toBe("inbox line");
  });

  it("writePdfChunksForNode strips NUL from page text and page-label metadata", async () => {
    pdf.pages = [
      "Page one: SMC-3 soft starter install.",
      "Page four: fault table F005\u0000OverVoltage",
    ];
    pdf.labels = ["i", "4\u0000A"];
    const { writePdfChunksForNode } = await import("@/lib/node-knowledge-ingest");
    const count = await writePdfChunksForNode({
      tenantId: "tenant-a",
      uploadId: "upload-4923-pdf",
      nodeId: "node-4923",
      unsPath: "inbox",
      filename: "smc3-150-in065.pdf",
      buffer: Buffer.from("%PDF-1.4 stub"),
    });
    expect(count).toBeGreaterThan(0);
    const rows = insertedRows();
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.content).not.toContain("\u0000");
      expect(JSON.stringify(r.meta)).not.toContain("\u0000");
    }
    expect(rows[1]?.content).toContain("F005 OverVoltage");
    expect(rows[1]?.meta.page_label).toBe("4 A");
  });
});
