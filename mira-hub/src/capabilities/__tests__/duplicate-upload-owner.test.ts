import { beforeEach, describe, expect, it, vi } from "vitest";

// #4420 Codex r1 F1: a re-upload of identical bytes is marked
// "duplicate of <id>" and writes no chunks of its own (local-upload.ts). When
// findDuplicateUpload could pick such a row, a third upload chained to the
// second — a document with no chunks — and onboarding's chat scoped to it
// answered 404. The lookup must only ever name an upload that owns chunks.
// Real-SQL proof of the chain: duplicate-upload-owner.integration.test.ts.

const queryMock = vi.fn();
vi.mock("@/lib/db", () => ({ default: { query: (...a: unknown[]) => queryMock(...a) } }));

import { findDuplicateUpload } from "@/lib/uploads";

const SHA = "b".repeat(64);
const NODE = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockImplementation(async (sql: string) => {
    if (sql.includes("information_schema.columns")) return { rows: [{ "?column?": 1 }] };
    return { rows: [] };
  });
});

describe("findDuplicateUpload — only a chunk-owning upload can be the original", () => {
  it("excludes rows that are themselves duplicates", async () => {
    await findDuplicateUpload("t-1", SHA, NODE);
    const sel = queryMock.mock.calls.find((c) => String(c[0]).includes("content_sha256 = $2"));
    expect(sel, "the duplicate lookup query ran").toBeDefined();
    expect(String(sel![0])).toContain("(status_detail IS NULL OR status_detail NOT LIKE 'duplicate of %')");
    expect(sel![1]).toEqual(["t-1", SHA, NODE]);
  });
});
