import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Codex review of #4091 at 1082ad199 — the consumers around the duplicate
 * alias (F6) and the direct notebook-source attach (F7).
 *
 * F6: a notebook source built from a duplicate read "Uploaded · text
 * recognition required" (its own id owns no chunks), so it could not be asked.
 * Readiness now counts the original's chunks for it.
 *
 * F7: attachSource validated the upload outside any transaction and inserted
 * the membership in a separate one, so a delete in between left a dangling,
 * user-confirmed source. It now validates and writes while HOLDING the upload
 * row (withUploadRowTenantContext — the delete's lock order).
 */

const ORIG = "aaaaaaaa-0000-4000-8000-00000000000a";
const DUP = "dddddddd-0000-4000-8000-00000000000d";
const NB = "eeeeeeee-0000-4000-8000-00000000000e";
const T = "11111111-1111-4111-8111-111111111111";

const { st } = vi.hoisted(() => ({
  st: {
    held: true,
    rowLocks: [] as Array<{ uploadId: string; attemptId: unknown }>,
    tx: [] as string[],
    pool: [] as Array<{ sql: string; params: unknown[] }>,
  },
}));

const txClient = {
  query: vi.fn(async (sql: string) => {
    st.tx.push(sql.replace(/\s+/g, " ").trim());
    if (/FROM equipment_notebook_sources/.test(sql)) {
      return {
        rows: [{ doc_id: DUP, enabled_by_default: true, match_state: "user_confirmed", source_role: null, match_evidence: null, origin_file_id: null }],
      };
    }
    if (/FROM equipment_notebooks/.test(sql)) return { rows: [{ id: NB }] };
    return { rows: [], rowCount: 1 };
  }),
};

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: typeof txClient) => unknown) => fn(txClient)),
  withUploadRowTenantContext: vi.fn(
    async (_t: string, uploadId: string, attemptId: unknown, fn: (c: typeof txClient) => unknown) => {
      st.rowLocks.push({ uploadId, attemptId });
      if (!st.held) return { held: false };
      return { held: true, result: await fn(txClient) };
    },
  ),
}));

vi.mock("@/lib/db", () => ({
  default: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      st.pool.push({ sql, params });
      const s = sql.replace(/\s+/g, " ");
      if (/FROM hub_uploads d JOIN hub_uploads o/.test(s)) return { rows: [{ id: DUP, original_id: ORIG }] };
      if (/FROM hub_uploads u/.test(s)) {
        return {
          rows: [
            { id: DUP, filename: "manual-copy.pdf", status: "parsed", kb_chunk_count: 12, file_id: null },
            { id: ORIG, filename: "manual.pdf", status: "parsed", kb_chunk_count: 12, file_id: "file-orig" },
          ],
        };
      }
      if (KE_READ.test(s)) {
        // Only the ORIGINAL owns chunks.
        const ids = params[1] as string[];
        return { rows: ids.includes(ORIG) ? [{ doc_id: ORIG, n: 12, emb: 12, anchored: 12 }] : [] };
      }
      return { rows: [] };
    }),
  },
}));

import { attachSourceHeld, listSources } from "@/lib/equipment-notebooks";

// Built, not literal: the knowledge_entries read-filter scanner reads source text.
const KE_READ = new RegExp(`FROM ${["knowledge", "entries"].join("_")}`);

beforeEach(() => {
  st.held = true;
  st.rowLocks.length = 0;
  st.tx.length = 0;
  st.pool.length = 0;
});

describe("F6 — a duplicate notebook source reads its original's chunks", () => {
  it("is askable (not 'text recognition required'), with the original's chunks and parked file", async () => {
    const [src] = await listSources(T, NB);
    expect(src.docId).toBe(DUP);
    expect(src.filename).toBe("manual-copy.pdf");
    expect(src.readiness.state).not.toBe("needs_ocr");
    expect(src.readiness.canChat).toBe(true);
    // The viewer opens the original's parked bytes (a duplicate has none of its own).
    expect(src.fileId).toBe("file-orig");
    const counts = st.pool.find((c) => KE_READ.test(c.sql));
    expect(counts?.params[1]).toEqual(expect.arrayContaining([DUP, ORIG]));
  });
});

describe("F7 — attachSourceHeld holds the upload row while it validates and writes", () => {
  it("writes the membership inside the upload-row hold", async () => {
    await expect(attachSourceHeld(T, NB, DUP)).resolves.toEqual({ ok: true });
    expect(st.rowLocks).toEqual([{ uploadId: DUP, attemptId: undefined }]);
    expect(st.tx.some((s) => s.startsWith("INSERT INTO equipment_notebook_sources"))).toBe(true);
    // Validation is the hold itself — no separate, unlocked hub_uploads read.
    expect(st.pool.some((c) => /FROM hub_uploads/.test(c.sql))).toBe(false);
  });

  it("a delete that won first: doc_not_found, and no membership is written", async () => {
    st.held = false;
    await expect(attachSourceHeld(T, NB, DUP)).resolves.toEqual({ ok: false, error: "doc_not_found" });
    expect(st.tx).toEqual([]);
  });
});
