/**
 * Tests for `tools/investigator/run_cases.ts` (BENCH-A lane). See
 * `bench-openai-model.test.ts` for why these live here instead of under
 * `tools/investigator/`.
 *
 * `createBenchTools`'s `searchManual`/`lookupCode`/`lookupParameter` call the
 * real `retrieveNodeChunks` (needs a DB) and are NOT exercised here —
 * `drivePackLookup` needs only the in-memory `drivePacks` map, so it is
 * fully testable without a DB or network call.
 */
import { describe, expect, it } from "vitest";
import {
  createBenchTools,
  parseArgs,
  benchIdentity,
  resolveCaseTenant,
  type BenchCase,
  type DrivePackJson,
} from "../../../../../tools/investigator/run_cases";
import { tenantIdFor, docIdFor } from "../../../../../tools/investigator/ingest";

describe("parseArgs", () => {
  it("parses a full H1 invocation", () => {
    const cli = parseArgs(["H1", "cases.json", "out.jsonl", "--labels", "labels.json", "--ledger", "l.jsonl", "--cap", "2.5"]);
    expect(cli).toEqual({
      arm: "H1",
      casesPath: "cases.json",
      outPath: "out.jsonl",
      labelsPath: "labels.json",
      ledgerPath: "l.jsonl",
      capUsd: 2.5,
      noModel: false,
    });
  });

  it("--no-model runs H1/H2 with model = null", () => {
    expect(parseArgs(["H2", "c.json", "o.jsonl", "--cap", "0.01", "--no-model"]).noModel).toBe(true);
  });

  it("defaults ledgerPath to '<out>.ledger.jsonl' and labelsPath to null when omitted", () => {
    const cli = parseArgs(["H0", "cases.json", "out.jsonl", "--cap", "1"]);
    expect(cli.ledgerPath).toBe("out.jsonl.ledger.jsonl");
    expect(cli.labelsPath).toBeNull();
  });

  it("rejects an unknown arm", () => {
    expect(() => parseArgs(["H9", "cases.json", "out.jsonl", "--cap", "1"])).toThrow(/usage/);
  });

  it("requires --cap (the spend law: every paid lane declares a budget before it runs)", () => {
    expect(() => parseArgs(["H0", "cases.json", "out.jsonl"])).toThrow(/--cap/);
  });

  it("rejects a non-positive --cap", () => {
    expect(() => parseArgs(["H0", "cases.json", "out.jsonl", "--cap", "0"])).toThrow(/--cap/);
    expect(() => parseArgs(["H0", "cases.json", "out.jsonl", "--cap", "-1"])).toThrow(/--cap/);
  });
});

const FIXTURE_PACK: DrivePackJson = {
  pack_id: "fixture_pack",
  live_decode: { fault_codes: { "4": "GFF ground fault" } },
  parameters: [
    {
      parameter_id: "P01.00",
      name: "Maximum operation frequency",
      purpose: "The maximum output frequency the drive will command.",
      source_citation: { doc: "Fixture Manual", page: "4-8", excerpt: "P01.00 ... Range 0.00-599.0 Hz." },
    },
  ],
  provenance: { sources: [{ doc: "Fixture Manual", page: "", excerpt: "" }] },
};

describe("createBenchTools.drivePackLookup", () => {
  const tools = createBenchTools({
    db: {},
    tenantId: "t1",
    nodeId: "n1",
    docIds: [],
    drivePacks: new Map([["fixture_pack", FIXTURE_PACK]]),
  });

  it("returns a fault-code evidence item when the code exists in the pack", async () => {
    const items = await tools.drivePackLookup({ packId: "fixture_pack", code: "4" });
    expect(items).toHaveLength(1);
    expect(items[0].source).toBe("drive_pack");
    expect(items[0].text).toContain("GFF ground fault");
  });

  it("returns a parameter evidence item (with its page citation) when the parameter matches", async () => {
    const items = await tools.drivePackLookup({ packId: "fixture_pack", parameter: "P01.00" });
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Fixture Manual");
    expect(items[0].text).toContain("P01.00");
  });

  it("returns [] for an unknown pack id", async () => {
    const items = await tools.drivePackLookup({ packId: "no-such-pack", code: "4" });
    expect(items).toEqual([]);
  });

  it("returns [] when neither code nor parameter is given", async () => {
    const items = await tools.drivePackLookup({ packId: "fixture_pack" });
    expect(items).toEqual([]);
  });

  it("equipmentHistory/liveData always report unavailable (offline hard rule — never stubbed as data)", async () => {
    await expect(tools.equipmentHistory({ nodeId: "n1" })).resolves.toEqual({ status: "unavailable", items: [] });
    await expect(tools.liveData({ nodeId: "n1" })).resolves.toEqual({ status: "unavailable", items: [] });
  });
});

describe("resolveCaseTenant", () => {
  it("uses the case's explicit set when given", () => {
    const c: BenchCase = { id: "c1", set: "my-dev-set", manual: "gs10" };
    const { tenantId, docIds } = resolveCaseTenant(c, new Map());
    expect(tenantId).toBe(tenantIdFor("my-dev-set"));
    expect(docIds).toEqual([docIdFor("gs10")]);
  });

  it("uses the manual-tenant map when no set is given", () => {
    const map = new Map([["gs10", tenantIdFor("t4-77")]]);
    const c: BenchCase = { id: "c2", manual: "gs10" };
    const { tenantId, docIds } = resolveCaseTenant(c, map);
    expect(tenantId).toBe(tenantIdFor("t4-77"));
    expect(docIds).toEqual([docIdFor("gs10")]);
  });

  it('falls back to the "forum-fresh" tenant when the manual is in neither the case nor the map', () => {
    const c: BenchCase = { id: "c3", manual: "unknown-manual" };
    const { tenantId } = resolveCaseTenant(c, new Map());
    expect(tenantId).toBe(tenantIdFor("forum-fresh"));
  });
});

/**
 * MUTATION CHECK:
 *
 * Mutated `run_cases.ts`'s `parseArgs` by short-circuiting the `--cap`
 * requiredness check (`if (false && (capUsd === null || ...)) throw ...`).
 * Named tests that failed: "parseArgs > requires --cap (the spend law: every
 * paid lane declares a budget before it runs)" AND "parseArgs > rejects a
 * non-positive --cap" (both `expect(() => parseArgs(...)).toThrow()` calls
 * went from pass to fail — the calls that should have thrown returned a
 * `Cli` object instead). Restored the check and reran — both tests passed
 * again (confirmed via `npx vitest run` on this file, see session log).
 */

describe("benchIdentity", () => {
  it("gives a bench question row its manual's product as identity", () => {
    expect(benchIdentity({ id: "q1", set: "forum-fresh", manual: "pf40", question: "F004 on start" })).toEqual({
      manufacturer: "Allen-Bradley",
      model: "PowerFlex 40",
    });
  });

  it("leaves scenario cases (own equipment) and unknown manuals alone", () => {
    expect(benchIdentity({ id: "s1", set: "sc", manual: "pf40", message: "m", equipment: { model: "PowerFlex 525" } })).toBeNull();
    expect(benchIdentity({ id: "q2", set: "x", manual: "not-a-manual", question: "q" })).toBeNull();
  });
});
