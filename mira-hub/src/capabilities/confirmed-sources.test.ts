import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { ManualChunk } from "@/lib/manual-rag";
import { askUserContent, confirmedSourceDocIds, preferOwnDocuments, CONFIRMED_SOURCE_LIMIT } from "./confirmed-sources";

const TENANT = "22222222-2222-4222-8222-222222222222";

describe("confirmedSourceDocIds (#3437)", () => {
  it("asks for this tenant's confirmed, current sources that MATCH the question, newest first", async () => {
    const query = vi.fn(async () => ({ rows: [{ doc_id: "d-1" }, { doc_id: "d-2" }] }));
    await expect(confirmedSourceDocIds({ query } as never, TENANT, "torque spec")).resolves.toEqual(["d-1", "d-2"]);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(params).toEqual([TENANT, "torque spec"]);
    expect(sql).toMatch(/s\.tenant_id = \$1::uuid/);
    expect(sql).toMatch(/k\.tenant_id = \$1::uuid/);
    expect(sql).toMatch(/match_state IN \('user_confirmed', 'verified'\)/);
    expect(sql).toMatch(/superseded_at IS NULL/);
    // F3: candidates are chosen by the question, deterministically ordered —
    // a relevant manual can't be hidden behind an unordered first page.
    expect(sql).toMatch(/EXISTS \(/);
    expect(sql).toMatch(/content_tsv @@/);
    expect(sql).toMatch(/ORDER BY MAX\(s\.created_at\) DESC/);
    expect(sql).not.toMatch(/candidate/);
    expect(sql).toContain(`LIMIT ${CONFIRMED_SOURCE_LIMIT}`);
  });

  it("does not query for an empty question", async () => {
    const query = vi.fn();
    await expect(confirmedSourceDocIds({ query } as never, TENANT, "   ")).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
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
    expect(code).toMatch(/confirmedSourceDocIds\(\s*client,\s*ctx\.tenantId,\s*searchQuery\s*\)/);
    expect(code).toMatch(/ownDocumentsFailed = true/);
    expect(code).toMatch(/retrieveNodeChunks\(\s*client,\s*ctx\.tenantId/);
    expect(code).toMatch(/validatedDocScope:\s*true/);
    expect(code).toMatch(/approvedSourceDocIds:\s*docIds/);
    expect(code).toMatch(/preferOwnDocuments\(\s*own,\s*library/);
    // Still the raw owner pool: withTenantContext would hide the OEM corpus (#2178).
    expect(code).not.toContain("withTenantContext");
  });
});
