/**
 * #4075 — the background official-manual search for a confirmed identity.
 *
 * Run: npx vitest run src/capabilities/__tests__/notebook-manual-acquisition.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { candidateAcquisitionEnabled } from "../notebook-manual-acquisition";

const db = vi.hoisted(() => ({
  queries: [] as { sql: string; params: unknown[] }[],
  claimRows: 1,
  readRow: null as unknown,
  failWith: null as null | { code: string },
  existingSource: false,
  updatedSource: { match_state: "verified", enabled_by_default: true } as unknown,
  currentSource: null as unknown,
  sourceRow: null as unknown,
  fileLinked: false,
  // #4160 S6 — the fencedWriter/fencedAttach owner-row's confirmed_same_key
  // column. Defaults false so every pre-S6 ("confirmed" basis) test is
  // unaffected: that basis never reads this field.
  confirmedSameKey: false,
}));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) =>
    fn({
      query: vi.fn(async (sql: string, params: unknown[]) => {
        db.queries.push({ sql, params });
        if (db.failWith) throw Object.assign(new Error("db"), db.failWith);
        if (/^\s*SELECT manual_acquisition/.test(sql)) return { rows: db.readRow ? [{ manual_acquisition: db.readRow }] : [] };
        if (/RETURNING manual_acquisition->>'gen'/.test(sql)) return { rowCount: db.claimRows, rows: db.claimRows ? [{ gen: "g1" }] : [] };
        if (/FOR UPDATE/.test(sql))
          return { rowCount: db.claimRows, rows: db.claimRows ? [{ id: "nb", confirmed_same_key: db.confirmedSameKey }] : [] };
        if (/RETURNING match_state/.test(sql)) return { rowCount: db.updatedSource ? 1 : 0, rows: db.updatedSource ? [db.updatedSource] : [] };
        if (/FROM workspace_file_links/.test(sql)) return { rowCount: db.fileLinked ? 1 : 0, rows: db.fileLinked ? [{}] : [] };
        if (/^\s*SELECT match_state FROM equipment_notebook_sources/.test(sql) || /\bAS auto_key\b/.test(sql)) return { rowCount: db.sourceRow ? 1 : 0, rows: db.sourceRow ? [db.sourceRow] : [] };
        if (/SELECT match_state, enabled_by_default/.test(sql)) return { rowCount: db.currentSource ? 1 : 0, rows: db.currentSource ? [db.currentSource] : [] };
        if (/SELECT 1 FROM equipment_notebook_sources/.test(sql)) return { rowCount: db.existingSource ? 1 : 0, rows: db.existingSource ? [{}] : [] };
        return { rowCount: 1, rows: [] };
      }),
    }),
  ),
}));
vi.mock("@/lib/workspace-files", () => ({ attachFileToTargetsTx: vi.fn(async () => ({ ok: true, links: [] })) }));
// The real pipeline is covered by the nameplate confirm tests; here it is a seam.
vi.mock("@/capabilities/manual-acquisition", () => ({ acquireManualForIdentity: vi.fn() }));

import {
  acquisitionDeclineText,
  acquisitionEnabled,
  acquisitionKey,
  readAcquisition,
  reconcileAcquisition,
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
  db.existingSource = false;
  db.updatedSource = { match_state: "verified", enabled_by_default: true };
  db.currentSource = null;
  db.sourceRow = null;
  db.fileLinked = false;
  db.confirmedSameKey = false;
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
      writeSourceState: expect.any(Function),
      attach: expect.any(Function),
    });
    const claimQ = db.queries.find((q) => /RETURNING manual_acquisition->>'gen'/.test(q.sql))!;
    expect(claimQ.params).toEqual(["t", "nb", "SMC|VQ1000FPGC6C6D|", 10, 30, 3]);
    expect(claimQ.sql).toMatch(/state' = 'search_unavailable'/);
    // #4160 S4 — anchored to the specific WHERE-clause predicates (not just
    // "appears somewhere in the query"):
    //  - search_unavailable keeps its existing 30-min/3-retry backoff.
    //  - search_limit_reached (a quota-cap denial) is retried once a NEW UTC
    //    day starts since it finished, and is NOT counted against the
    //    retries budget — a cap denial costs no Serper query and must never
    //    become a permanently-cached miss (PRD R5).
    expect(claimQ.sql).toMatch(
      /OR \(manual_acquisition->>'state' = 'search_unavailable'\s*\n\s*AND COALESCE\(\(manual_acquisition->>'retries'\)::int, 0\) < \$6/,
    );
    expect(claimQ.sql).toMatch(
      /OR \(manual_acquisition->>'state' = 'search_limit_reached'\s*\n\s*AND COALESCE\(\(manual_acquisition->>'finished_at'\)::timestamptz, '-infinity'\)\s*\n\s*< date_trunc\('day', now\(\), 'UTC'\)\)\)/,
    );
    // The retries counter itself must NOT increment for search_limit_reached
    // (only for search_unavailable) — else a quota denial would exhaust
    // MAX_AUTOMATIC_RETRIES in ~90 minutes while the real daily/monthly
    // window is still far from reset.
    expect(claimQ.sql).toMatch(
      /'retries', CASE WHEN manual_acquisition->>'key' = \$3::text\s*\n\s*AND manual_acquisition->>'state' = 'search_unavailable'/,
    );
    const finishQ = db.queries.find((q) => /jsonb_set/.test(q.sql))!;
    const rec = JSON.parse(finishQ.params[2] as string) as AcquisitionRecord;
    expect(rec).toMatchObject({ key: "SMC|VQ1000FPGC6C6D|", state: "candidate_review", candidate_host: "www.smcworld.com", match_state: "candidate" });
    // Only OUR claim is overwritten — a re-bind mid-search wins.
    expect(finishQ.params[3]).toBe("SMC|VQ1000FPGC6C6D|");
    expect(finishQ.sql).toMatch(/WHERE tenant_id = \$1 AND id = \$2 AND manual_acquisition->>'key' = \$4/);
    // Codex #4118 r3 F6: the outcome is written only by the CURRENT claim generation.
    expect(finishQ.sql).toMatch(/manual_acquisition->>'gen' = \$5/);
    expect(finishQ.params[4]).toBe("g1");
    expect(claimQ.sql).toMatch(/'gen', gen_random_uuid\(\)::text/);
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
  it("#4160 S4: search_limit_reached says 'limit', NEVER 'couldn't find' — a cap denial is not a miss (PRD R5)", () => {
    const t = acquisitionDeclineText(rec({ state: "search_limit_reached" }), "K", "SMC VQ1000")!;
    expect(t).not.toBeNull();
    expect(t.toLowerCase()).toContain("limit");
    expect(t.toLowerCase()).not.toContain("couldn't find");
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
  it("#4172: an attached, indexed, applicability-verified candidate is recorded as promoting on confirm", () => {
    const r = recordFromOutcome("K", null, {
      status: "candidate_review",
      payload: { manual: { docId: "d1", indexed: true, matchState: "candidate", candidateApplicability: "verified" }, candidate: { host: "h" } },
    });
    expect(r.promotes_on_confirm).toBe(true);
  });
  it("#4172: a 'candidate' applicability verdict, or nothing attached, never promotes on confirm", () => {
    const cand = recordFromOutcome("K", null, {
      status: "candidate_review",
      payload: { manual: { docId: "d1", indexed: true, matchState: "candidate", candidateApplicability: "candidate" }, candidate: { host: "h" } },
    });
    expect(cand.promotes_on_confirm).toBe(false);
    const unattached = recordFromOutcome("K", null, {
      status: "candidate_review",
      payload: { manual: { docId: null, indexed: false, candidateApplicability: "verified" }, candidate: { host: "h" } },
    });
    expect(unattached.promotes_on_confirm).toBe(false);
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

describe("Codex #4118 F9 — a removed source is not recorded as attached", () => {
  it("attached:false wins over docId+indexed", () => {
    const r = recordFromOutcome("K", "2026-09-29T00:00:00Z", {
      status: "candidate_review",
      payload: { manual: { fileId: "f1", docId: "d1", indexed: true, attached: false } },
    });
    expect(r.attached_indexed).toBe(false);
    const control = recordFromOutcome("K", "2026-09-29T00:00:00Z", {
      status: "candidate_review",
      payload: { manual: { fileId: "f1", docId: "d1", indexed: true, attached: true } },
    });
    expect(control.attached_indexed).toBe(true);
  });
});

describe("Codex #4118 F3/F5/F8/F9 — fencedWriter", () => {
  const promote = async () => {
    const { fencedWriter } = await import("../notebook-manual-acquisition");
    return fencedWriter("SMC|VQ1000FPGC6C6D|", "g1")("t", "nb", "doc", {
      matchState: "verified",
      enabledByDefault: true,
      matchEvidence: { reason: "r" },
    });
  };
  it("locks the notebook row, re-checks ownership + identity, writes only an undecided candidate, stamps the key", async () => {
    expect(await promote()).toEqual({ matchState: "verified", enabledByDefault: true });
    const [lock, write] = db.queries.slice(-2);
    expect(lock.sql).toMatch(/FOR UPDATE/);
    expect(lock.sql).toMatch(/n\.identity_status = 'user_confirmed'/);
    expect(lock.sql).toMatch(/n\.manual_acquisition->>'key' = \$3/);
    expect(lock.sql).toMatch(/n\.manual_acquisition->>'gen' = \$4/);
    expect(lock.params[3]).toBe("g1");
    expect(lock.sql).toMatch(/regexp_replace\(coalesce\(n\.model, ''\)/);
    expect(write.sql).toMatch(/UPDATE equipment_notebook_sources/);
    expect(write.sql).toMatch(/match_state = 'candidate'/);
    expect(write.sql).toMatch(/decisionMethod' = 'pending_applicability_check'/);
    expect(JSON.parse(write.params[5] as string)).toMatchObject({ reason: "r", autoAcquisitionKey: "SMC|VQ1000FPGC6C6D|" });
  });
  it("F8: a decided source is not written — the writer reports its persisted state", async () => {
    db.updatedSource = null;
    db.currentSource = { match_state: "rejected", enabled_by_default: false };
    expect(await promote()).toEqual({ matchState: "rejected", enabledByDefault: false });
  });
  it("F9: a source removed meanwhile is reported as absent (null), not as written", async () => {
    db.updatedSource = null;
    db.currentSource = null;
    expect(await promote()).toBeNull();
  });
  it("refuses — and writes NOTHING — when the locked check finds no owning, matching notebook", async () => {
    const { fencedWriter } = await import("../notebook-manual-acquisition");
    db.claimRows = 0;
    db.currentSource = { match_state: "candidate", enabled_by_default: false };
    const res = await fencedWriter("K", "g1")("t", "nb", "doc", { matchState: "candidate", enabledByDefault: false, matchEvidence: {} });
    expect(res).toEqual({ matchState: "candidate", enabledByDefault: false });
    expect(db.queries.some((q) => /UPDATE equipment_notebook_sources/.test(q.sql))).toBe(false);
  });
});

describe("Codex #4118 r3 F5 / r15 F19 — fencedAttach", () => {
  const tgt = [{ targetType: "equipment_notebook" as const, targetId: "nb", role: "manual" as const, displayLabel: "m.pdf" }];
  it("attaches (in the same transaction) only while this generation owns the notebook", async () => {
    const { fencedAttach } = await import("../notebook-manual-acquisition");
    const { attachFileToTargetsTx } = await import("@/lib/workspace-files");
    db.claimRows = 1;
    expect(await fencedAttach("K", "g1")("t", "nb", "file", "doc", tgt, null)).toBe(true);
    expect(attachFileToTargetsTx).toHaveBeenCalled();
    vi.mocked(attachFileToTargetsTx).mockClear();
    db.claimRows = 0;
    expect(await fencedAttach("K", "g1")("t", "nb", "file", "doc", tgt, null)).toBe(false);
    expect(attachFileToTargetsTx).not.toHaveBeenCalled();
  });
});

describe("#4160 S6 — fencedWriter basis='candidate' never enables before confirmation", () => {
  it("defaults 'confirmed' is BYTE-IDENTICAL: the ownership SQL still names identity_status = 'user_confirmed' unconditionally for that branch", async () => {
    const { fencedWriter } = await import("../notebook-manual-acquisition");
    await fencedWriter("K", "g1")("t", "nb", "doc", { matchState: "verified", enabledByDefault: true, matchEvidence: {} });
    const lock = db.queries.at(-2)!;
    expect(lock.sql).toMatch(/\$5::text = 'confirmed' AND n\.identity_status = 'user_confirmed'/);
    expect(lock.params).toEqual(["t", "nb", "K", "g1", "confirmed"]);
  });

  it("NOT yet confirmed: forces match_state='candidate', enabled_by_default=false even though the verdict says verified+enabled", async () => {
    const { fencedWriter } = await import("../notebook-manual-acquisition");
    db.confirmedSameKey = false;
    const res = await fencedWriter("K", "g1", "candidate")("t", "nb", "doc", {
      matchState: "verified",
      enabledByDefault: true,
      matchEvidence: { candidateApplicability: "verified" },
    });
    expect(res).toEqual({ matchState: "verified", enabledByDefault: true }); // db.updatedSource (what the mock reports persisted)
    const write = db.queries.at(-1)!;
    // The WRITE statement itself must have asked for candidate/false, not the
    // verdict's verified/true — this is the actual guard; db.updatedSource
    // above is just the mock's canned "what got persisted" response.
    expect(write.params[3]).toBe("candidate");
    expect(write.params[4]).toBe(false);
    expect(JSON.parse(write.params[5] as string)).toMatchObject({ autoAcquisitionKey: "K", candidateApplicability: "verified" });
  });

  it("already confirmed to the SAME key (the common race) + candidateApplicability='verified': promotes, same as a confirmed-basis write", async () => {
    const { fencedWriter } = await import("../notebook-manual-acquisition");
    db.confirmedSameKey = true;
    await fencedWriter("K", "g1", "candidate")("t", "nb", "doc", {
      matchState: "verified",
      enabledByDefault: true,
      matchEvidence: { candidateApplicability: "verified" },
    });
    const write = db.queries.at(-1)!;
    expect(write.params[3]).toBe("verified");
    expect(write.params[4]).toBe(true);
  });

  it("already confirmed to the SAME key but candidateApplicability='candidate' (unproven): still never enables", async () => {
    const { fencedWriter } = await import("../notebook-manual-acquisition");
    db.confirmedSameKey = true;
    await fencedWriter("K", "g1", "candidate")("t", "nb", "doc", {
      matchState: "candidate",
      enabledByDefault: false,
      matchEvidence: { candidateApplicability: "candidate" },
    });
    const write = db.queries.at(-1)!;
    expect(write.params[3]).toBe("candidate");
    expect(write.params[4]).toBe(false);
  });

  it("the ownership SQL relaxes identity_status for 'candidate' basis, but still requires the SAME key when confirmed", async () => {
    const { fencedWriter } = await import("../notebook-manual-acquisition");
    await fencedWriter("K", "g1", "candidate")("t", "nb", "doc", { matchState: "candidate", enabledByDefault: false, matchEvidence: {} });
    const lock = db.queries.at(-2)!;
    expect(lock.sql).toMatch(/\$5::text = 'candidate' AND \(n\.identity_status <> 'user_confirmed' OR/);
    expect(lock.params).toEqual(["t", "nb", "K", "g1", "candidate"]);
  });

  it("refuses — and writes NOTHING — when the locked check finds no owning notebook, for candidate basis too", async () => {
    const { fencedWriter } = await import("../notebook-manual-acquisition");
    db.claimRows = 0;
    db.currentSource = { match_state: "candidate", enabled_by_default: false };
    const res = await fencedWriter("K", "g1", "candidate")("t", "nb", "doc", { matchState: "candidate", enabledByDefault: false, matchEvidence: {} });
    expect(res).toEqual({ matchState: "candidate", enabledByDefault: false });
    expect(db.queries.some((q) => /UPDATE equipment_notebook_sources/.test(q.sql))).toBe(false);
  });
});

describe("#4160 S6 — fencedAttach basis='candidate' relaxes ownership the same way", () => {
  const tgt = [{ targetType: "equipment_notebook" as const, targetId: "nb", role: "manual" as const, displayLabel: "m.pdf" }];
  it("attaches while owning (unconfirmed OR confirmed to the SAME key), relaxing identity_status only for 'candidate'", async () => {
    const { fencedAttach } = await import("../notebook-manual-acquisition");
    const { attachFileToTargetsTx } = await import("@/lib/workspace-files");
    db.claimRows = 1;
    expect(await fencedAttach("K", "g1", "candidate")("t", "nb", "file", "doc", tgt, null)).toBe(true);
    expect(attachFileToTargetsTx).toHaveBeenCalled();
    const lock = db.queries.find((q) => /manual_acquisition->>'prior_doc_id'/.test(q.sql))!;
    expect(lock.sql).toMatch(/\$5::text = 'candidate' AND \(n\.identity_status <> 'user_confirmed' OR/);
    expect(lock.params).toEqual(["t", "nb", "K", "g1", "candidate"]);
  });

  it("refuses when ownership is lost, for candidate basis too", async () => {
    const { fencedAttach } = await import("../notebook-manual-acquisition");
    const { attachFileToTargetsTx } = await import("@/lib/workspace-files");
    vi.mocked(attachFileToTargetsTx).mockClear();
    db.claimRows = 0;
    expect(await fencedAttach("K", "g1", "candidate")("t", "nb", "file", "doc", tgt, null)).toBe(false);
    expect(attachFileToTargetsTx).not.toHaveBeenCalled();
  });
});

describe("#4160 S6 — startManualAcquisition basis='candidate' threading", () => {
  const proposed = { identityStatus: "user_confirmed" as const, manufacturer: "SMC", model: "SS5Y3-DUW01302", catalogNumber: "" };
  const candidateInput = { tenantId: "t", userId: "u", notebookId: "nb", nodeId: "node", identity: proposed, basis: "candidate" as const };

  it("keys EXACTLY as acquisitionKey() would key the identity a PATCH bind would write", () => {
    expect(acquisitionKey(proposed)).toBe(acquisitionKey({ ...proposed }));
    expect(acquisitionKey(proposed)).toBe("SMC|SS5Y3DUW01302|");
  });

  it("passes basis to the acquire() call, unlike the default 'confirmed' basis (which omits it)", async () => {
    const acquire = vi.fn(async () => ({ status: "candidate_review" as const, payload: {} }));
    expect(await startManualAcquisition(candidateInput, { acquire, env: ON })).toBe(true);
    await vi.waitFor(() => expect(acquire).toHaveBeenCalled());
    expect(acquire).toHaveBeenCalledWith(expect.objectContaining({ basis: "candidate" }));
  });

  // R4 — only manufacturer + part (the proposal's model) ever leave; the
  // synthetic identity's empty catalogNumber is cleaned to undefined, exactly
  // like the confirmed-basis path, so discoverManual's request body (built
  // from truthy fields only — manual-discovery.ts) never sends a stray key.
  it("R4: the synthetic candidate identity reaches acquire() with ONLY manufacturer + model — no catalogNumber", async () => {
    const acquire = vi.fn(async () => ({ status: "candidate_review" as const, payload: {} }));
    await startManualAcquisition(candidateInput, { acquire, env: ON });
    await vi.waitFor(() => expect(acquire).toHaveBeenCalled());
    expect(acquire).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: { manufacturer: "SMC", model: "SS5Y3-DUW01302", catalogNumber: undefined },
      }),
    );
  });

  it("claim idempotency: a second identical candidate (same key) while the first is still running does not start a second search", async () => {
    db.readRow = { key: "SMC|SS5Y3DUW01302|", state: "running", started_at: new Date().toISOString(), finished_at: null };
    db.claimRows = 0; // claim()'s WHERE clause would not match a fresh, non-stale 'running' record
    const acquire = vi.fn(async () => ({ status: "candidate_review" as const, payload: {} }));
    expect(await startManualAcquisition(candidateInput, { acquire, env: ON })).toBe(false);
    expect(acquire).not.toHaveBeenCalled();
  });

  it("the flag off ⇒ nothing starts, for candidate basis too", async () => {
    const acquire = vi.fn();
    expect(await startManualAcquisition(candidateInput, { acquire, env: {} })).toBe(false);
    expect(acquire).not.toHaveBeenCalled();
  });
});

describe("#4160 S6 — acquisitionDeclineText basis='candidate' copy", () => {
  const rec = (state: AcquisitionRecord["state"]): AcquisitionRecord => ({
    key: "K",
    state,
    started_at: "2026-01-01T00:00:00Z",
    finished_at: state === "running" ? null : "2026-01-01T00:01:00Z",
    candidate_host: null,
    match_state: null,
    oem_request_url: null,
  });

  // Codex post-cap 13/14 F13 (#4172): no shipping client renders the
  // identity_proposal frame, offers "Use its manuals", or can confirm an
  // EXISTING notebook's make/model (#4095 / #3626). The one action a
  // technician has on the acquired manual is turning it on in Sources (Hub
  // notebook page, classic mobile notebook screen), so the copy points there
  // and promises nothing about confirmation.
  it("'running' says the search is on and that the manual lands in Sources, turned off, to check — no button, no confirmation promise", () => {
    const t = acquisitionDeclineText(rec("running"), "K", "SMC SS5Y3-DUW01302", "candidate")!;
    expect(t).toMatch(/looking for the official SMC SS5Y3-DUW01302 manual now/);
    expect(t).toMatch(/Sources/);
    expect(t).toMatch(/turn it on/);
    expect(t).not.toMatch(/Use its manuals|Tap|tap |confirmed as that machine|once you do/);
    expect(t).not.toMatch(/ask again in a minute/);
  });

  // Codex post-cap 4 F9 (#4172): only promise "confirm and I'll answer from it"
  // when confirming will actually promote an attached, applicability-verified
  // document (migration 104 / fencedWriter's promoteNow). Otherwise give the
  // real next step.
  it("'candidate_review', even one confirmation WOULD promote, points at Sources and promises nothing about confirmation", () => {
    const t = acquisitionDeclineText(
      { ...rec("candidate_review"), attached_indexed: true, promotes_on_confirm: true },
      "K", "SMC SS5Y3-DUW01302", "candidate",
    )!;
    expect(t).toMatch(/Sources/);
    expect(t).toMatch(/turn it on/);
    expect(t).not.toMatch(/Use its manuals|Tap|tap |confirmed as that machine|once you do/);
  });

  it("'candidate_review' with an attached document confirmation will NOT promote points at Sources, never promises", () => {
    const t = acquisitionDeclineText(
      { ...rec("candidate_review"), attached_indexed: true, promotes_on_confirm: false },
      "K", "SMC SS5Y3-DUW01302", "candidate",
    )!;
    expect(t).not.toMatch(/Use its manuals|once this notebook is confirmed/);
    expect(t).not.toMatch(/once you do/);
    expect(t).toMatch(/Sources/);
  });

  it("a review-only result (nothing attached) gives its URL and the upload step, never the confirm promise", () => {
    const t = acquisitionDeclineText(
      { ...rec("candidate_review"), attached_indexed: false, candidate_url: "https://oem.example/landing" },
      "K", "SMC SS5Y3-DUW01302", "candidate",
    )!;
    expect(t).not.toMatch(/Use its manuals|once this notebook is confirmed/);
    expect(t).not.toMatch(/once you do/);
    expect(t).toContain("https://oem.example/landing");
    expect(t).toMatch(/upload/i);
  });

  // Codex post-cap 6 F11: a cached 'complete' record can outlive a later
  // revocation, and confirming never re-enables a revoked source, so the
  // candidate copy never promises it; the shared copy points at Sources.
  it("'complete' never promises that confirming will answer from it; it points at Sources", () => {
    const t = acquisitionDeclineText(rec("complete"), "K", "SMC SS5Y3-DUW01302", "candidate")!;
    expect(t).not.toMatch(/Use its manuals/);
    expect(t).toMatch(/Sources/);
  });

  it("default basis ('confirmed') is byte-identical to the pre-S6 copy", () => {
    expect(acquisitionDeclineText(rec("running"), "K", "SMC SS5Y3-DUW01302")).toBe(
      acquisitionDeclineText(rec("running"), "K", "SMC SS5Y3-DUW01302", "confirmed"),
    );
    expect(acquisitionDeclineText(rec("running"), "K", "SMC SS5Y3-DUW01302")).not.toMatch(/turned off until you check it/);
  });

  it("terminal honest-fact states (no manual found, a limit, a scan) are shared regardless of basis", () => {
    expect(acquisitionDeclineText(rec("no_manual_found"), "K", "X", "candidate")).toBe(
      acquisitionDeclineText(rec("no_manual_found"), "K", "X", "confirmed"),
    );
    expect(acquisitionDeclineText(rec("search_limit_reached"), "K", "X", "candidate")).toBe(
      acquisitionDeclineText(rec("search_limit_reached"), "K", "X", "confirmed"),
    );
  });
});


describe("key normalization", () => {
  it("the SQL key normalization matches acquisitionKey for the same identity", () => {
    const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
    // Mirror of the SQL: upper(regexp_replace(x, '[^A-Za-z0-9]', '', 'g')).
    const sqlNorm = (s: string) => s.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    for (const s of ["VQ1000-FPG-C6C6-D", "smc", "SLC 5/03", "AC 01.2", "Ölfilter-7"]) expect(sqlNorm(s)).toBe(norm(s));
  });
});


describe("Codex #4118 r8 F13 — a finished record is checked against the notebook's current sources", () => {
  const done: AcquisitionRecord = {
    key: "K",
    state: "complete",
    started_at: null,
    finished_at: null,
    candidate_host: "www.smcworld.com",
    match_state: "verified",
    oem_request_url: null,
    attached_indexed: true,
    doc_id: "11111111-1111-4111-8111-111111111111",
  };
  it("the record keeps the acquired document id", () => {
    const r = recordFromOutcome("K", "2026-09-29T00:00:00Z", {
      status: "complete",
      payload: { manual: { fileId: "f1", docId: "d1", indexed: true, attached: true } },
    });
    expect(r.doc_id).toBe("d1");
  });
  it("a removed source → marked removed; the text never says it is in Sources", async () => {
    db.sourceRow = null;
    const r = await reconcileAcquisition("t", "nb", done);
    expect(r).toMatchObject({ source_removed: true, attached_indexed: false });
    const text = acquisitionDeclineText(r, "K", "SMC VQ1000")!;
    expect(text).toMatch(/no longer in this notebook's Sources/);
    expect(text).not.toMatch(/turn it on in Sources|Check it in this notebook's Sources/);
  });
  it("a rejected source counts as removed; an attached candidate too", async () => {
    db.sourceRow = { match_state: "rejected" };
    expect((await reconcileAcquisition("t", "nb", done))?.source_removed).toBe(true);
    db.sourceRow = null;
    const cand = { ...done, state: "candidate_review" as const, match_state: "candidate" };
    expect((await reconcileAcquisition("t", "nb", cand))?.source_removed).toBe(true);
  });
  it("control: a source still present keeps the record (and its Sources text)", async () => {
    db.sourceRow = { match_state: "verified" };
    const r = await reconcileAcquisition("t", "nb", done);
    expect(r?.source_removed).toBeUndefined();
    expect(acquisitionDeclineText(r, "K", "SMC VQ1000")).toMatch(/added it to this notebook's Sources/);
  });
  // Codex post-cap 6 F11 (#4172): the cached "confirm and it turns on" promise is
  // re-checked against the CURRENT row with migration 104's exact promotion
  // predicate — a source revoked after the search (identity cleared) is never
  // promised again.
  const promising = { ...done, key: "K", state: "candidate_review" as const, match_state: "candidate", promotes_on_confirm: true };
  const promotable = { match_state: "candidate", enabled_by_default: false, auto_key: "K", cand_app: "verified", revoked: null };
  it("F11: a source revoked since the search loses promotes_on_confirm, and the copy points at Sources", async () => {
    db.sourceRow = { ...promotable, revoked: "notebook identity changed" };
    const r = await reconcileAcquisition("t", "nb", promising);
    expect(r?.promotes_on_confirm).toBe(false);
    const t = acquisitionDeclineText(r, "K", "SMC VQ1000", "candidate")!;
    expect(t).not.toMatch(/Use its manuals/);
    expect(t).toMatch(/Sources/);
  });
  it("F11: a different acquisition key, a 'candidate' stamp, or a non-candidate row also loses it", async () => {
    for (const row of [
      { ...promotable, auto_key: "OTHER" },
      { ...promotable, cand_app: "candidate" },
      { ...promotable, match_state: "verified" },
    ]) {
      db.sourceRow = row;
      expect((await reconcileAcquisition("t", "nb", promising))?.promotes_on_confirm).toBe(false);
    }
  });
  it("F11 control: a row migration 104 would still promote keeps the promise", async () => {
    db.sourceRow = promotable;
    expect((await reconcileAcquisition("t", "nb", promising))?.promotes_on_confirm).toBe(true);
  });
  it("a record without a document, or a running search, is not queried", async () => {
    db.queries = [];
    await reconcileAcquisition("t", "nb", { ...done, doc_id: null });
    await reconcileAcquisition("t", "nb", { ...done, state: "running" });
    expect(db.queries.length).toBe(0);
  });
});

describe("Codex #4118 r9 F14 — a scanned (file-only) manual is checked against the notebook's file link", () => {
  const scanned: AcquisitionRecord = {
    key: "K",
    state: "no_extractable_text",
    started_at: null,
    finished_at: null,
    candidate_host: null,
    match_state: null,
    oem_request_url: null,
    doc_id: null,
    file_id: "22222222-2222-4222-8222-222222222222",
  };
  it("the record keeps the acquired file id", () => {
    const r = recordFromOutcome("K", "2026-09-29T00:00:00Z", {
      status: "no_extractable_text",
      payload: { manual: { fileId: "f1", docId: null, indexed: false } },
    });
    expect(r.file_id).toBe("f1");
  });
  it("an unlinked file → removed; the text never says it is saved in Sources", async () => {
    db.fileLinked = false;
    const r = await reconcileAcquisition("t", "nb", scanned);
    expect(r?.source_removed).toBe(true);
    const text = acquisitionDeclineText(r, "K", "SMC VQ1000")!;
    expect(text).toMatch(/no longer in this notebook's Sources/);
    expect(text).not.toMatch(/saved in this notebook's Sources/);
  });
  it("control: a still-linked file keeps the record and its 'saved' text", async () => {
    db.fileLinked = true;
    const r = await reconcileAcquisition("t", "nb", scanned);
    expect(r?.source_removed).toBeUndefined();
    expect(acquisitionDeclineText(r, "K", "SMC VQ1000")).toMatch(/saved in this notebook's Sources/);
  });
});

describe("Codex #4118 r10 F15 — a transient download failure is retryable; a guard rejection is final", () => {
  it.each(["timeout", "network_error"])("%s → recorded as search_unavailable (retried after the backoff)", (reason) => {
    const r = recordFromOutcome("K", "2026-09-29T00:00:00Z", { status: "download_rejected", payload: { reason } });
    expect(r.state).toBe("search_unavailable");
    expect(r.download_reason).toBe(reason);
  });
  it.each(["not_pdf", "blocked_host", "host_not_allowed", "too_large", "http_error" /* no status */])(
    "control: %s stays download_rejected (final)",
    (reason) => {
      const r = recordFromOutcome("K", "2026-09-29T00:00:00Z", { status: "download_rejected", payload: { reason } });
      expect(r.state).toBe("download_rejected");
    },
  );
});

describe("Codex #4118 r11 F15 — a temporary HTTP status is retryable; a permanent one is final", () => {
  it.each([429, 503, 502, 504, 500, 408])("http_error %i → search_unavailable", (httpStatus) => {
    const r = recordFromOutcome("K", null, { status: "download_rejected", payload: { reason: "http_error", httpStatus } });
    expect(r.state).toBe("search_unavailable");
  });
  it.each([404, 403, 401, 410])("control: http_error %i stays download_rejected", (httpStatus) => {
    const r = recordFromOutcome("K", null, { status: "download_rejected", payload: { reason: "http_error", httpStatus } });
    expect(r.state).toBe("download_rejected");
  });
});

describe("Codex #4118 r12 F16 — a PDF that could not be READ (non-scan) is retryable; a scan is final", () => {
  it("candidate_review with ingestFailed → search_unavailable", () => {
    const r = recordFromOutcome("K", null, {
      status: "candidate_review",
      payload: { manual: { fileId: "f1", docId: null, indexed: false }, ingestFailed: true },
    });
    expect(r.state).toBe("search_unavailable");
  });
  it("controls: a scanned PDF stays no_extractable_text; a real review candidate stays candidate_review", () => {
    expect(recordFromOutcome("K", null, { status: "no_extractable_text", payload: { ingestFailed: false } }).state).toBe(
      "no_extractable_text",
    );
    expect(recordFromOutcome("K", null, { status: "candidate_review", payload: { manual: { docId: "d1", indexed: true } } }).state).toBe(
      "candidate_review",
    );
  });
});

describe("Codex #4118 r13 F17 — a database failure during assessment is retryable, not a verdict", () => {
  it("candidate_review with retryable → search_unavailable", () => {
    const r = recordFromOutcome("K", null, { status: "candidate_review", payload: { manual: { docId: "d1", indexed: true }, retryable: true } });
    expect(r.state).toBe("search_unavailable");
  });
  it("the fenced writer rethrows a database failure (it is not 'source missing')", async () => {
    const { fencedWriter } = await import("../notebook-manual-acquisition");
    db.failWith = { code: "08006" };
    await expect(
      fencedWriter("K", "g1")("t", "nb", "doc", { matchState: "verified", enabledByDefault: true, matchEvidence: {} }),
    ).rejects.toThrow();
  });
});

describe("Codex #4118 r14 F18/F19 — attach gate: database errors retry, removals are honored", () => {
  it("the record keeps whether the attempt attached, and a technician removal is final + removed", () => {
    const linked = recordFromOutcome("K", null, {
      status: "candidate_review",
      payload: { manual: { docId: "d1", indexed: true }, retryable: true, linked: true },
    });
    expect(linked).toMatchObject({ state: "search_unavailable", linked: true, doc_id: "d1" });
    const removed = recordFromOutcome("K", null, {
      status: "candidate_review",
      payload: { manual: { docId: "d1", indexed: true, attached: false }, removedByTechnician: true, linked: false },
    });
    expect(removed).toMatchObject({ state: "candidate_review", source_removed: true, attached_indexed: false, linked: false });
  });
  it("F18: the fenced attach gate throws on a database failure (never a silent refusal)", async () => {
    const { fencedAttach } = await import("../notebook-manual-acquisition");
    db.failWith = { code: "08006" };
    await expect(fencedAttach("K", "g1")("t", "nb", "file", "doc", [], null)).rejects.toThrow();
  });
  it("F19: a linked retryable record is reconciled against the notebook's sources", async () => {
    db.sourceRow = null;
    const r = await reconcileAcquisition("t", "nb", {
      key: "K",
      state: "search_unavailable",
      started_at: null,
      finished_at: null,
      candidate_host: null,
      match_state: null,
      oem_request_url: null,
      doc_id: "11111111-1111-4111-8111-111111111111",
      linked: true,
    });
    expect(r?.source_removed).toBe(true);
  });
});

// #4172 F13 / #4175: candidate takeover has its own flag, and needs the base one.
describe("candidateAcquisitionEnabled", () => {
  it("is on only when BOTH flags are exactly '1'", () => {
    expect(candidateAcquisitionEnabled({ MIRA_NOTEBOOK_MANUAL_ACQUISITION: "1", MIRA_NOTEBOOK_CANDIDATE_ACQUISITION: "1" })).toBe(true);
    expect(candidateAcquisitionEnabled({ MIRA_NOTEBOOK_MANUAL_ACQUISITION: "1" })).toBe(false);
    expect(candidateAcquisitionEnabled({ MIRA_NOTEBOOK_CANDIDATE_ACQUISITION: "1" })).toBe(false);
    expect(candidateAcquisitionEnabled({ MIRA_NOTEBOOK_MANUAL_ACQUISITION: "1", MIRA_NOTEBOOK_CANDIDATE_ACQUISITION: "true" })).toBe(false);
    expect(candidateAcquisitionEnabled({})).toBe(false);
  });
});
