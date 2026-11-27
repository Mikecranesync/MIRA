// #6085: storage for the numbers the technician confirmed. Unit level: the SQL a call sends, in
// order, on one client, and the fail-closed read. The real behaviour (locking, races, idempotent
// append, tenant isolation, the savepoint) is proven in confirmed-numbers.integration.test.ts.
//
// Run: cd mira-hub && npx vitest run src/capabilities/__tests__/confirmed-numbers.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query })),
}));

import { numbersForIdentity, readConfirmedNumbers, recordConfirmedNumber, type ConfirmedNumberEntry } from "@/capabilities/confirmed-numbers";
import { confirmNotebookIdentity } from "@/capabilities/notebook-manual-acquisition";
import { withTenantContext } from "@/lib/tenant-context";

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

describe("recordConfirmedNumber (inside the confirm's transaction)", () => {
  const SAVE = { number: "6AV2124-0GC01-0AX0", code: "6AV21240GC010AX0", manufacturer: "Siemens", model: "TP700" };
  const client = { query };
  const sqlAt = (i: number) => String(query.mock.calls[i]![0]);
  const statements = () => query.mock.calls.map((c) => String(c[0]).split(/\s+/).slice(0, 2).join(" "));

  it("under its own savepoint, reads the row, then appends the entry with its code and touches nothing else", async () => {
    query.mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: [{ confirmed_numbers: [] }], rowCount: 1 }).mockResolvedValueOnce({ rows: [], rowCount: 1 }).mockResolvedValueOnce({});
    expect(await recordConfirmedNumber(client, TENANT, NB, SAVE, false)).toBe(true);
    expect(statements()).toEqual(["SAVEPOINT confirmed_number", "SELECT confirmed_numbers", "UPDATE equipment_notebooks", "RELEASE SAVEPOINT"]);
    expect(sqlAt(1)).toMatch(/SELECT confirmed_numbers FROM equipment_notebooks WHERE tenant_id = \$1::uuid AND id = \$2::uuid/);
    expect(query.mock.calls[1]![1]).toEqual([TENANT, NB]);
    const [sql, values] = query.mock.calls[2]! as [string, unknown[]];
    expect(sql).toMatch(/UPDATE equipment_notebooks SET confirmed_numbers = confirmed_numbers \|\| \$3::jsonb WHERE tenant_id = \$1::uuid AND id = \$2::uuid/);
    expect(sql).not.toMatch(/catalog_number|identity_status|updated_at/);
    expect(values.slice(0, 2)).toEqual([TENANT, NB]);
    expect(JSON.parse(values[2] as string)).toEqual([{ ...SAVE, confirmedAt: expect.any(String) }]);
  });

  // #6104 r1 F3: one number per machine.
  it("refuses a different number for a machine that has one, and writes nothing", async () => {
    query.mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: [{ confirmed_numbers: [{ ...entry("6AV2124-0JC01-0AX0"), code: "6AV21240JC010AX0" }] }], rowCount: 1 }).mockResolvedValueOnce({});
    expect(await recordConfirmedNumber(client, TENANT, NB, SAVE, false)).toBe(false);
    expect(statements()).toEqual(["SAVEPOINT confirmed_number", "SELECT confirmed_numbers", "RELEASE SAVEPOINT"]);
  });

  it("a retry of the saved number succeeds and writes nothing", async () => {
    query.mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: [{ confirmed_numbers: [{ ...entry("6av2124-0gc01-0ax0", "SIEMENS", "TP 700"), code: "6AV21240GC010AX0" }] }], rowCount: 1 }).mockResolvedValueOnce({});
    expect(await recordConfirmedNumber(client, TENANT, NB, SAVE, false)).toBe(true);
    expect(statements()).not.toContain("UPDATE equipment_notebooks");
  });

  // #6104 r2 F3: once the identity was settled before this confirm, no number is added.
  it("on an identity settled before this confirm, adds nothing", async () => {
    query.mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: [{ confirmed_numbers: [] }], rowCount: 1 }).mockResolvedValueOnce({});
    expect(await recordConfirmedNumber(client, TENANT, NB, SAVE, true)).toBe(false);
    expect(statements()).not.toContain("UPDATE equipment_notebooks");
  });

  it("on an identity settled before this confirm, a retry of the saved number is still a success", async () => {
    query.mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: [{ confirmed_numbers: [{ ...entry("6AV2124-0GC01-0AX0"), code: "6AV21240GC010AX0" }] }], rowCount: 1 }).mockResolvedValueOnce({});
    expect(await recordConfirmedNumber(client, TENANT, NB, SAVE, true)).toBe(true);
    expect(statements()).not.toContain("UPDATE equipment_notebooks");
  });

  // #6104 r1 F4: an entry without a code is one the scope cannot use, so it decides nothing.
  it("an entry without a code neither blocks nor stands in for the number", async () => {
    query.mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: [{ confirmed_numbers: [entry("6AV21240GC010AX0")] }], rowCount: 1 }).mockResolvedValueOnce({ rows: [], rowCount: 1 }).mockResolvedValueOnce({});
    expect(await recordConfirmedNumber(client, TENANT, NB, SAVE, false)).toBe(true);
    expect(statements()).toContain("UPDATE equipment_notebooks");
  });

  it("control: another machine's number does not block this one", async () => {
    query.mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: [{ confirmed_numbers: [{ ...entry("6AV2124-0JC01-0AX0", "Siemens", "TP900"), code: "6AV21240JC010AX0" }] }], rowCount: 1 }).mockResolvedValueOnce({ rows: [], rowCount: 1 }).mockResolvedValueOnce({});
    expect(await recordConfirmedNumber(client, TENANT, NB, SAVE, false)).toBe(true);
    expect(statements()).toContain("UPDATE equipment_notebooks");
  });

  it("is false when no row matched", async () => {
    query.mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: [], rowCount: 0 }).mockResolvedValueOnce({});
    expect(await recordConfirmedNumber(client, TENANT, NB, SAVE, false)).toBe(false);
    expect(statements()).not.toContain("UPDATE equipment_notebooks");
  });

  // A Hub deployed before the prod migration: the column does not exist yet. The failure is
  // rolled back to the savepoint and logged, never thrown, so the confirm still commits.
  it("a failed write rolls back to its savepoint, logs, and is false", async () => {
    query.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('column "confirmed_numbers" does not exist')).mockResolvedValueOnce({});
    expect(await recordConfirmedNumber(client, TENANT, NB, SAVE, false)).toBe(false);
    expect(statements()).toEqual(["SAVEPOINT confirmed_number", "SELECT confirmed_numbers", "ROLLBACK TO"]);
    expect(sqlAt(2)).toBe("ROLLBACK TO SAVEPOINT confirmed_number");
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});

// #6104 r2 F3/F4: the number is decided inside the identity confirm's own transaction, after the
// row lock and the identity write, on the same client.
describe("confirmNotebookIdentity with a ticked number", () => {
  const ID = { manufacturer: "Siemens", model: "TP700", catalogNumber: "" };
  const NUMBER = { number: "6AV2124-0GC01-0AX0", code: "6AV21240GC010AX0" };
  const statements = () => query.mock.calls.map((c) => String(c[0]).trim().split(/\s+/).slice(0, 2).join(" "));

  it("locks the row, writes the identity, then the number, in one transaction", async () => {
    vi.mocked(withTenantContext).mockClear();
    query
      .mockResolvedValueOnce({ rows: [{ settled: false }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: NB }], rowCount: 1 })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ confirmed_numbers: [] }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({});
    expect(await confirmNotebookIdentity(TENANT, NB, ID, NUMBER)).toEqual({ ok: true, numberSaved: true });
    expect(withTenantContext).toHaveBeenCalledTimes(1);
    expect(statements()).toEqual(["SELECT (n.identity_status", "UPDATE equipment_notebooks", "SAVEPOINT confirmed_number", "SELECT confirmed_numbers", "UPDATE equipment_notebooks", "RELEASE SAVEPOINT"]);
    expect(String(query.mock.calls[0]![0])).toMatch(/WHERE n\.tenant_id = \$1::uuid AND n\.id = \$2::uuid FOR UPDATE/);
    expect(query.mock.calls[0]![1]).toEqual([TENANT, NB]);
  });

  it("an identity settled before this confirm adds no number", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ settled: true }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: NB }], rowCount: 1 })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ confirmed_numbers: [] }], rowCount: 1 })
      .mockResolvedValueOnce({});
    expect(await confirmNotebookIdentity(TENANT, NB, ID, NUMBER)).toEqual({ ok: true, numberSaved: false });
    expect(statements().filter((s) => s === "UPDATE equipment_notebooks")).toHaveLength(1);
  });

  it("an unticked confirm sends only the identity write, as before", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: NB }], rowCount: 1 });
    expect(await confirmNotebookIdentity(TENANT, NB, ID)).toEqual({ ok: true });
    expect(statements()).toEqual(["UPDATE equipment_notebooks"]);
  });

  // #6104 r2 F4: a machine with a catalog number never reads ticked numbers.
  it("a confirm that writes a catalog number refuses the tick without touching the numbers", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: NB }], rowCount: 1 });
    expect(await confirmNotebookIdentity(TENANT, NB, { ...ID, catalogNumber: "6AV2124-0GC01-0AX0" }, NUMBER)).toEqual({ ok: true, numberSaved: false });
    expect(statements()).toEqual(["UPDATE equipment_notebooks"]);
  });

  it("a blocked confirm (another identity) writes no number", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ settled: true }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ manufacturer: "Siemens", model: "TP900" }], rowCount: 1 });
    expect(await confirmNotebookIdentity(TENANT, NB, ID, NUMBER)).toEqual({ ok: false, error: "identity_already_confirmed", manufacturer: "Siemens", model: "TP900" });
    expect(statements()).not.toContain("SAVEPOINT confirmed_number");
  });
});
