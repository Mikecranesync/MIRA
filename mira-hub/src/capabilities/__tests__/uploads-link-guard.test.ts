import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Review of #4091, F2: an upload deleted after ingest but before the file is
 * linked must not be linked — a dangling upload_id makes later re-uploads of
 * the same bytes skip indexing. Linking and notebook-source sync hold the
 * upload row (same lock order as delete) and refuse when it is gone.
 * F1's dedup half: only an upload that owns its chunks can be an original.
 */

const { state } = vi.hoisted(() => ({
  state: { uploadExists: true, calls: [] as string[] },
}));

const client = {
  query: vi.fn(async (sql: string) => {
    state.calls.push(sql.replace(/\s+/g, " ").trim());
    if (/FROM hub_uploads[\s\S]*FOR SHARE/.test(sql)) return { rowCount: state.uploadExists ? 1 : 0, rows: [] };
    if (/UPDATE namespace_direct_uploads/.test(sql)) return { rowCount: 1, rows: [] };
    if (/FROM workspace_file_links/.test(sql)) return { rowCount: 1, rows: [{ target_id: "nb-1", role: null }] };
    return { rowCount: 1, rows: [] };
  }),
  release: vi.fn(),
};

vi.mock("@/lib/db", () => ({
  default: {
    connect: vi.fn(async () => client),
    query: vi.fn(async (sql: string) => {
      state.calls.push(sql.replace(/\s+/g, " ").trim());
      return { rowCount: 1, rows: [{}] };
    }),
  },
}));

import { linkFileToUpload, syncNotebookSourcesForFile } from "@/lib/workspace-files";
import { findDuplicateUpload } from "@/lib/uploads";

beforeEach(() => {
  state.uploadExists = true;
  state.calls.length = 0;
});

const T = "11111111-1111-4111-8111-111111111111";
const F = "22222222-2222-4222-8222-222222222222";
const U = "55555555-5555-4555-8555-555555555555";

describe("linking an indexed upload to its canonical file", () => {
  it("links when the upload still exists, holding its row first", async () => {
    await expect(linkFileToUpload(T, F, U)).resolves.toBe(true);
    const lock = state.calls.findIndex((x) => /FROM hub_uploads WHERE id = \$1 AND tenant_id = \$2 FOR SHARE/.test(x));
    const update = state.calls.findIndex((x) => x.startsWith("UPDATE namespace_direct_uploads"));
    expect(lock).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(lock);
  });

  it("refuses when the upload was deleted — no dangling upload_id is written", async () => {
    state.uploadExists = false;
    await expect(linkFileToUpload(T, F, U)).resolves.toBe(false);
    expect(state.calls.some((x) => x.startsWith("UPDATE namespace_direct_uploads"))).toBe(false);
  });

  it("notebook-source sync for a deleted upload adds no membership", async () => {
    state.uploadExists = false;
    await expect(syncNotebookSourcesForFile(T, F, U)).resolves.toBe(0);
    expect(state.calls.some((x) => /INSERT INTO equipment_notebook_sources/.test(x))).toBe(false);
  });
});

describe("findDuplicateUpload never matches a chunkless duplicate", () => {
  it("excludes rows marked 'duplicate of'", async () => {
    await findDuplicateUpload(T, "a".repeat(64), "n-1");
    const sel = state.calls.find((x) => x.includes("content_sha256 = $2"));
    expect(sel).toMatch(/status_detail NOT LIKE 'duplicate of %'/);
  });
});
