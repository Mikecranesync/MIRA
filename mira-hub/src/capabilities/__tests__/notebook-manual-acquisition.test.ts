/**
 * #4075 — the background official-manual search for a confirmed identity.
 *
 * Run: npx vitest run src/capabilities/__tests__/notebook-manual-acquisition.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  queries: [] as { sql: string; params: unknown[] }[],
  claimRows: 1,
  readRow: null as unknown,
  failWith: null as null | { code: string },
}));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) =>
    fn({
      query: vi.fn(async (sql: string, params: unknown[]) => {
        db.queries.push({ sql, params });
        if (db.failWith) throw Object.assign(new Error("db"), db.failWith);
        if (/^\s*SELECT manual_acquisition/.test(sql)) return { rows: db.readRow ? [{ manual_acquisition: db.readRow }] : [] };
        if (/RETURNING id/.test(sql)) return { rowCount: db.claimRows, rows: db.claimRows ? [{ id: "nb" }] : [] };
        return { rowCount: 1, rows: [] };
      }),
    }),
  ),
}));
// The real pipeline is covered by the nameplate confirm tests; here it is a seam.
vi.mock("@/capabilities/manual-acquisition", () => ({ acquireManualForIdentity: vi.fn() }));

import {
  acquisitionDeclineText,
  acquisitionEnabled,
  acquisitionKey,
  readAcquisition,
  recordFromOutcome,
  startManualAcquisition,
  type AcquisitionRecord,
} from "../notebook-manual-acquisition";

const confirmed = { identityStatus: "user_confirmed", manufacturer: "SMC", model: "VQ1000-FPG-C6C6-D", catalogNumber: null };
const ON = { MIRA_NOTEBOOK_MANUAL_ACQUISITION: "1" };
const input = { tenantId: "t", userId: "u", notebookId: "nb", nodeId: "node", identity: confirmed };

beforeEach(() => {
  db.queries = [];
  db.claimRows = 1;
  db.readRow = null;
  db.failWith = null;
});

describe("acquisitionKey — only a technician-confirmed, searchable identity", () => {
  it("normalizes manufacturer|model|catalog", () => {
    expect(acquisitionKey(confirmed)).toBe("SMC|VQ1000FPGC6C6D|");
    expect(acquisitionKey({ ...confirmed, model: null, catalogNumber: "vq-1000" })).toBe("SMC||VQ1000");
  });
  it("refuses an unconfirmed identity, a missing manufacturer, or no model/catalog", () => {
    expect(acquisitionKey({ ...confirmed, identityStatus: "candidate" })).toBeNull();
    expect(acquisitionKey({ ...confirmed, identityStatus: "unknown" })).toBeNull();
    expect(acquisitionKey({ ...confirmed, manufacturer: "  " })).toBeNull();
    expect(acquisitionKey({ ...confirmed, model: "", catalogNumber: null })).toBeNull();
  });
});

describe("acquisitionEnabled — off unless explicitly '1'", () => {
  it.each([[{}, false], [{ MIRA_NOTEBOOK_MANUAL_ACQUISITION: "0" }, false], [{ MIRA_NOTEBOOK_MANUAL_ACQUISITION: "true" }, false], [ON, true]])(
    "%j → %s",
    (env, want) => expect(acquisitionEnabled(env as Record<string, string>)).toBe(want),
  );
});

describe("startManualAcquisition", () => {
  it("claims, runs the pipeline in the background with the CONFIRMED identity, and records the outcome", async () => {
    const acquire = vi.fn(async () => ({
      status: "candidate_review" as const,
      payload: { candidate: { host: "www.smcworld.com" }, manual: { matchState: "candidate" } },
    }));
    expect(await startManualAcquisition(input, { acquire, env: ON })).toBe(true);
    await vi.waitFor(() => expect(db.queries.some((q) => /jsonb_set/.test(q.sql))).toBe(true));
    expect(acquire).toHaveBeenCalledWith({
      tenantId: "t",
      userId: "u",
      notebookId: "nb",
      nodeId: "node",
      identity: { manufacturer: "SMC", model: "VQ1000-FPG-C6C6-D", catalogNumber: undefined },
      promoteVerified: expect.any(Function),
    });
    const claimQ = db.queries.find((q) => /RETURNING id/.test(q.sql))!;
    expect(claimQ.params).toEqual(["t", "nb", "SMC|VQ1000FPGC6C6D|", 10]);
    const finishQ = db.queries.find((q) => /jsonb_set/.test(q.sql))!;
    const rec = JSON.parse(finishQ.params[2] as string) as AcquisitionRecord;
    expect(rec).toMatchObject({ key: "SMC|VQ1000FPGC6C6D|", state: "candidate_review", candidate_host: "www.smcworld.com", match_state: "candidate" });
    // Only OUR claim is overwritten — a re-bind mid-search wins.
    expect(finishQ.params[3]).toBe("SMC|VQ1000FPGC6C6D|");
    expect(finishQ.sql).toMatch(/WHERE tenant_id = \$1 AND id = \$2 AND manual_acquisition->>'key' = \$4/);
    // The claim is keyed and stale-aware, so a second caller cannot double-start.
    expect(claimQ.sql).toMatch(/manual_acquisition->>'key' IS DISTINCT FROM \$3::text/);
    expect(claimQ.sql).toMatch(/manual_acquisition->>'state' = 'running'/);
  });

  it("does nothing when another caller already holds the claim", async () => {
    db.claimRows = 0;
    const acquire = vi.fn();
    expect(await startManualAcquisition(input, { acquire, env: ON })).toBe(false);
    expect(acquire).not.toHaveBeenCalled();
  });

  it("does nothing when disabled or the identity is not confirmed — and never touches the database", async () => {
    const acquire = vi.fn();
    expect(await startManualAcquisition(input, { acquire, env: {} })).toBe(false);
    expect(await startManualAcquisition({ ...input, identity: { ...confirmed, identityStatus: "candidate" } }, { acquire, env: ON })).toBe(false);
    expect(acquire).not.toHaveBeenCalled();
    expect(db.queries).toHaveLength(0);
  });

  it("fails open when the column does not exist yet (prod before migration 100)", async () => {
    db.failWith = { code: "42703" };
    const acquire = vi.fn();
    expect(await startManualAcquisition(input, { acquire, env: ON })).toBe(false);
    expect(acquire).not.toHaveBeenCalled();
    expect(await readAcquisition("t", "nb")).toBeNull();
  });

  it("a pipeline that throws is recorded as search_unavailable, never left 'running'", async () => {
    const acquire = vi.fn(async () => {
      throw new Error("boom");
    });
    await startManualAcquisition(input, { acquire, env: ON });
    await vi.waitFor(() => expect(db.queries.some((q) => /jsonb_set/.test(q.sql))).toBe(true));
    const rec = JSON.parse(db.queries.find((q) => /jsonb_set/.test(q.sql))!.params[2] as string);
    expect(rec.state).toBe("search_unavailable");
  });
});

describe("acquisitionDeclineText — honest about what the search did", () => {
  const rec = (over: Partial<AcquisitionRecord>): AcquisitionRecord => ({
    key: "K",
    state: "running",
    started_at: null,
    finished_at: null,
    candidate_host: null,
    match_state: null,
    oem_request_url: null,
    ...over,
  });
  it("running → still looking", () => {
    expect(acquisitionDeclineText(rec({}), "K", "SMC VQ1000")).toContain("looking for the official one now");
  });
  it("candidate ATTACHED and indexed → points to Sources, not turned on", () => {
    const t = acquisitionDeclineText(rec({ state: "candidate_review", candidate_host: "smcworld.com", attached_indexed: true }), "K", "SMC VQ1000")!;
    expect(t).toContain("possible manual");
    expect(t).toContain("smcworld.com");
    expect(t).toContain("isn't turned on");
    expect(t).toContain("Sources");
  });
  it("Codex #4118 F2: candidate NOT attached → never sends the technician to Sources; gives the URL", () => {
    const t = acquisitionDeclineText(
      rec({ state: "candidate_review", candidate_host: "smcworld.com", candidate_url: "https://smcworld.com/x.pdf", attached_indexed: false }),
      "K",
      "SMC VQ1000",
    )!;
    expect(t).not.toContain("Sources");
    expect(t).toContain("https://smcworld.com/x.pdf");
    expect(t).toContain("didn't add it");
  });
  it("complete → never claims this answer consulted the manual", () => {
    const t = acquisitionDeclineText(rec({ state: "complete" }), "K", "SMC VQ1000")!;
    expect(t).toContain("added it to this notebook's Sources");
    expect(t).toContain("ask again");
  });
  it("none found → says so, with the manufacturer's request link when known", () => {
    const t = acquisitionDeclineText(rec({ state: "no_manual_found", oem_request_url: "https://oem.example/request" }), "K", "SMC VQ1000")!;
    expect(t).toContain("couldn't find one");
    expect(t).toContain("https://oem.example/request");
  });
  it("adds nothing for a record about a different identity, or for outcomes with nothing to show", () => {
    expect(acquisitionDeclineText(rec({ state: "no_manual_found" }), "OTHER", "X")).toBeNull();
    expect(acquisitionDeclineText(null, "K", "X")).toBeNull();
    expect(acquisitionDeclineText(rec({ state: "search_unavailable" }), "K", "X")).toBeNull();
    expect(acquisitionDeclineText(rec({ state: "download_rejected" }), "K", "X")).toBeNull();
  });
});

describe("recordFromOutcome", () => {
  it("keeps only string facts the pipeline returned", () => {
    const r = recordFromOutcome("K", "2026-09-29T00:00:00Z", {
      status: "no_manual_found",
      payload: { oemRequestUrl: "https://oem.example/r", candidate: null, manual: { matchState: 7 } },
    });
    expect(r).toMatchObject({ key: "K", state: "no_manual_found", oem_request_url: "https://oem.example/r", candidate_host: null, match_state: null });
  });
});

describe("Codex #4118 F2 — what the record says was actually attached", () => {
  it("a review-only candidate (no download) is recorded unattached, with its URL", () => {
    const r = recordFromOutcome("K", null, {
      status: "candidate_review",
      payload: { candidate: { url: "https://oem.example/landing", host: "oem.example" } },
    });
    expect(r).toMatchObject({ state: "candidate_review", attached_indexed: false, candidate_url: "https://oem.example/landing" });
  });
  it("an attached, indexed candidate is recorded attached", () => {
    const r = recordFromOutcome("K", null, {
      status: "candidate_review",
      payload: { manual: { docId: "d1", indexed: true, matchState: "candidate" }, candidate: { host: "h" } },
    });
    expect(r.attached_indexed).toBe(true);
  });
  it("another request still indexing the same bytes → stays 'running' so the stale recovery retries it", () => {
    const r = recordFromOutcome("K", null, {
      status: "candidate_review",
      payload: { manual: { fileId: "f1", docId: null, indexed: false }, warning: "another request is currently indexing this exact document — retry in a moment to attach it" },
    });
    expect(r.state).toBe("running");
    expect(r.finished_at).toBeNull();
    expect(r.attached_indexed).toBe(false);
  });
});

describe("Codex #4118 F3 — fencedPromoter", () => {
  it("enables only while the notebook is still confirmed as THIS identity and owns this claim — in one statement", async () => {
    const { fencedPromoter } = await import("../notebook-manual-acquisition");
    db.claimRows = 1;
    expect(await fencedPromoter("SMC|VQ1000FPGC6C6D|")("t", "nb", "doc", { reason: "r" })).toBe(true);
    const q = db.queries.at(-1)!;
    expect(q.sql).toMatch(/UPDATE equipment_notebook_sources s/);
    expect(q.sql).toMatch(/n\.identity_status = 'user_confirmed'/);
    expect(q.sql).toMatch(/n\.manual_acquisition->>'key' = \$5/);
    expect(q.sql).toMatch(/regexp_replace\(coalesce\(n\.model, ''\)/);
    expect(q.params[4]).toBe("SMC|VQ1000FPGC6C6D|");
  });
  it("refuses (false) when no row matched — the identity moved on", async () => {
    const { fencedPromoter } = await import("../notebook-manual-acquisition");
    const { withTenantContext } = await import("@/lib/tenant-context");
    vi.mocked(withTenantContext).mockImplementationOnce(async (_t: string, fn: (c: unknown) => unknown) =>
      fn({ query: vi.fn(async () => ({ rowCount: 0, rows: [] })) }),
    );
    expect(await fencedPromoter("K")("t", "nb", "doc", {})).toBe(false);
  });
  it("the SQL key normalization matches acquisitionKey for the same identity", () => {
    const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
    // Mirror of the SQL: upper(regexp_replace(x, '[^A-Za-z0-9]', '', 'g')).
    const sqlNorm = (s: string) => s.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    for (const s of ["VQ1000-FPG-C6C6-D", "smc", "SLC 5/03", "AC 01.2", "Ölfilter-7"]) expect(sqlNorm(s)).toBe(norm(s));
  });
});

