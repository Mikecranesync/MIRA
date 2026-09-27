/**
 * insertFixRecord's replay decision (Codex #4057 post-hardening F2), with a
 * scripted database client. The SQL itself is proven on ephemeral postgres;
 * this pins the TypeScript that decides replay vs conflict vs binding change.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const queries = vi.hoisted(() => ({ results: [] as Array<{ rows: unknown[] }> }));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) =>
    fn({ query: vi.fn(async () => queries.results.shift() ?? { rows: [] }) }),
  ),
}));

import { insertFixRecord, requestFingerprint, type ValidatedFixInput } from "@/capabilities/fix-records";

const T = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const V: ValidatedFixInput = {
  symptom: "trips oC",
  fix: "raised accel",
  faultCode: "oC",
  sourceTurnId: null,
  clientRequestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};
const ROW = {
  id: "f1", notebook_id: NB, equipment_entity_id: "m1", symptom: "trips oC",
  fault_code: "oC", fix: "raised accel", recorded_by: "u1", created_at: "2026-09-27T00:00:00Z",
};

beforeEach(() => {
  queries.results = [];
});

describe("insertFixRecord replay decision", () => {
  it("creates when the insert returns a row", async () => {
    queries.results = [{ rows: [ROW] }];
    expect((await insertFixRecord(T, NB, "m1", V, "u1")).status).toBe("created");
  });

  it("replays the stored record only for an identical fingerprint", async () => {
    queries.results = [{ rows: [] }, { rows: [{ ...ROW, request_fingerprint: requestFingerprint(V, "m1") }] }];
    const r = await insertFixRecord(T, NB, "m1", V, "u1");
    expect(r.status).toBe("existing");
  });

  it("is a conflict when the same id carried different content", async () => {
    const other = { ...V, fix: "replaced the relay" };
    queries.results = [{ rows: [] }, { rows: [{ ...ROW, request_fingerprint: requestFingerprint(other, "m1") }] }];
    expect((await insertFixRecord(T, NB, "m1", V, "u1")).status).toBe("request_id_conflict");
  });

  it("is a conflict when the stored row has no fingerprint (pre-098)", async () => {
    queries.results = [{ rows: [] }, { rows: [{ ...ROW, request_fingerprint: null }] }];
    expect((await insertFixRecord(T, NB, "m1", V, "u1")).status).toBe("request_id_conflict");
  });

  it("is binding_changed when nothing was inserted and no prior record exists", async () => {
    queries.results = [{ rows: [] }, { rows: [] }];
    expect((await insertFixRecord(T, NB, "m1", V, "u1")).status).toBe("binding_changed");
  });
});
