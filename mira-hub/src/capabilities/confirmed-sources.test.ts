import { describe, it, expect, vi } from "vitest";
import type { ManualChunk } from "@/lib/manual-rag";
import { confirmedSourceDocIds, preferOwnDocuments, CONFIRMED_SOURCE_LIMIT } from "./confirmed-sources";

const TENANT = "22222222-2222-4222-8222-222222222222";

describe("confirmedSourceDocIds (#3437)", () => {
  it("asks for this tenant's confirmed, current notebook sources only", async () => {
    const query = vi.fn(async () => ({ rows: [{ doc_id: "d-1" }, { doc_id: "d-2" }] }));
    await expect(confirmedSourceDocIds({ query } as never, TENANT)).resolves.toEqual(["d-1", "d-2"]);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(params).toEqual([TENANT]);
    expect(sql).toMatch(/tenant_id = \$1::uuid/);
    expect(sql).toMatch(/match_state IN \('user_confirmed', 'verified'\)/);
    expect(sql).toMatch(/superseded_at IS NULL/);
    // A candidate (never human-confirmed) or rejected source is not admission.
    expect(sql).not.toMatch(/candidate/);
    expect(sql).toContain(`LIMIT ${CONFIRMED_SOURCE_LIMIT}`);
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
