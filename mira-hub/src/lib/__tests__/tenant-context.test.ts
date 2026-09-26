import { beforeEach, describe, expect, it, vi } from "vitest";
const pool = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("@/lib/db", () => ({ default: pool }));
import { withTenantContext } from "../tenant-context";
import { recordLookObservation } from "../visual-evidence-context";
const timeout = () => new Error("Connection terminated due to connection timeout");
beforeEach(() => vi.resetAllMocks());
describe("tenant connection acquisition retry", () => {
  it("retries the opted-in timeout before BEGIN and runs the callback once", async () => {
    const client = { query: vi.fn(async (_sql: string) => ({ rows: [] })), release: vi.fn() };
    pool.connect.mockRejectedValueOnce(timeout()).mockResolvedValueOnce(client);
    const callback = vi.fn(async () => "saved");
    await expect(withTenantContext("tenant", callback, { retryConnectionTimeout: true })).resolves.toBe("saved");
    expect(pool.connect).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls.map(c => c[0])).toEqual(["BEGIN", "SET LOCAL ROLE factorylm_app", "SELECT set_config('app.tenant_id', $1, true)", "SELECT set_config('app.current_tenant_id', $1, true)", "COMMIT"]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
  it("recovers the real LOOK ledger writer without repeating its three inserts", async () => {
    const client = { query: vi.fn(async (_sql: string) => ({ rows: [{ id: "record-id" }] })), release: vi.fn() };
    pool.connect.mockRejectedValueOnce(timeout()).mockResolvedValueOnce(client);
    await expect(recordLookObservation({ tenantId: "tenant", notebookId: "notebook", fileId: "file", photoHash: "hash", text: "Visible label", model: "model", capturedAt: "2026-09-26T00:00:00Z", createdBy: "user" })).resolves.toEqual({ sessionId: "record-id", evidenceId: "record-id", observationId: "record-id" });
    expect(pool.connect).toHaveBeenCalledTimes(2);
    expect(client.query.mock.calls.filter(([sql]) => sql.includes("INSERT INTO"))).toHaveLength(3);
    expect(client.query.mock.calls.filter(([sql]) => sql === "COMMIT")).toHaveLength(1);
  });

  it("bounds persistent acquisition failure at two attempts without running work", async () => {
    pool.connect.mockRejectedValue(timeout());const callback = vi.fn();
    await expect(withTenantContext("tenant", callback, { retryConnectionTimeout: true })).rejects.toThrow("connection timeout");
    expect(pool.connect).toHaveBeenCalledTimes(2);expect(callback).not.toHaveBeenCalled();
  });
  it("preserves existing callers' single-attempt behavior", async () => {
    pool.connect.mockRejectedValue(timeout());
    await expect(withTenantContext("tenant", vi.fn())).rejects.toThrow();
    expect(pool.connect).toHaveBeenCalledTimes(1);
  });
  it("does not retry a permanent connection error", async () => {
    pool.connect.mockRejectedValue(new Error("password authentication failed"));
    await expect(withTenantContext("tenant", vi.fn(), { retryConnectionTimeout: true })).rejects.toThrow("authentication");
    expect(pool.connect).toHaveBeenCalledTimes(1);
  });
  for (const failAt of ["BEGIN", "COMMIT", "callback"]) {
    it(`never replays work after ${failAt} fails`, async () => {
      const client = { query: vi.fn(async (sql: string) => { if(sql === failAt) throw timeout(); return { rows: [] }; }), release: vi.fn() };
      pool.connect.mockResolvedValue(client);
      const callback = vi.fn(async () => { if(failAt === "callback") throw timeout(); return "saved"; });
      await expect(withTenantContext("tenant", callback, { retryConnectionTimeout: true })).rejects.toThrow("connection timeout");
      expect(pool.connect).toHaveBeenCalledTimes(1);expect(callback.mock.calls.length).toBe(failAt === "BEGIN" ? 0 : 1);expect(client.release).toHaveBeenCalledTimes(1);
    });
  }
});
