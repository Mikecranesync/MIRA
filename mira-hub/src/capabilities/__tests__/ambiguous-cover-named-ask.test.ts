/**
 * #4511 — Release 1 regression found by the Lane A replay of the real 2026-10-17
 * questions on staging (99617cc7f): the Rockwell Micro810 user manual
 * (2080-UM001) was REJECTED for every question that named "Micro810", while
 * the one question naming no model answered with citations.
 *
 * The Hub stores that manual's cover as
 *   "User Manual Original Instructions\nMicro810 Programmable\nControllers\n
 *    Catalog Numbers 2080-LC10-12AWA, 2080-LC10-12QWB, …"
 * — a generic first line, the model on line two. #4484 r3 F6 taught the
 * NOTEBOOK-scoped branch to resolve such an ambiguous cover against what its
 * heading declares (`ambiguousCoverIdentities`), but the QUESTION-scoped branch
 * kept reading `affirmativeModelIdentities`, which returns an empty set for an
 * ambiguous cover, and a named ask rejects on an empty set. Traces:
 * a777ebc16adb6c61b27200ff597ef103, 4e7371c3bb4523432455fba2340e4756.
 *
 * Lives under capabilities/__tests__ (ungated). Run:
 *   npx vitest run src/capabilities/__tests__/ambiguous-cover-named-ask.test.ts
 */
import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { retrieveNodeChunks } from "../../lib/manual-rag";

function clientWith(row: Record<string, unknown>): PoolClient {
  const query = vi.fn(async () => ({ rows: [row] }));
  return { query } as unknown as PoolClient;
}

const STORED_MICRO810_COVER =
  "User Manual Original Instructions\nMicro810 Programmable\nControllers\n" +
  "Catalog Numbers 2080-LC10-12AWA, 2080-LC10-12QWB,\n2080-LC10-12QBB, 2080-LC10-12DWD";

const row = (heading: string) => ({
  content: "The controller accepts 24V DC or 120/240V AC depending on catalog number.",
  source_url: "node-doc/u1/oem-manual-micro810.pdf",
  source_page: 23,
  page_start: 23,
  section_path: null,
  filename: "oem-manual-micro810.pdf",
  document_heading: heading,
  rank: 0.4,
});

const ask = (heading: string, question: string, identityStatus = "unknown") =>
  retrieveNodeChunks(clientWith(row(heading)), "t-1", question, {
    nodeId: "n-1",
    unsPath: null,
    docIds: ["d-1"],
    validatedDocScope: true,
    identity: { manufacturer: "Rockwell Automation", model: "Micro810 2080-LC10-12QWB" },
    identityStatus: identityStatus as never,
  });

describe("#4511 — an ambiguous cover that declares the asked model is that model's manual", () => {
  it("the real stored Micro810 cover is admitted for a Micro810-named question (the prod miss)", async () => {
    expect(await ask(STORED_MICRO810_COVER, "What supply voltage does the Micro810 use?")).toHaveLength(1);
    expect(await ask(STORED_MICRO810_COVER, "What is the operating temperature range of the Micro810")).toHaveLength(1);
  });

  it("…whatever the generic opener is, and with the identity confirmed too", async () => {
    expect(await ask("User Manual\nMicro810 Programmable Controllers", "What supply voltage does the Micro810 use?")).toHaveLength(1);
    expect(
      await ask("User Manual Original Instructions\nMicro810 Programmable\nControllers", "Micro810 supply voltage?", "user_confirmed"),
    ).toHaveLength(1);
  });

  it("control: the same cover is still rejected when the question names a SIBLING (r3 F6 stands)", async () => {
    expect(await ask(STORED_MICRO810_COVER, "What supply voltage does the Micro820 use")).toEqual([]);
    expect(await ask("User Manual\nMicro810 Programmable Controllers", "Max embedded I/O on a Micro820?")).toEqual([]);
  });

  it("control: a generic opener followed by PROSE about a model still declares nothing (r5 F6 stands)", async () => {
    expect(await ask("User Manual\nMicro810 is not covered by this manual.", "What supply voltage does the Micro810 use?")).toEqual([]);
    expect(await ask("User Manual\nFor Micro810 see the separate user manual.", "What supply voltage does the Micro810 use?")).toEqual([]);
  });

  it("control: a one-line title and a no-model question were never affected", async () => {
    expect(await ask("Micro810 Programmable Controllers User Manual", "What supply voltage does the Micro810 use?")).toHaveLength(1);
    expect(await ask(STORED_MICRO810_COVER, "?And the max current?")).toHaveLength(1);
  });
});
