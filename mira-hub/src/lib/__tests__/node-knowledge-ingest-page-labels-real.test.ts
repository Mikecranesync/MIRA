/**
 * #4508 — the same contract as node-knowledge-ingest-page-labels.test.ts, but
 * through the REAL unpdf/pdfjs parser (no unpdf mock): a genuine PDF whose
 * /PageLabels tree numbers its pages "i", "ii", "1" must land those labels in
 * chunk metadata, and the same PDF without the tree must land none.
 *
 * Run: npx vitest run src/lib/__tests__/node-knowledge-ingest-page-labels-real.test.ts
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

/** A minimal valid 3-page PDF (correct xref offsets), optionally with /PageLabels. */
function buildPdf(withLabels: boolean): Buffer {
  const texts = ["Front matter notice page", "Table of contents page", "Safety instructions page"];
  const pageIds = [3, 4, 5];
  const objs: string[] = [];
  const labels = withLabels ? " /PageLabels << /Nums [0 << /S /r >> 2 << /S /D >>] >>" : "";
  objs[1] = `<< /Type /Catalog /Pages 2 0 R${labels} >>`;
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] /Count 3 >>`;
  texts.forEach((t, k) => {
    const content = `BT /F1 12 Tf 72 720 Td (${t}) Tj ET`;
    objs[3 + k] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 9 0 R >> >> /Contents ${6 + k} 0 R >>`;
    objs[6 + k] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  objs[9] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

function labelsByPage(): Array<[number, unknown]> {
  const rows: Array<[number, unknown]> = [];
  for (const ins of captured.filter((c) => c.sql.includes("INSERT INTO knowledge_entries"))) {
    for (let i = 3; i + 3 < ins.params.length; i += 4) {
      const meta = JSON.parse(String(ins.params[i + 3])) as Record<string, unknown>;
      rows.push([Number(ins.params[i + 2]), meta.page_label]);
    }
  }
  return rows;
}

async function ingest(buffer: Buffer) {
  const { writePdfChunksForNode } = await import("../node-knowledge-ingest");
  return writePdfChunksForNode({
    tenantId: "tenant-a",
    uploadId: "upload-1",
    nodeId: "node-1",
    unsPath: null,
    filename: "labelled.pdf",
    buffer,
  });
}

beforeEach(() => {
  captured.length = 0;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

describe("real unpdf parse records the PDF's /PageLabels", () => {
  it("a labelled PDF lands i, ii, 1 on its three pages", async () => {
    const n = await ingest(buildPdf(true));
    expect(n).toBe(3);
    expect(labelsByPage()).toEqual([
      [1, "i"],
      [2, "ii"],
      [3, "1"],
    ]);
  });

  it("the same PDF without a label tree lands no page_label", async () => {
    const n = await ingest(buildPdf(false));
    expect(n).toBe(3);
    expect(labelsByPage()).toEqual([
      [1, undefined],
      [2, undefined],
      [3, undefined],
    ]);
  });
});
