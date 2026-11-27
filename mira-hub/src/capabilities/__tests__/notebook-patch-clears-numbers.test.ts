/**
 * #6085 round-3 pre-screen 2: a notebook PATCH that writes the identity status or source by hand
 * empties the ticked numbers, after its write, on the same client, under a savepoint
 * (`updateNotebook` -> `clearConfirmedNumbers`). Only the identity card adds a number.
 *
 * Lives outside src/lib/__tests__ on purpose: that tree is a guarded path. The real-Postgres twins
 * are in confirmed-numbers.integration.test.ts.
 *
 * Run: npx vitest run src/capabilities/__tests__/notebook-patch-clears-numbers.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { sql: string; params: unknown[] };
const calls: Call[] = [];
const rowsByMatch: Array<{ re: RegExp; rows: Record<string, unknown>[] }> = [];

function client() {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const hit = rowsByMatch.find((m) => m.re.test(sql));
      return { rows: hit ? hit.rows : [], rowCount: hit ? hit.rows.length : 0 };
    }),
  };
}

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn(client())),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));

import { updateNotebook } from "@/lib/equipment-notebooks";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const head = (c: Call) => c.sql.trim().split(/\s+/).slice(0, 2).join(" ");

describe("updateNotebook and the ticked numbers", () => {
  beforeEach(() => {
    calls.length = 0;
    rowsByMatch.length = 0;
    rowsByMatch.push({ re: /UPDATE equipment_notebooks/, rows: [{}] });
  });

  it("an identity status or source written by hand empties the ticked numbers after the write, under a savepoint", async () => {
    for (const patch of [{ identityStatus: "user_confirmed" as const }, { identitySourceType: "user" as const }]) {
      calls.length = 0;
      expect(await updateNotebook(TENANT, NB, patch)).toBe(true);
      expect(calls.map(head)).toEqual(["UPDATE equipment_notebooks", "SAVEPOINT confirmed_number", "UPDATE equipment_notebooks", "RELEASE SAVEPOINT"]);
      expect(calls[0]!.sql).not.toMatch(/confirmed_numbers/); // the identity write itself is unchanged
      expect(calls[2]!.sql).toMatch(/SET confirmed_numbers = '\[\]'::jsonb WHERE tenant_id = \$1::uuid AND id = \$2::uuid/);
      expect(calls[2]!.params).toEqual([TENANT, NB]);
    }
  });

  it("control: a patch naming no identity status or source, or matching no row, leaves the numbers alone", async () => {
    for (const patch of [{ model: "PowerFlex 525" }, { displayName: "Line 3 drive" }, { catalogNumber: "25B-D2P3N104" }]) {
      calls.length = 0;
      expect(await updateNotebook(TENANT, NB, patch)).toBe(true);
      expect(calls.length).toBeGreaterThan(0); // precondition: the write ran
      expect(calls.some((c) => /confirmed_numbers|SAVEPOINT/.test(c.sql))).toBe(false);
    }
    rowsByMatch.length = 0;
    calls.length = 0;
    expect(await updateNotebook(TENANT, NB, { identityStatus: "user_confirmed" })).toBe(false);
    expect(calls.map(head)).toEqual(["UPDATE equipment_notebooks"]);
  });
});
