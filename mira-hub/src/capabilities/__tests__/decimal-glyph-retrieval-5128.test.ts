// #5128 / #5143 Codex r1 F1 — retrieval must hand back manual text exactly as
// stored. U+FFFD between two digits is a period in the AutomationDirect manuals,
// but in another manual it can stand for a range dash ("208�240 V"), and no
// stored field tells the two apart. So nothing is rewritten on read; the
// display fix is a re-extraction from the source PDF (#5144).
import { describe, it, expect } from "vitest";
import { vi } from "vitest";

import { retrieveCitedPageChunks, retrieveManualChunks } from "@/lib/manual-rag";

const TENANT = "00000000-0000-0000-0000-000000000001";
const AD_TEXT = "P01�02 Decel Time 1 Range: 0�1 to 600�0 sec Default Setting: 30�0 sec";
const RANGE_TEXT = "Input voltage 208�240 V, single phase";

function row(id: string, content: string, page: number) {
  return {
    id,
    doc_id: `d${page}`,
    content,
    source_url: `doc${page}.pdf`,
    source_page: page,
    page_start: page,
    page,
    manufacturer: "AutomationDirect",
    model_number: "GS1",
    rank: 1,
    metadata: { chunk_index: page },
  };
}

function clientReturning(rows: Record<string, unknown>[]) {
  return {
    query: vi.fn(async (sql: string) =>
      /FROM\s+knowledge_entries\b/.test(sql) ? { rows } : { rows: [] },
    ),
  };
}

describe("retrieval returns stored text byte for byte (#5143 F1)", () => {
  it("retrieveManualChunks leaves both the decimal and the range glyph as stored", async () => {
    const client = clientReturning([
      row("00000000-0000-0000-0000-0000000000aa", AD_TEXT, 9),
      row("00000000-0000-0000-0000-0000000000bb", RANGE_TEXT, 4),
    ]);
    const chunks = await retrieveManualChunks(client as never, TENANT, "GS1 decel time default input voltage", {
      manufacturer: "AutomationDirect",
    });
    const contents = chunks.map((c) => c.content);
    expect(contents).toContain(AD_TEXT);
    expect(contents).toContain(RANGE_TEXT);
    expect(contents.join("\n")).not.toContain("208.240");
  });

  it("retrieveCitedPageChunks leaves the range glyph as stored", async () => {
    const client = clientReturning([row("00000000-0000-0000-0000-0000000000bb", RANGE_TEXT, 4)]);
    const out = await retrieveCitedPageChunks(client as never, TENANT, [
      { docId: "d4", sourceUrl: "doc4.pdf", page: 4 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe(RANGE_TEXT);
  });
});
