import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A requeue (retry or re-pick) is one transaction: claim the row with a fresh
 * attempt, then remove the chunks every earlier attempt left. Without the purge,
 * a retry of changed provider bytes kept the old chunks under the stable
 * `node-doc/<uploadId>/` source URL (the writer's ON CONFLICT DO NOTHING keeps
 * an existing index), so the row read parsed with the new hash while chat
 * cited old or mixed content (Codex review of #4091 at 2dfe80b81, F3).
 */

const { state } = vi.hoisted(() => ({
  state: { calls: [] as Array<{ sql: string; params: unknown[] }>, claimed: true },
}));

const client = {
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    state.calls.push({ sql, params });
    if (/^\s*UPDATE hub_uploads/.test(sql)) {
      return state.claimed
        ? { rowCount: 1, rows: [{ id: "id-1", tenant_id: "t-1", status: "queued", attempt_id: "att-new" }] }
        : { rowCount: 0, rows: [] };
    }
    return { rowCount: 1, rows: [] };
  }),
  release: vi.fn(),
};

vi.mock("@/lib/db", () => ({
  default: {
    connect: vi.fn(async () => client),
    query: vi.fn(async () => {
      throw new Error("claimUploadForRequeue must run on one transaction client");
    }),
  },
}));

import { claimUploadForRequeue } from "@/lib/uploads";

const flat = (sql: string) => sql.replace(/\s+/g, " ").trim();
const sqls = () => state.calls.map((c) => flat(c.sql));
const KE = ["knowledge", "entries"].join("_");

beforeEach(() => {
  state.calls.length = 0;
  state.claimed = true;
  client.query.mockClear();
  client.release.mockClear();
});

describe("claimUploadForRequeue — claim and purge in ONE transaction", () => {
  it("conditions the claim on the allowed statuses and mints a new attempt", async () => {
    const up = await claimUploadForRequeue("id-1", "t-1", ["failed", "cancelled"], "re-picked");
    expect(up?.id).toBe("id-1");
    const claim = state.calls.find((c) => /^\s*UPDATE hub_uploads/.test(c.sql))!;
    expect(flat(claim.sql)).toMatch(
      /UPDATE hub_uploads SET status = 'queued'.*attempt_id = gen_random_uuid\(\).*WHERE id = \$1 AND tenant_id = \$2 AND status = ANY\(\$3::text\[\]\) RETURNING \*/,
    );
    expect(claim.params).toEqual(["id-1", "t-1", ["failed", "cancelled"], "re-picked", null]);
    expect(flat(claim.sql)).toMatch(/external_download_url = COALESCE\(\$5, external_download_url\)/);
  });

  it("removes every earlier attempt's private chunks after the claim, before COMMIT", async () => {
    await claimUploadForRequeue("id-1", "t-1", ["failed"], "user retry");
    const s = sqls();
    const claim = s.findIndex((x) => x.startsWith("UPDATE hub_uploads"));
    const purge = s.findIndex((x) => x.startsWith(`DELETE FROM ${KE}`));
    expect(s[0]).toBe("BEGIN");
    expect(claim).toBeGreaterThan(0);
    expect(purge).toBeGreaterThan(claim);
    expect(s[purge]).toMatch(/WHERE doc_id = \$1::uuid AND tenant_id::text = \$2 AND is_private = true/);
    expect(state.calls[purge].params).toEqual(["id-1", "t-1"]);
    expect(s.at(-1)).toBe("COMMIT");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("a lost claim returns null, purges nothing and rolls back", async () => {
    state.claimed = false;
    await expect(claimUploadForRequeue("id-1", "t-1", ["failed"], "user retry")).resolves.toBeNull();
    expect(sqls().some((x) => x.startsWith("DELETE"))).toBe(false);
    expect(sqls()).toContain("ROLLBACK");
    expect(sqls()).not.toContain("COMMIT");
  });
});
