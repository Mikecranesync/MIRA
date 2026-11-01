/**
 * #5065 Codex r4 F1 — readPageLabelsBounded runs pdfjs getPageLabels() in a heap-limited,
 * timed worker, so a hostile /PageLabels tree (lettered style + huge /St) cannot expand
 * inside the Hub's own heap. Real PDFs, real unpdf, real worker — no mocks.
 *
 * Run: npx vitest run src/capabilities/__tests__/pdf-page-label-reader.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readPageLabelsBounded } from "@/capabilities/pdf-page-label-reader";

/** A valid n-page text PDF (correct xref offsets) with an optional /PageLabels dictionary. */
function buildPdf(n: number, pageLabels: string | null): Buffer {
  const objs: string[] = [];
  const pageId = (k: number) => 4 + 2 * k;
  objs[1] = `<< /Type /Catalog /Pages 2 0 R${pageLabels ? ` /PageLabels ${pageLabels}` : ""} >>`;
  objs[2] = `<< /Type /Pages /Kids [${Array.from({ length: n }, (_, k) => `${pageId(k)} 0 R`).join(" ")}] /Count ${n} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  for (let k = 0; k < n; k++) {
    const content = `BT /F1 12 Tf 72 720 Td (Page ${k + 1} body text) Tj ET`;
    objs[pageId(k)] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId(k) + 1} 0 R >>`;
    objs[pageId(k) + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  }
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

const warn = vi.fn();
beforeEach(() => {
  warn.mockReset();
  vi.spyOn(console, "warn").mockImplementation(warn);
});
const warned = () => warn.mock.calls.map((c) => String(c[0])).join("\n");

describe("readPageLabelsBounded", () => {
  it("returns an ordinary label tree (control)", async () => {
    const labels = await readPageLabelsBounded(buildPdf(3, "<< /Nums [0 << /S /r >> 2 << /S /D >>] >>"), "ok.pdf");
    expect(labels).toEqual(["i", "ii", "1"]);
  });

  it("returns null for a PDF without a label tree", async () => {
    expect(await readPageLabelsBounded(buildPdf(2, null), "plain.pdf")).toBeNull();
  });

  it("returns null, not a throw, for bytes that are not a PDF", async () => {
    expect(await readPageLabelsBounded(Buffer.from("not a pdf"), "junk.pdf")).toBeNull();
    expect(warned()).toContain("junk.pdf");
  });

  it("refuses an expanding lettered tree that fits the worker heap (/St 100000, 200 pages)", async () => {
    const labels = await readPageLabelsBounded(buildPdf(200, "<< /Nums [0 << /S /A /St 100000 >>] >>"), "big.pdf");
    expect(labels).toBeNull();
    expect(warned()).toContain("labels over the size limit");
  });

  it("contains an expansion past the worker heap (/St 100000000, 200 pages) without growing the Hub heap", async () => {
    globalThis.gc?.();
    const before = process.memoryUsage().heapUsed;
    const labels = await readPageLabelsBounded(buildPdf(200, "<< /Nums [0 << /S /A /St 100000000 >>] >>"), "bomb.pdf");
    const grew = process.memoryUsage().heapUsed - before;
    expect(labels).toBeNull();
    expect(warned()).toMatch(/label worker (failed|exited)/);
    // pdfjs would build about 770 million characters here; the main isolate must not hold them.
    expect(grew).toBeLessThan(64 * 1024 * 1024);
  }, 30_000);

  it("returns null when the worker does not finish within its timeout", async () => {
    const labels = await readPageLabelsBounded(buildPdf(3, "<< /Nums [0 << /S /r >>] >>"), "slow.pdf", { timeoutMs: 1 });
    expect(labels).toBeNull();
    expect(warned()).toContain("timed out");
  });

  it("leaves the caller's buffer intact (the worker gets a transferred copy)", async () => {
    const buf = buildPdf(3, "<< /Nums [0 << /S /D >>] >>");
    const len = buf.length;
    await readPageLabelsBounded(buf, "keep.pdf");
    expect(buf.length).toBe(len);
    expect(buf.subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
  });

  it("stores no labels under Bun, which does not enforce worker heap limits", async () => {
    const pdf = buildPdf(3, "<< /Nums [0 << /S /D >>] >>");
    expect(process.versions.bun).toBeUndefined(); // precondition: this runner is Node
    Object.defineProperty(process.versions, "bun", { value: "1.4.0", configurable: true });
    try {
      expect(await readPageLabelsBounded(pdf, "bun.pdf")).toBeNull();
      expect(warned()).toContain("not enforced under Bun");
    } finally {
      delete (process.versions as Record<string, string | undefined>).bun;
    }
    expect(await readPageLabelsBounded(pdf, "node.pdf")).toEqual(["1", "2", "3"]);
  });
});
