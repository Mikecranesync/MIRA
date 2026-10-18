/**
 * Codex r2 F1 on #4484: a notebook identity stored as a bare number ("850" —
 * the proposal flow strips the family) was matched to any manual whose title
 * carried the same DIGITS, so an Allen-Bradley Micro850 notebook cited an ABB
 * "ACS850 Firmware Manual" for a model-less question. The digits alone name no
 * family: a bare number now reaches a manual only through a FAMILY_ROOTS entry
 * of the notebook's own manufacturer.
 *
 * Lives under capabilities/__tests__ (ungated) rather than beside
 * src/lib/__tests__/manual-rag.test.ts, which the UI lifecycle guard protects.
 */
import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { retrieveNodeChunks } from "../../lib/manual-rag";

function clientWith(row: Record<string, unknown>): PoolClient {
  const query = vi.fn(async () => ({ rows: [row] }));
  return { query } as unknown as PoolClient;
}

const nodeRow = (filename: string, heading: string) => ({
  content: "Communication settings are configured in the controller properties.",
  source_url: `node-doc/u1/${filename}`,
  source_page: 2,
  page_start: 2,
  section_path: null,
  filename,
  document_heading: heading,
  rank: 0.4,
});

const ask = (heading: string, filename: string, manufacturer: string | null, model = "850") =>
  retrieveNodeChunks(clientWith(nodeRow(filename, heading)), "t-1", "communication settings", {
    nodeId: "n-1",
    unsPath: null,
    docIds: ["d-1"],
    validatedDocScope: true,
    identity: { manufacturer, model },
    identityStatus: "user_confirmed",
  });

describe("bare-number identity — matching digits in another vendor's family are not the same machine (Codex r2 F1)", () => {
  it("'850' on an Allen-Bradley notebook rejects the ABB ACS850 manual", async () => {
    expect(await ask("ACS850 Firmware Manual", "acs850-fw.pdf", "Allen-Bradley")).toEqual([]);
  });

  it("control: the same notebook keeps its Micro850 manual and the Micro800 family manual", async () => {
    expect(await ask("Micro850 Programmable Controllers User Manual", "2080-um002.pdf", "Allen-Bradley")).toHaveLength(1);
    expect(await ask("Micro800 Programmable Controllers General Instructions", "2080-rm001.pdf", "Allen-Bradley")).toHaveLength(1);
    // Vendor spelling varies across nameplates and proposals.
    expect(await ask("Micro850 Programmable Controllers User Manual", "2080-um002.pdf", "Rockwell Automation")).toHaveLength(1);
  });

  it("the vendor tie is real: an ABB '850' never reaches the Micro850 manual", async () => {
    expect(await ask("Micro850 Programmable Controllers User Manual", "2080-um002.pdf", "ABB")).toEqual([]);
  });

  it("no manufacturer ⇒ no grounded family ⇒ no family manual is admitted for a bare number", async () => {
    expect(await ask("Micro850 Programmable Controllers User Manual", "2080-um002.pdf", null)).toEqual([]);
    expect(await ask("Micro850 Programmable Controllers User Manual", "2080-um002.pdf", "  ")).toEqual([]);
  });

  it("control: the no-model-manual lenience is untouched by the vendor tie", async () => {
    expect(await ask("Controller Manual", "manual.pdf", null)).toHaveLength(1);
    expect(await ask("Controller Manual", "manual.pdf", "ABB")).toHaveLength(1);
  });

  it("control: a sibling with DIFFERENT digits in the right family is still rejected (round-1 rule stands)", async () => {
    expect(await ask("Micro810 Programmable Controllers User Manual", "2080-um001.pdf", "Allen-Bradley")).toEqual([]);
  });
});
