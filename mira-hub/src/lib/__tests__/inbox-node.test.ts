import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the tenant RLS wrapper to invoke the callback with a scripted client.
const queryMock = vi.fn();
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: async (_tenantId: string, fn: (c: { query: typeof queryMock }) => unknown) =>
    fn({ query: queryMock }),
}));

import { resolveOrCreateInboxNode, INBOX_UNS_PATH } from "../inbox-node";

beforeEach(() => {
  queryMock.mockReset();
});

describe("resolveOrCreateInboxNode", () => {
  it("returns the existing Inbox node without inserting", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: "node-existing" }] });

    const out = await resolveOrCreateInboxNode("tenant-1");

    expect(out).toEqual({ nodeId: "node-existing", unsPath: INBOX_UNS_PATH });
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][0]).toContain("SELECT id::text AS id");
  });

  it("creates the Inbox node when none exists", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // SELECT — none yet
      .mockResolvedValueOnce({ rows: [{ id: "node-new" }] }); // INSERT

    const out = await resolveOrCreateInboxNode("tenant-1");

    expect(out).toEqual({ nodeId: "node-new", unsPath: INBOX_UNS_PATH });
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(queryMock.mock.calls[1][0]).toContain("INSERT INTO kg_entities");
    // Inserted as a non-reserved 'inbox' ltree label under the tenant.
    expect(queryMock.mock.calls[1][1]).toEqual(["tenant-1", INBOX_UNS_PATH]);
  });

  it("recovers from a concurrent-create race by re-selecting", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // SELECT — none yet
      .mockRejectedValueOnce(new Error("duplicate key value")) // INSERT — lost the race
      .mockResolvedValueOnce({ rows: [{ id: "node-raced" }] }); // re-SELECT — found it

    const out = await resolveOrCreateInboxNode("tenant-1");

    expect(out).toEqual({ nodeId: "node-raced", unsPath: INBOX_UNS_PATH });
    expect(queryMock).toHaveBeenCalledTimes(3);
  });

  it("rethrows when the insert fails and re-select still finds nothing", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // SELECT — none
      .mockRejectedValueOnce(new Error("kg_entities boom")) // INSERT — real failure
      .mockResolvedValueOnce({ rows: [] }); // re-SELECT — still none

    await expect(resolveOrCreateInboxNode("tenant-1")).rejects.toThrow("kg_entities boom");
  });
});
