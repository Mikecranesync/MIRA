import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { ManualChunk } from "@/lib/manual-rag";
import { askUserContent, confirmedSourceDocIds, preferOwnDocuments, CONFIRMED_SOURCE_LIMIT } from "./confirmed-sources";

const TENANT = "22222222-2222-4222-8222-222222222222";

describe("confirmedSourceDocIds (#3437)", () => {
  it("returns every confirmed, current source for the tenant, newest first — retrieval does the ranking", async () => {
    const query = vi.fn(async () => ({ rows: [{ doc_id: "d-1" }, { doc_id: "d-2" }] }));
    await expect(confirmedSourceDocIds({ query } as never, TENANT)).resolves.toEqual({
      docIds: ["d-1", "d-2"],
      truncated: false,
    });
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(params).toEqual([TENANT]);
    expect(sql).toMatch(/s\.tenant_id = \$1::uuid/);
    expect(sql).toMatch(/match_state IN \('user_confirmed', 'verified'\)/);
    expect(sql).toMatch(/superseded_at IS NULL/);
    expect(sql).not.toMatch(/candidate/);
    // Round 2 F1/F2: no question-based prefilter — it defeated retrieval's
    // synonym expansion and let a recency cap drop the relevant older manual.
    expect(sql).not.toMatch(/tsquery|content_tsv|EXISTS/);
    expect(sql).toMatch(/ORDER BY MAX\(s\.created_at\) DESC/);
  });

  it("round 3 F1: with a maker chosen, drops documents confirmed only under a different maker", async () => {
    const query = vi.fn(async () => ({
      rows: [
        { doc_id: "siemens-only", manufacturers: ["Siemens"] },
        { doc_id: "yaskawa", manufacturers: ["Yaskawa"] },
        { doc_id: "unbound", manufacturers: [null] },
        { doc_id: "both", manufacturers: ["Siemens", "Yaskawa"] },
      ],
    }));
    const r = await confirmedSourceDocIds({ query } as never, TENANT, "Yaskawa");
    expect(r.docIds).toEqual(["yaskawa", "unbound", "both"]);
    // No maker chosen: nothing is dropped.
    const all = await confirmedSourceDocIds({ query } as never, TENANT, null);
    expect(all.docIds).toHaveLength(4);
  });

  it("reports (never hides) hitting the parameter bound", async () => {
    const rows = Array.from({ length: CONFIRMED_SOURCE_LIMIT + 1 }, (_, i) => ({ doc_id: `d-${i}` }));
    const query = vi.fn(async () => ({ rows }));
    const r = await confirmedSourceDocIds({ query } as never, TENANT);
    expect(r.truncated).toBe(true);
    expect(r.docIds).toHaveLength(CONFIRMED_SOURCE_LIMIT);
  });
});

describe("askUserContent (F4: an unavailable lane is never a 'no match')", () => {
  it("says own manuals were not searched even when the library answered", () => {
    const c = askUserContent("[1] library excerpt", "Q?", { library: false, ownDocuments: true });
    expect(c).toContain("[1] library excerpt");
    expect(c).toMatch(/own uploaded manuals could NOT be searched/);
  });
  it("reports unavailable, not no-match, when only the own-document lane failed and nothing matched", () => {
    const c = askUserContent("", "Q?", { library: false, ownDocuments: true });
    expect(c).toMatch(/UNAVAILABLE/);
    expect(c).not.toMatch(/no manual excerpt matched/);
  });
  it("says when only part of the confirmed manuals were searched", () => {
    const c = askUserContent("ctx", "Q?", { library: false, ownDocuments: false, ownDocumentsPartial: true });
    expect(c).toMatch(/only the most recently confirmed/);
  });
  it("round 3 F2: a partial search with nothing found never claims a complete no-match", () => {
    const c = askUserContent("", "Q?", { library: false, ownDocuments: false, ownDocumentsPartial: true });
    expect(c).toMatch(/only the most recently confirmed/);
    expect(c).not.toMatch(/no manual excerpt matched this question/);
  });
  it("keeps the honest no-match wording when both searches ran", () => {
    expect(askUserContent("", "Q?", { library: false, ownDocuments: false })).toMatch(/no manual excerpt matched/);
    expect(askUserContent("ctx", "Q?", { library: false, ownDocuments: false })).not.toMatch(/NOTE/);
  });
});

const chunk = (content: string, url: string, page = 1): ManualChunk =>
  ({ content, sourceUrl: url, sourcePage: page, manufacturer: "", modelNumber: "", title: "", rank: 0, verified: false }) as ManualChunk;

describe("preferOwnDocuments", () => {
  it("puts the technician's documents first, de-duplicated, capped", () => {
    const own = [chunk("own torque 4.7 Nm", "node-doc/a/m.pdf")];
    const lib = [
      chunk("own torque 4.7 Nm", "node-doc/a/m.pdf"),
      chunk("oem 1", "oem/x.pdf"),
      chunk("oem 2", "oem/y.pdf"),
    ];
    expect(preferOwnDocuments(own, lib, 2).map((c) => c.content)).toEqual(["own torque 4.7 Nm", "oem 1"]);
  });

  it("with no own documents, the library answer is unchanged", () => {
    const lib = [chunk("oem 1", "oem/x.pdf")];
    expect(preferOwnDocuments([], lib, 6)).toEqual(lib);
  });
});

/**
 * Source-level wiring check for /api/hub/ask (same technique as that route's
 * hybrid-corpus test, kept here because src/app/** tests are lifecycle-guarded).
 * The defect was invisible at the SQL layer: the lane simply did not exist.
 */
describe("/api/hub/ask wires the confirmed-document lane (#3437)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const route = readFileSync(resolve(here, "../app/api/hub/ask/route.ts"), "utf8");
  const code = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("the comment stripper strips (positive control)", () => {
    expect(route).toContain("#3437");
    expect(code).not.toContain("#3437");
  });

  it("admits the tenant's CONFIRMED documents on the same raw client and tenant", () => {
    expect(code).toMatch(/confirmedSourceDocIds\(\s*client,\s*ctx\.tenantId,\s*manufacturer\s*\)/);
    expect(code).toMatch(/ownDocumentsPartial = true/);
    expect(code).toMatch(/ownDocumentsFailed = true/);
    expect(code).toMatch(/retrieveNodeChunks\(\s*client,\s*ctx\.tenantId/);
    expect(code).toMatch(/validatedDocScope:\s*true/);
    expect(code).toMatch(/approvedSourceDocIds:\s*docIds/);
    expect(code).toMatch(/preferOwnDocuments\(\s*own,\s*library/);
    // Still the raw owner pool: withTenantContext would hide the OEM corpus (#2178).
    expect(code).not.toContain("withTenantContext");
  });
});
