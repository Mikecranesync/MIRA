import { describe, it, expect, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn(async () => ({ rows: [] as Record<string, unknown>[] })) }));
vi.mock("@/lib/db", () => ({ default: { query } }));

import { claimUploadForRequeue } from "@/lib/uploads";

describe("claimUploadForRequeue — check and transition in ONE statement", () => {
  it("conditions the UPDATE on the allowed statuses and returns null when it lost", async () => {
    await expect(claimUploadForRequeue("id-1", "t-1", ["failed", "cancelled"], "re-picked")).resolves.toBeNull();
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql.replace(/\s+/g, " ")).toMatch(
      /UPDATE hub_uploads SET status = 'queued'.*WHERE id = \$1 AND tenant_id = \$2 AND status = ANY\(\$3::text\[\]\) RETURNING \*/,
    );
    expect(params).toEqual(["id-1", "t-1", ["failed", "cancelled"], "re-picked"]);
  });
});
