/**
 * resolveBoundAsset: a notebook made from a registered machine carries that
 * machine's maker and model (asset register) for the wrong-manual check.
 * Database stand-in only — the real statement was run as the app role against
 * a local copy of staging's table layout on 2026-11-10 (PR text has the output).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const MACHINE = "b95a0305-7671-48a6-b300-f2883df977a4";

type Reply = { rows: Record<string, unknown>[] } | Error;
const script = vi.hoisted(() => ({
  notebook: { rows: [] } as Reply,
  entity: { rows: [] } as Reply,
  register: { rows: [] } as Reply,
  calls: [] as Array<{ sql: string; params: unknown[] }>,
}));

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_tenant: string, fn: (c: unknown) => unknown) =>
    fn({
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        script.calls.push({ sql, params });
        const reply = /FROM cmms_equipment/.test(sql) ? script.register
          : /FROM kg_entities/.test(sql) ? script.entity
          : /FROM equipment_notebooks/.test(sql) ? script.notebook
          : { rows: [] };
        if (reply instanceof Error) throw reply;
        return reply;
      }),
    }),
  ),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));

import { resolveBoundAsset } from "@/lib/equipment-notebooks";

beforeEach(() => {
  script.calls = [];
  script.notebook = { rows: [{ equipment_entity_id: MACHINE, asset_selected_via: "asset_picker", asset_confirmed_at: "2026-11-10T07:40:00.000Z" }] };
  script.entity = { rows: [{ bind_key: MACHINE, name: "CV-101 bench PLC", uns_path: "enterprise.garage.cv_101.plc" }] };
  script.register = { rows: [{ manufacturer: "Allen-Bradley", model_number: " 2080-LC20-20QBB " }] };
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("resolveBoundAsset — the registered machine's maker and model", () => {
  it("returns them, trimmed, read by the bound key and the caller's tenant as text", async () => {
    const got = await resolveBoundAsset(TENANT, NB);
    expect(got).toMatchObject({ state: "resolved", entityId: MACHINE, manufacturer: "Allen-Bradley", model: "2080-LC20-20QBB" });
    const read = script.calls.find((c) => /FROM cmms_equipment/.test(c.sql))!;
    expect(read.sql).toMatch(/WHERE tenant_id = \$1::text AND id::text = \$2/);
    expect(read.params).toEqual([TENANT, MACHINE]);
  });

  it("a machine with no register row (made in the namespace) has neither", async () => {
    script.register = { rows: [] };
    expect(await resolveBoundAsset(TENANT, NB)).toMatchObject({ state: "resolved", manufacturer: null, model: null });
  });

  it("blank register values are not an identity", async () => {
    script.register = { rows: [{ manufacturer: "  ", model_number: null }] };
    expect(await resolveBoundAsset(TENANT, NB)).toMatchObject({ state: "resolved", manufacturer: null, model: null });
  });

  it("a failed register read keeps the binding resolved, with no maker or model, and rolls back to its savepoint", async () => {
    script.register = new Error("permission denied for table cmms_equipment");
    const got = await resolveBoundAsset(TENANT, NB);
    expect(got).toMatchObject({ state: "resolved", entityId: MACHINE, manufacturer: null, model: null });
    const sqls = script.calls.map((c) => c.sql);
    expect(sqls).toContain("SAVEPOINT bound_machine_identity");
    expect(sqls).toContain("ROLLBACK TO SAVEPOINT bound_machine_identity");
  });

  it("an unbound notebook and an unresolvable machine never read the register", async () => {
    script.notebook = { rows: [{ equipment_entity_id: null }] };
    expect(await resolveBoundAsset(TENANT, NB)).toEqual({ state: "unbound" });
    script.notebook = { rows: [{ equipment_entity_id: MACHINE }] };
    script.entity = { rows: [] };
    expect(await resolveBoundAsset(TENANT, NB)).toEqual({ state: "unresolvable", entityId: MACHINE });
    expect(script.calls.some((c) => /FROM cmms_equipment/.test(c.sql))).toBe(false);
  });
});
