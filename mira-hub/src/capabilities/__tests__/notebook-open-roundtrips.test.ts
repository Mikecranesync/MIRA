/**
 * #4130 — getNotebook reads the notebook and touches last_opened_at in ONE
 * statement (a data-modifying CTE), not a SELECT followed by an UPDATE. Every
 * notebook route and both chat-path ownership/context loads pay this, so the
 * statement count is pinned here with a recording client. The snapshot
 * semantics (row returned as it was before the touch; foreign id touches
 * nothing) are proven against real Postgres in
 * notebook-open-touch.integration.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as { text: string; params?: unknown[] }[]);
const rows = vi.hoisted(() => ({ value: [] as Record<string, unknown>[] }));
const client = vi.hoisted(() => ({
  query: vi.fn(async (text: string, params?: unknown[]) => {
    calls.push({ text, params });
    return { rows: /WITH touched AS/.test(text) || /^\s*SELECT/.test(text) ? rows.value : [] };
  }),
  release: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ default: { connect: vi.fn(async () => client) } }));

import { getNotebook } from "@/lib/equipment-notebooks";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";

// The route-level work between the tenant preamble and COMMIT.
function bodyStatements() {
  return calls
    .map((c) => c.text)
    .filter((t) => !/^BEGIN|^SELECT set_config|^COMMIT$|^ROLLBACK$/.test(t));
}

beforeEach(() => {
  calls.length = 0;
  rows.value = [];
});

describe("getNotebook round trips (#4130)", () => {
  it("reads and touches the notebook in a single statement", async () => {
    rows.value = [{ id: NB, tenant_id: TENANT, display_name: "Conveyor", last_opened_at: null }];
    const nb = await getNotebook(TENANT, NB);
    expect(nb?.id).toBe(NB);
    const body = bodyStatements();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatch(/WITH touched AS \(\s*UPDATE equipment_notebooks SET last_opened_at = now\(\)/);
    expect(body[0]).toMatch(/WHERE tenant_id = \$1::uuid AND id = \$2::uuid/);
    expect(calls.find((c) => c.text === body[0])?.params).toEqual([TENANT, NB]);
  });

  it("a missing or foreign notebook is still one statement and returns null", async () => {
    rows.value = [];
    expect(await getNotebook(TENANT, NB)).toBeNull();
    expect(bodyStatements()).toHaveLength(1);
  });
});
