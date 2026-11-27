// #6085: storage for the numbers the technician confirmed. Unit level: the SQL a call sends and
// the fail-closed read. The real behaviour (idempotent append, tenant isolation) is proven in
// confirmed-numbers.integration.test.ts.
//
// Run: cd mira-hub && npx vitest run src/capabilities/__tests__/confirmed-numbers.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query })),
}));

import { numbersForIdentity, readConfirmedNumbers, saveConfirmedNumber, type ConfirmedNumberEntry } from "@/capabilities/confirmed-numbers";

const TENANT = "6085c000-0000-4000-8000-0000000000a1";
const NB = "6085c000-0000-4000-8000-0000000000a2";
const entry = (number: string, manufacturer = "Siemens", model = "TP700"): ConfirmedNumberEntry =>
  ({ number, manufacturer, model, confirmedAt: "2026-11-27T00:00:00.000Z" });

beforeEach(() => { query.mockReset(); vi.spyOn(console, "warn").mockImplementation(() => {}); });

describe("numbersForIdentity", () => {
  it("returns numbers saved for this maker and model", () => {
    expect(numbersForIdentity([entry("6AV2124-0GC01-0AX0")], { manufacturer: "Siemens", model: "TP700" })).toEqual(["6AV2124-0GC01-0AX0"]);
  });
  it("matches the maker through its vendor group and the model in any spacing", () => {
    expect(numbersForIdentity([entry("6AV2124-0GC01-0AX0", "SIEMENS", "tp 700")], { manufacturer: "Siemens", model: "TP700" })).toEqual(["6AV2124-0GC01-0AX0"]);
    // Allen-Bradley is a Rockwell Automation brand (manufacturerNormalize alias), not a spelling.
    expect(numbersForIdentity([entry("2080-LC20-20QBB", "Allen-Bradley", "Micro 820")], { manufacturer: "Rockwell Automation", model: "Micro820" })).toEqual(["2080-LC20-20QBB"]);
  });
  // Review Focus 4: the notebook was re-identified; the old number no longer counts.
  it("ignores numbers saved for another identity", () => {
    expect(numbersForIdentity([entry("6AV2124-0GC01-0AX0", "Siemens", "TP700")], { manufacturer: "Siemens", model: "TP900" })).toEqual([]);
    expect(numbersForIdentity([entry("6AV2124-0GC01-0AX0", "ABB", "TP700")], { manufacturer: "Siemens", model: "TP700" })).toEqual([]);
  });
  it("returns nothing without a maker or a model", () => {
    expect(numbersForIdentity([entry("6AV2124-0GC01-0AX0")], { manufacturer: null, model: "TP700" })).toEqual([]);
    expect(numbersForIdentity([entry("6AV2124-0GC01-0AX0")], { manufacturer: "Siemens", model: "" })).toEqual([]);
  });
});

describe("readConfirmedNumbers", () => {
  it("returns well-formed entries from the row", async () => {
    query.mockResolvedValue({ rows: [{ confirmed_numbers: [entry("6AV2124-0GC01-0AX0"), { number: 7 }, "x"] }] });
    expect(await readConfirmedNumbers(TENANT, NB)).toEqual([entry("6AV2124-0GC01-0AX0")]);
    expect(String(query.mock.calls[0]![0])).toMatch(/SELECT confirmed_numbers FROM equipment_notebooks WHERE tenant_id = \$1::uuid AND id = \$2::uuid/);
  });
  it("returns nothing for a missing row or a non-array value", async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await readConfirmedNumbers(TENANT, NB)).toEqual([]);
    query.mockResolvedValue({ rows: [{ confirmed_numbers: { number: "x" } }] });
    expect(await readConfirmedNumbers(TENANT, NB)).toEqual([]);
  });
  // A Hub deployed before the prod migration: the column does not exist yet.
  it("returns nothing, and logs, when the read fails", async () => {
    query.mockRejectedValue(new Error('column "confirmed_numbers" does not exist'));
    expect(await readConfirmedNumbers(TENANT, NB)).toEqual([]);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});

describe("saveConfirmedNumber", () => {
  it("sends one tenant-scoped append that skips a duplicate", async () => {
    query.mockResolvedValue({ rows: [{ id: NB }], rowCount: 1 });
    expect(await saveConfirmedNumber(TENANT, NB, { number: "6AV2124-0GC01-0AX0", manufacturer: "Siemens", model: "TP700" })).toBe(true);
    const [sql, values] = query.mock.calls[0]! as [string, unknown[]];
    expect(sql).toMatch(/UPDATE equipment_notebooks/);
    expect(sql).toMatch(/WHERE n\.tenant_id = \$1::uuid AND n\.id = \$2::uuid/);
    expect(sql).toMatch(/NOT EXISTS|WHEN EXISTS/);
    expect(sql).not.toMatch(/catalog_number|identity_status|manufacturer =|model =/);
    expect(values.slice(0, 6)).toEqual([TENANT, NB, "6AV2124-0GC01-0AX0", "Siemens", "TP700", "6AV21240GC010AX0"]);
  });
  it("is false when no row matched", async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await saveConfirmedNumber(TENANT, NB, { number: "6AV2124-0GC01-0AX0", manufacturer: "Siemens", model: "TP700" })).toBe(false);
  });
});
