// #3331 — tied relevance scores must return in a fixed order, or the same
// question can get different chunks (and a different cited page) run to run.
import { describe, it, expect, vi } from "vitest";
import { retrieveManualChunks } from "@/lib/manual-rag";

const TENANT = "00000000-0000-0000-0000-000000000001";

async function rankedSql(query: string, opts: Parameters<typeof retrieveManualChunks>[3] = {}) {
  const q = vi.fn(async () => ({ rows: [] }));
  await retrieveManualChunks({ query: q } as never, TENANT, query, opts);
  return (q.mock.calls as unknown as Array<[string]>)
    .map(([sql]) => sql)
    .filter((sql) => /FROM knowledge_entries/.test(sql) && /LIMIT/.test(sql));
}

function orderBy(sql: string): string {
  const m = sql.match(/ORDER BY([\s\S]*?)LIMIT/);
  return (m?.[1] ?? "").replace(/\s+/g, " ").trim();
}

describe("retrieveManualChunks breaks every rank tie down to the chunk (#3331)", () => {
  it("BM25 lane breaks rank ties by source, page, then chunk index", async () => {
    const sqls = await rankedSql("What supply voltage range does the Micro810 accept?", {
      manufacturer: "Rockwell Automation",
    });
    const bm25 = sqls.filter((s) => /content_tsv @@/.test(s));
    expect(bm25.length).toBeGreaterThan(0);
    for (const s of bm25) {
      expect(orderBy(s)).toBe("rank DESC, source_url, source_page NULLS LAST, metadata->>'chunk_index'");
    }
  });

  it("whole-token code lane breaks page ties by source then chunk index", async () => {
    const sqls = await rankedSql("E.OV1 alarm on the drive", { manufacturer: "Rockwell Automation" });
    const code = sqls.filter((s) => /content ~\* ANY/.test(s));
    expect(code.length).toBeGreaterThan(0);
    for (const s of code) {
      expect(orderBy(s)).toBe("source_page NULLS LAST, source_url, metadata->>'chunk_index'");
    }
  });

  it("no ranked knowledge_entries query is left without a chunk-level final key", async () => {
    const sqls = [
      ...(await rankedSql("PowerFlex 525 F004 on power-up")),
      ...(await rankedSql("Alarm 7 on the PowerFlex 525", { manufacturer: "Rockwell Automation", model: "PowerFlex 525" })),
    ];
    expect(sqls.length).toBeGreaterThan(0);
    for (const s of sqls) expect(orderBy(s)).toMatch(/, metadata->>'chunk_index'$/);
  });
});
