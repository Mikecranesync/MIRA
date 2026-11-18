import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

const { testPool } = vi.hoisted(() => {
  if (!process.env.TEST_DATABASE_URL || process.env.MIRA_TEST_DB_CONFIRM !== "DISPOSABLE") {
    throw new Error("Required disposable TEST_DATABASE_URL and MIRA_TEST_DB_CONFIRM=DISPOSABLE are missing");
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: testPool }));
import { withTenantContext } from "@/lib/tenant-context";

describe("equipment browser transaction boundary (actual PostgreSQL)", () => {
  const tenant = randomUUID();
  beforeAll(async () => { await testPool.query("SELECT 1"); });
  afterAll(async () => { await testPool.end(); });

  it("aborts before acquiring a connection without running the callback", async () => {
    const controller = new AbortController(); controller.abort();
    let ran = false;
    await expect(withTenantContext(tenant, async () => { ran = true; }, { signal: controller.signal, readOnly: true }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(ran).toBe(false);
  });

  it("read-only callbacks cannot change durable data and retain the restricted role and both tenant keys", async () => {
    await expect(withTenantContext(tenant, async (client) => {
      const { rows } = await client.query("SELECT current_user AS role, current_setting('app.tenant_id') AS a, current_setting('app.current_tenant_id') AS b");
      expect(rows[0]).toEqual({ role: "factorylm_app", a: tenant, b: tenant });
      await client.query("UPDATE equipment_notebooks SET display_name = 'must never write' WHERE tenant_id = $1", [tenant]);
    }, { readOnly: true })).rejects.toMatchObject({ code: "25006" });
  });

  it("read-only authorization and results share a repeatable-read transaction snapshot", async () => {
    const result=await withTenantContext(tenant,async (client)=>(await client.query("SHOW transaction_isolation")).rows[0].transaction_isolation,{readOnly:true});
    expect(result).toBe("repeatable read");
  });
});
