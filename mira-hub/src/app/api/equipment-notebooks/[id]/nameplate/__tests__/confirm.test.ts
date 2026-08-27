// Vitest coverage for POST /api/equipment-notebooks/[id]/nameplate/confirm.
//
// Invariants under test:
//   - The confirmed nameplate becomes a citable source (user_confirmed, photo).
//   - The parent notebook's identity is NEVER patched from a component nameplate.
//   - A discovered manual is attached DISABLED as a candidate; only chunk-level
//     evidence from THAT document promotes it to verified + enabled.
//   - A scanned PDF is stored and viewable but never becomes a chat source.
//   - When discovery is unavailable the response says so and nothing is invented.
//
// manual-applicability is deliberately NOT mocked — the real verdict logic is
// the thing that decides whether a source can enter chat.
//
// Run: cd mira-hub && npx vitest run "src/app/api/equipment-notebooks"

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));
vi.mock("@/lib/equipment-notebooks", () => ({
  getNotebook: vi.fn(),
  attachSource: vi.fn(),
  setSourceState: vi.fn(),
  updateNotebook: vi.fn(),
  // 085 provenance contract
  findVisibleOriginSource: vi.fn(async () => null),
  supersedePriorOriginSources: vi.fn(async () => []),
}));
vi.mock("@/lib/workspace-files", () => ({
  getFile: vi.fn(),
  parkOrReuseFile: vi.fn(),
  linkFileToUpload: vi.fn(),
  attachFileToTargets: vi.fn(),
  claimIngest: vi.fn(),
  releaseIngestClaim: vi.fn(),
}));
vi.mock("@/lib/node-knowledge-ingest", () => {
  class NoExtractableTextError extends Error {
    constructor(filename: string) {
      super(`no extractable text in ${filename}`);
      this.name = "NoExtractableTextError";
    }
  }
  return {
    ingestTextToNode: vi.fn(),
    ingestPdfToNode: vi.fn(),
    deleteOrphanNodeIngest: vi.fn(async () => undefined),
    NoExtractableTextError,
  };
});
// Partial mock: discovery + the download allowlist are stubbed, but the
// INDEPENDENT OEM-host predicate stays REAL — it is the security gate the
// unvalidated-candidate path below turns on, so a test must not fake it.
vi.mock("@/lib/manual-discovery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/manual-discovery")>();
  return {
    ...actual,
    discoverManual: vi.fn(),
    allowedHostsForCandidate: vi.fn(() => ["rockwellautomation.com"]),
  };
});
vi.mock("@/lib/safe-download", () => ({
  safeDownloadPdf: vi.fn(),
  safePdfFilename: vi.fn(() => "520-um001.pdf"),
}));

import { POST } from "../confirm/route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import {
  getNotebook,
  attachSource,
  setSourceState,
  updateNotebook,
  findVisibleOriginSource,
  supersedePriorOriginSources,
} from "@/lib/equipment-notebooks";
import { getFile, parkOrReuseFile, linkFileToUpload, attachFileToTargets, claimIngest, releaseIngestClaim } from "@/lib/workspace-files";
import { ingestTextToNode, ingestPdfToNode, deleteOrphanNodeIngest, NoExtractableTextError } from "@/lib/node-knowledge-ingest";
import { discoverManual } from "@/lib/manual-discovery";
import { safeDownloadPdf } from "@/lib/safe-download";

const NOTEBOOK_ID = "11111111-2222-3333-4444-555555555555";
const NODE_ID = "99999999-8888-7777-6666-555555555555";
const PHOTO_FILE_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const MANUAL_FILE_ID = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";
const NAMEPLATE_DOC_ID = "cccccccc-dddd-eeee-ffff-000000000000";
const MANUAL_DOC_ID = "dddddddd-eeee-ffff-0000-111111111111";
const TENANT_ID = "tenant-aaaa-bbbb";

const session = {
  userId: "u_1",
  tenantId: TENANT_ID,
  email: "x@y",
  status: "trial",
  trialExpiresAt: null,
};

const notebook = {
  id: NOTEBOOK_ID,
  displayName: "Line 3 Case Packer",
  manufacturer: "Nobody Inc",
  model: "RIDE-1",
  nodeId: NODE_ID,
} as never;

const IDENTITY = {
  manufacturer: "Allen-Bradley",
  model: "525",
  catalogNumber: "25B-D010N104",
  serialNumber: "SN-99",
  equipmentType: "VFD",
  voltage: "480V",
  fullLoadAmps: "10.5",
  horsepower: "5",
  frequency: "60Hz",
  rpm: "1750",
};

const CANDIDATE = {
  url: "https://literature.rockwellautomation.com/idc/520-um001_-en-e.pdf",
  title: "PowerFlex 520-Series User Manual",
  host: "literature.rockwellautomation.com",
  score: 0.9,
  docType: "user_manual",
  isDirectPdf: true,
  validated: true,
};

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

function makeReq(body: unknown, id = NOTEBOOK_ID) {
  return new Request(`https://hub.test/api/equipment-notebooks/${id}/nameplate/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

const baseBody = {
  fileId: PHOTO_FILE_ID,
  identity: IDENTITY,
  rawObservation: { provider: "together-vision", rawText: ["ALLEN-BRADLEY", "POWERFLEX 525"] },
  confidence: 0.82,
};

/** Discovery that returns an auto-importable OEM PDF. */
function importableDiscovery() {
  return {
    serviceAvailable: true,
    found: true,
    candidate: CANDIDATE,
    validated: true,
    isDirectPdf: true,
    oemHost: true,
    trustedDistributorHost: false,
    reason: "validated OEM PDF",
  };
}

function pdfDownload() {
  return {
    ok: true as const,
    buffer: Buffer.from("%PDF-1.7 manual"),
    finalUrl: CANDIDATE.url,
    contentType: "application/pdf",
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(sessionOr401).mockResolvedValue(session);
  vi.mocked(getNotebook).mockResolvedValue(notebook);
  vi.mocked(findVisibleOriginSource).mockResolvedValue(null);
  vi.mocked(supersedePriorOriginSources).mockResolvedValue([]);
  vi.mocked(getFile).mockResolvedValue({
    file: { id: PHOTO_FILE_ID } as never,
    links: [
      {
        id: "link-1",
        fileId: PHOTO_FILE_ID,
        targetType: "equipment_notebook",
        targetId: NOTEBOOK_ID,
        role: "photo",
        displayLabel: null,
        isPrimary: false,
        createdAt: "2026-08-13T00:00:00Z",
      },
    ],
  });
  vi.mocked(ingestTextToNode).mockResolvedValue({ uploadId: NAMEPLATE_DOC_ID, chunkCount: 1 });
  vi.mocked(attachSource).mockResolvedValue({ ok: true });
  vi.mocked(setSourceState).mockResolvedValue(true);
  vi.mocked(attachFileToTargets).mockResolvedValue({
    ok: true,
    links: [{ linkId: "link-m", targetType: "equipment_notebook", targetId: NOTEBOOK_ID }],
  });
  vi.mocked(parkOrReuseFile).mockResolvedValue({
    fileId: MANUAL_FILE_ID,
    reused: false,
    uploadId: null,
  });
  vi.mocked(ingestPdfToNode).mockResolvedValue({ uploadId: MANUAL_DOC_ID, chunkCount: 400 });
  vi.mocked(linkFileToUpload).mockResolvedValue(true);
  // Default: this request wins the atomic ingestion claim (single-writer path).
  vi.mocked(claimIngest).mockResolvedValue({ claimed: true, claimToken: "tok-1" });
  vi.mocked(releaseIngestClaim).mockResolvedValue(undefined);
  // Default chunk read: no identity evidence.
  vi.mocked(withTenantContext).mockResolvedValue([{ content: "Some other drive", page: 1 }]);
});

describe("auth, tenancy, and request shape", () => {
  it("propagates a 401", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await POST(makeReq(baseBody), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(401);
  });

  it("404s a cross-tenant notebook", async () => {
    vi.mocked(getNotebook).mockResolvedValue(null);
    const res = await POST(makeReq(baseBody), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(404);
    expect(ingestTextToNode).not.toHaveBeenCalled();
  });

  it("404s a fileId that is not linked to THIS notebook", async () => {
    vi.mocked(getFile).mockResolvedValue({
      file: { id: PHOTO_FILE_ID } as never,
      links: [
        {
          id: "link-x",
          fileId: PHOTO_FILE_ID,
          targetType: "equipment_notebook",
          targetId: "00000000-0000-0000-0000-000000000009",
          role: "photo",
          displayLabel: null,
          isPrimary: false,
          createdAt: "2026-08-13T00:00:00Z",
        },
      ],
    });
    const res = await POST(makeReq(baseBody), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("file_not_found");
  });

  it("400s a malformed fileId", async () => {
    const res = await POST(makeReq({ ...baseBody, fileId: "nope" }), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(400);
  });
});

describe("the confirmed nameplate becomes a citable source", () => {
  it("ingests deterministic text and attaches it as photo/user_confirmed", async () => {
    vi.mocked(discoverManual).mockResolvedValue({
      serviceAvailable: true,
      found: false,
      candidate: null,
      validated: false,
      isDirectPdf: false,
      oemHost: false,
      trustedDistributorHost: false,
      reason: "no official manual found",
    });

    const res = await POST(makeReq(baseBody), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nameplate).toMatchObject({
      docId: NAMEPLATE_DOC_ID,
      sourceRole: "photo",
      matchState: "user_confirmed",
      photoFileId: PHOTO_FILE_ID,
    });

    expect(ingestTextToNode).toHaveBeenCalledTimes(1);
    const call = vi.mocked(ingestTextToNode).mock.calls[0][0];
    expect(call.nodeId).toBe(NODE_ID);
    expect(call.mimeType).toBe("text/plain");
    const text = call.buffer.toString("utf8");
    // Raw extraction, corrected identity, confidence, canonical photo id.
    expect(text).toContain("POWERFLEX 525");
    expect(text).toContain("Catalog number: 25B-D010N104");
    expect(text).toContain("Recognition confidence: 0.82");
    expect(text).toContain(PHOTO_FILE_ID);

    expect(attachSource).toHaveBeenCalledWith(
      TENANT_ID,
      NOTEBOOK_ID,
      NAMEPLATE_DOC_ID,
      expect.objectContaining({ matchState: "user_confirmed", sourceRole: "photo" }),
    );
  });

  it("produces byte-identical text for identical input (deterministic)", async () => {
    vi.mocked(discoverManual).mockResolvedValue({
      serviceAvailable: false,
      found: false,
      candidate: null,
      validated: false,
      isDirectPdf: false,
      oemHost: false,
      trustedDistributorHost: false,
      reason: "search service unavailable",
    });
    await POST(makeReq(baseBody), makeParams(NOTEBOOK_ID));
    await POST(makeReq(baseBody), makeParams(NOTEBOOK_ID));
    const a = vi.mocked(ingestTextToNode).mock.calls[0][0].buffer.toString("utf8");
    const b = vi.mocked(ingestTextToNode).mock.calls[1][0].buffer.toString("utf8");
    expect(a).toBe(b);
  });

  it("NEVER patches the parent notebook's identity with the component's", async () => {
    vi.mocked(discoverManual).mockResolvedValue(importableDiscovery());
    vi.mocked(safeDownloadPdf).mockResolvedValue(pdfDownload());
    await POST(makeReq(baseBody), makeParams(NOTEBOOK_ID));
    expect(updateNotebook).not.toHaveBeenCalled();
  });
});

describe("discovery terminal states", () => {
  it("status search_unavailable when the service cannot be reached — nothing fabricated", async () => {
    vi.mocked(discoverManual).mockResolvedValue({
      serviceAvailable: false,
      found: false,
      candidate: null,
      validated: false,
      isDirectPdf: false,
      oemHost: false,
      trustedDistributorHost: false,
      reason: "search service unavailable",
    });
    const res = await POST(makeReq(baseBody), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("search_unavailable");
    expect(body.message).toBe("search service unavailable");
    expect(body.manual).toBeNull();
    expect(body.candidate).toBeNull();
    expect(safeDownloadPdf).not.toHaveBeenCalled();
  });

  it("status no_manual_found when the service answered with nothing", async () => {
    vi.mocked(discoverManual).mockResolvedValue({
      serviceAvailable: true,
      found: false,
      candidate: null,
      validated: false,
      isDirectPdf: false,
      oemHost: false,
      trustedDistributorHost: false,
      reason: "no official manual found",
    });
    const res = await POST(makeReq(baseBody), makeParams(NOTEBOOK_ID));
    expect((await res.json()).status).toBe("no_manual_found");
  });

  it("status manufacturer_model_required when identity is too thin to search", async () => {
    const res = await POST(
      makeReq({ ...baseBody, identity: { serialNumber: "SN-99" } }),
      makeParams(NOTEBOOK_ID),
    );
    const body = await res.json();
    expect(body.status).toBe("manufacturer_model_required");
    expect(discoverManual).not.toHaveBeenCalled();
    // The nameplate source is still created — the identity is still evidence.
    expect(ingestTextToNode).toHaveBeenCalledTimes(1);
  });

  it("status complete with discovery skipped when discover:false", async () => {
    const res = await POST(makeReq({ ...baseBody, discover: false }), makeParams(NOTEBOOK_ID));
    const body = await res.json();
    expect(body.status).toBe("complete");
    expect(body.discovery).toEqual({ requested: false });
    expect(discoverManual).not.toHaveBeenCalled();
  });

  // CHANGED BY #3400. This candidate is literature.rockwellautomation.com, which
  // we can independently attribute to Allen-Bradley, so it is now PROBED with the
  // hardened downloader instead of dead-ending. The invariant that matters is
  // unchanged and still asserted here: an unvalidated result is never auto-
  // ENABLED. "Not downloaded" was never the invariant — it was the symptom.
  // The genuinely-not-probed cases are covered in the #3400 block below
  // (non-OEM host, oemHost:false, not a direct PDF).
  it("status candidate_review — an unvalidated result is probed but never auto-enabled", async () => {
    vi.mocked(discoverManual).mockResolvedValue({
      ...importableDiscovery(),
      validated: false,
    });
    vi.mocked(safeDownloadPdf).mockResolvedValue(pdfDownload());
    const res = await POST(makeReq(baseBody), makeParams(NOTEBOOK_ID));
    const body = await res.json();
    expect(body.status).toBe("candidate_review");
    expect(body.candidate).toMatchObject({ url: CANDIDATE.url });
    expect(safeDownloadPdf).toHaveBeenCalledTimes(1);
    expect(body.manual).toMatchObject({ matchState: "candidate", enabledByDefault: false });
  });

  it("status download_rejected when the hardened fetcher refuses", async () => {
    vi.mocked(discoverManual).mockResolvedValue(importableDiscovery());
    vi.mocked(safeDownloadPdf).mockResolvedValue({ ok: false, reason: "blocked_host" });
    const res = await POST(makeReq(baseBody), makeParams(NOTEBOOK_ID));
    const body = await res.json();
    expect(body.status).toBe("download_rejected");
    expect(body.reason).toBe("blocked_host");
    expect(body.manual).toBeNull();
    expect(vi.mocked(parkOrReuseFile).mock.calls.every((c) => c[0].source === "nameplate_text")).toBe(true);
  });
});

describe("manual import: candidate until the document proves itself", () => {
  it("attaches an unproven manual DISABLED so it cannot enter chat", async () => {
    vi.mocked(discoverManual).mockResolvedValue(importableDiscovery());
    vi.mocked(safeDownloadPdf).mockResolvedValue(pdfDownload());
    // Chunks mention a different product entirely.
    vi.mocked(withTenantContext).mockResolvedValue([
      { content: "SEW MOVITRAC B operating instructions", page: 1 },
    ]);

    const res = await POST(makeReq(baseBody), makeParams(NOTEBOOK_ID));
    const body = await res.json();
    expect(body.status).toBe("candidate_review");
    expect(body.manual).toMatchObject({ matchState: "candidate", enabledByDefault: false });
    expect(body.applicability.state).toBe("candidate");

    // Attached as candidate (upsert makes candidate => enabled_by_default false)...
    expect(attachFileToTargets).toHaveBeenCalledWith(
      TENANT_ID,
      MANUAL_FILE_ID,
      [expect.objectContaining({ role: "manual", matchState: "candidate" })],
      expect.anything(),
    );
    // ...and explicitly held disabled.
    expect(setSourceState).toHaveBeenCalledWith(
      TENANT_ID,
      NOTEBOOK_ID,
      MANUAL_DOC_ID,
      expect.objectContaining({ matchState: "candidate", enabledByDefault: false }),
    );
  });

  it("flips to verified + enabled and persists matchEvidence when the text proves it", async () => {
    vi.mocked(discoverManual).mockResolvedValue(importableDiscovery());
    vi.mocked(safeDownloadPdf).mockResolvedValue(pdfDownload());
    vi.mocked(withTenantContext).mockResolvedValue([
      { content: "Allen-Bradley PowerFlex 525, catalog 25B-D010N104", page: 12 },
    ]);

    const res = await POST(makeReq(baseBody), makeParams(NOTEBOOK_ID));
    const body = await res.json();
    expect(body.status).toBe("complete");
    expect(body.manual).toMatchObject({
      matchState: "verified",
      enabledByDefault: true,
      docId: MANUAL_DOC_ID,
      indexed: true,
    });
    expect(body.applicability).toMatchObject({
      state: "verified",
      method: "catalog_number_exact",
      evidencePages: [12],
    });

    const patch = vi.mocked(setSourceState).mock.calls.at(-1)![3] as Record<string, unknown>;
    expect(patch.matchState).toBe("verified");
    expect(patch.enabledByDefault).toBe(true);
    const ev = patch.matchEvidence as Record<string, unknown>;
    expect(ev.discoveryUrl).toBe(CANDIDATE.url);
    expect(ev.finalUrl).toBe(CANDIDATE.url);
    expect(ev.decisionMethod).toBe("catalog_number_exact");
    expect(ev.matchedTokens).toContain("25BD010N104");
    expect(ev.evidencePages).toEqual([12]);
    expect(ev.confirmedIdentity).toMatchObject({ model: "525" });
    expect(JSON.stringify(ev)).not.toMatch(/X-Mira-Key|ASK_API_KEY|api[_-]?key/i);
  });

  it("reuses an existing parsed document on exact-byte dedup without re-parsing", async () => {
    vi.mocked(discoverManual).mockResolvedValue(importableDiscovery());
    vi.mocked(safeDownloadPdf).mockResolvedValue(pdfDownload());
    vi.mocked(parkOrReuseFile).mockResolvedValue({
      fileId: MANUAL_FILE_ID,
      reused: true,
      uploadId: MANUAL_DOC_ID,
    });
    vi.mocked(withTenantContext).mockResolvedValue([
      { content: "Allen-Bradley PowerFlex 525 catalog 25B-D010N104", page: 3 },
    ]);

    const res = await POST(makeReq(baseBody), makeParams(NOTEBOOK_ID));
    const body = await res.json();
    expect(ingestPdfToNode).not.toHaveBeenCalled();
    expect(linkFileToUpload).not.toHaveBeenCalled();
    expect(body.manual).toMatchObject({ docId: MANUAL_DOC_ID, reused: true, matchState: "verified" });
  });
});

describe("scanned manuals are stored, viewable, and never a chat source", () => {
  it("returns status no_extractable_text and creates no source row", async () => {
    vi.mocked(discoverManual).mockResolvedValue(importableDiscovery());
    vi.mocked(safeDownloadPdf).mockResolvedValue(pdfDownload());
    vi.mocked(ingestPdfToNode).mockRejectedValue(new NoExtractableTextError("520-um001.pdf"));

    const res = await POST(makeReq(baseBody), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("no_extractable_text");
    expect(body.manual).toMatchObject({ fileId: MANUAL_FILE_ID, docId: null, indexed: false });
    expect(body.warning).toMatch(/scanned/i);
    // The FILE is attached (it shows in Files) but with no matchState — with no
    // indexed doc there is no source row, so it cannot enter chat.
    const attachArgs = vi.mocked(attachFileToTargets).mock.calls.at(-1)!;
    expect(attachArgs[2][0]).toMatchObject({ role: "manual" });
    expect(attachArgs[2][0].matchState).toBeUndefined();
    expect(setSourceState).not.toHaveBeenCalled();
  });
});

describe("atomic, idempotent materialization (Codex P1, 2026-08-16)", () => {
  it("a repeated confirmation REUSES the nameplate doc — no second document/chunk set", async () => {
    // The deterministic text's bytes already exist with a finished ingest.
    vi.mocked(parkOrReuseFile).mockResolvedValueOnce({
      fileId: "eeeeeeee-1111-2222-3333-444444444444",
      reused: true,
      uploadId: NAMEPLATE_DOC_ID,
    });
    vi.mocked(discoverManual).mockResolvedValue({
      serviceAvailable: false, found: false, candidate: null, validated: false,
      isDirectPdf: false, oemHost: false, trustedDistributorHost: false, reason: "unavailable",
    });
    const res = await POST(makeReq(baseBody), makeParams(NOTEBOOK_ID));
    const body = await res.json();
    expect(body.nameplate).toMatchObject({ docId: NAMEPLATE_DOC_ID, ingested: true });
    expect(ingestTextToNode).not.toHaveBeenCalled();
    // Still attached (attach is idempotent) — but never re-materialized.
    expect(attachSource).toHaveBeenCalledWith(TENANT_ID, NOTEBOOK_ID, NAMEPLATE_DOC_ID, expect.anything());
  });

  it("the loser of a concurrent identical manual ingest NEVER double-ingests", async () => {
    vi.mocked(discoverManual).mockResolvedValue(importableDiscovery());
    vi.mocked(safeDownloadPdf).mockResolvedValue({
      ok: true,
      buffer: Buffer.from("%PDF-1.4 fake"),
      finalUrl: CANDIDATE.url,
      contentType: "application/pdf",
    });
    // Text park: already ingested (not under test here).
    vi.mocked(parkOrReuseFile)
      .mockResolvedValueOnce({ fileId: "eeeeeeee-1111-2222-3333-444444444444", reused: true, uploadId: NAMEPLATE_DOC_ID })
      // Manual park: bytes exist but the WINNER is still ingesting them.
      .mockResolvedValueOnce({ fileId: MANUAL_FILE_ID, reused: true, uploadId: null });
    vi.mocked(claimIngest).mockResolvedValue({ claimed: false, reason: "ingest_in_progress", uploadId: null });

    const res = await POST(makeReq(baseBody), makeParams(NOTEBOOK_ID));
    const body = await res.json();
    expect(ingestPdfToNode).not.toHaveBeenCalled();
    expect(body.status).toBe("candidate_review");
    expect(body.warning).toMatch(/currently indexing/i);
    expect(body.manual).toMatchObject({ fileId: MANUAL_FILE_ID, docId: null, indexed: false });
  });

  it("an ingest failure releases the claim so a retry need not wait out staleness", async () => {
    vi.mocked(parkOrReuseFile)
      .mockResolvedValueOnce({ fileId: "eeeeeeee-1111-2222-3333-444444444444", reused: false, uploadId: null })
      .mockResolvedValue({ fileId: MANUAL_FILE_ID, reused: false, uploadId: null });
    vi.mocked(ingestTextToNode).mockRejectedValue(new Error("tika down"));
    vi.mocked(discoverManual).mockResolvedValue({
      serviceAvailable: false, found: false, candidate: null, validated: false,
      isDirectPdf: false, oemHost: false, trustedDistributorHost: false, reason: "unavailable",
    });
    const res = await POST(makeReq(baseBody), makeParams(NOTEBOOK_ID));
    const body = await res.json();
    // Explicit partial — never a silent ok with a missing citable source.
    expect(body.nameplate).toMatchObject({ docId: null, ingested: false });
    expect(releaseIngestClaim).toHaveBeenCalled();
  });
});

describe("fail-closed attach + orphan cleanup (self-review round 3, 2026-08-16)", () => {
  it("attachSource returning ok:false is a partial — never ingested:true, never discovery", async () => {
    // The ingest succeeded but the source row did NOT land: without it the doc
    // is not citable in this notebook, so reporting ingested:true would fail
    // open on the route's primary deliverable.
    vi.mocked(attachSource).mockResolvedValue({ ok: false, error: "doc_not_found" });
    const res = await POST(makeReq(baseBody), makeParams(NOTEBOOK_ID));
    const body = await res.json();
    expect(body.status).toBe("nameplate_not_indexed");
    expect(body.nameplate).toMatchObject({ docId: null, ingested: false });
    expect(discoverManual).not.toHaveBeenCalled();
  });

  it("attachSource throwing is a partial — the swallowed error must not fail open", async () => {
    vi.mocked(attachSource).mockRejectedValue(new Error("db down"));
    const res = await POST(makeReq(baseBody), makeParams(NOTEBOOK_ID));
    const body = await res.json();
    expect(body.status).toBe("nameplate_not_indexed");
    expect(body.nameplate).toMatchObject({ docId: null, ingested: false });
    expect(discoverManual).not.toHaveBeenCalled();
  });

  it("a lost nameplate fence deletes the orphaned duplicate ingest", async () => {
    vi.mocked(linkFileToUpload).mockResolvedValueOnce(false);
    const res = await POST(makeReq(baseBody), makeParams(NOTEBOOK_ID));
    const body = await res.json();
    expect(body.status).toBe("nameplate_not_indexed");
    expect(deleteOrphanNodeIngest).toHaveBeenCalledWith(TENANT_ID, NAMEPLATE_DOC_ID);
  });

  it("a lost manual fence deletes the orphaned duplicate ingest", async () => {
    // Nameplate: already materialized (reused). Manual: ingests, loses the fence.
    vi.mocked(parkOrReuseFile)
      .mockResolvedValueOnce({ fileId: "eeeeeeee-1111-2222-3333-444444444444", reused: true, uploadId: NAMEPLATE_DOC_ID })
      .mockResolvedValueOnce({ fileId: MANUAL_FILE_ID, reused: false, uploadId: null });
    vi.mocked(discoverManual).mockResolvedValue(importableDiscovery());
    vi.mocked(safeDownloadPdf).mockResolvedValue({
      ok: true,
      buffer: Buffer.from("%PDF-1.4 fake"),
      finalUrl: CANDIDATE.url,
      contentType: "application/pdf",
    });
    vi.mocked(linkFileToUpload).mockResolvedValueOnce(false);
    await POST(makeReq(baseBody), makeParams(NOTEBOOK_ID));
    expect(deleteOrphanNodeIngest).toHaveBeenCalledWith(TENANT_ID, MANUAL_DOC_ID);
  });
});

// ── #3400: the hardened download, not the search service's flag, decides ─────
//
// Measured on the real Siemens candidate: oem_host=true (support.industry.
// siemens.com is in the service's OEM_DOMAINS), is_direct_pdf=true, but
// validated=false — the service's HEAD/Range probe did not confirm the PDF from
// production. The URL nevertheless serves a real 1.79 MB %PDF-1.6. The old gate
// returned candidate_review BEFORE safeDownloadPdf ever ran, so the technician
// got a dead "Use this manual" button.
//
// The relaxation is deliberately narrow: an unvalidated candidate is probed
// ONLY when it is a direct PDF, the service says oem_host, AND we can
// INDEPENDENTLY confirm the host belongs to this manufacturer. safeDownloadPdf
// is unchanged and remains the only fetcher.
describe("#3400 — unvalidated OEM candidate is probed, never trusted", () => {
  const SIEMENS_IDENTITY = {
    ...IDENTITY,
    manufacturer: "SIEMENS",
    model: "TP700 Comfort",
    catalogNumber: null,
  };
  const SIEMENS_CANDIDATE = {
    url: "https://support.industry.siemens.com/cs/attachments/109768600/manual_en-US.pdf",
    title: "SIMATIC HMI Comfort Panels — Operating Instructions",
    host: "support.industry.siemens.com",
    score: 0.8,
    docType: "user_manual",
    isDirectPdf: true,
    validated: false,
  };
  const siemensBody = { ...baseBody, identity: SIEMENS_IDENTITY };

  /** Discovery as production actually returned it: OEM host, but unvalidated. */
  function unvalidatedOemDiscovery(over: Record<string, unknown> = {}) {
    return {
      serviceAvailable: true,
      found: true,
      candidate: SIEMENS_CANDIDATE,
      validated: false,
      isDirectPdf: true,
      oemHost: true,
      trustedDistributorHost: false,
      reason: "candidate manual found",
      ...over,
    };
  }

  it("downloads it, attaches it as an UNVERIFIED candidate, and asks the user to confirm", async () => {
    vi.mocked(discoverManual).mockResolvedValue(unvalidatedOemDiscovery() as never);
    vi.mocked(safeDownloadPdf).mockResolvedValue(pdfDownload());

    const res = await POST(makeReq(siemensBody), makeParams(NOTEBOOK_ID));
    const body = (await res.json()) as Record<string, never>;

    expect(res.status).toBe(200);
    expect(safeDownloadPdf).toHaveBeenCalledTimes(1);
    // Never "complete" — a successful download is not proof the doc is official.
    expect(body.status).toBe("candidate_review");
    expect(body.manual).toBeTruthy();
    expect((body.manual as Record<string, unknown>).matchState).toBe("candidate");
    expect((body.manual as Record<string, unknown>).enabledByDefault).toBe(false);
  });

  it("records discoveryValidated:false so nothing downstream can read it as official", async () => {
    vi.mocked(discoverManual).mockResolvedValue(unvalidatedOemDiscovery() as never);
    vi.mocked(safeDownloadPdf).mockResolvedValue(pdfDownload());

    await POST(makeReq(siemensBody), makeParams(NOTEBOOK_ID));

    const evidences = vi
      .mocked(setSourceState)
      .mock.calls.map((c) => (c[3] as { matchEvidence?: Record<string, unknown> })?.matchEvidence)
      .filter(Boolean) as Record<string, unknown>[];
    expect(evidences.length).toBeGreaterThan(0);
    for (const e of evidences) {
      expect(e.discoveryValidated).toBe(false);
      expect(e.independentlyOemHosted).toBe(true);
    }
  });

  it("still refuses to auto-enable even when the document text matches the identity", async () => {
    // Chunks that WOULD verify a validated candidate. An unvalidated one must
    // still land in front of a human — the download proved retrievability, not
    // provenance.
    vi.mocked(withTenantContext).mockResolvedValue([
      { content: "SIMATIC HMI TP700 Comfort operating instructions SIEMENS", page: 1 },
      { content: "TP700 Comfort technical specifications", page: 2 },
    ] as never);
    vi.mocked(discoverManual).mockResolvedValue(unvalidatedOemDiscovery() as never);
    vi.mocked(safeDownloadPdf).mockResolvedValue(pdfDownload());

    const res = await POST(makeReq(siemensBody), makeParams(NOTEBOOK_ID));
    const body = (await res.json()) as Record<string, never>;

    expect(body.status).toBe("candidate_review");
    expect((body.manual as Record<string, unknown>).matchState).toBe("candidate");
    expect((body.manual as Record<string, unknown>).enabledByDefault).toBe(false);
    for (const call of vi.mocked(setSourceState).mock.calls) {
      expect((call[3] as Record<string, unknown>).matchState).not.toBe("verified");
      expect((call[3] as Record<string, unknown>).enabledByDefault).not.toBe(true);
    }
  });

  it("does NOT download when the host is not independently attributable to the manufacturer", async () => {
    // Service claims oem_host, but manualslib.com is on nobody's OEM list. The
    // service's word alone is not trust.
    vi.mocked(discoverManual).mockResolvedValue(
      unvalidatedOemDiscovery({
        candidate: {
          ...SIEMENS_CANDIDATE,
          host: "manualslib.com",
          url: "https://manualslib.com/x.pdf",
        },
      }) as never,
    );

    const res = await POST(makeReq(siemensBody), makeParams(NOTEBOOK_ID));
    const body = (await res.json()) as Record<string, never>;

    expect(body.status).toBe("candidate_review");
    expect(safeDownloadPdf).not.toHaveBeenCalled();
    expect(body.manual ?? null).toBeNull();
  });

  it("does NOT download when the service itself says the host is not the OEM's", async () => {
    vi.mocked(discoverManual).mockResolvedValue(unvalidatedOemDiscovery({ oemHost: false }) as never);

    const res = await POST(makeReq(siemensBody), makeParams(NOTEBOOK_ID));
    const body = (await res.json()) as Record<string, never>;

    expect(body.status).toBe("candidate_review");
    expect(safeDownloadPdf).not.toHaveBeenCalled();
  });

  it("does NOT download an unvalidated candidate that is not a direct PDF", async () => {
    vi.mocked(discoverManual).mockResolvedValue(unvalidatedOemDiscovery({ isDirectPdf: false }) as never);

    const res = await POST(makeReq(siemensBody), makeParams(NOTEBOOK_ID));
    expect(((await res.json()) as Record<string, never>).status).toBe("candidate_review");
    expect(safeDownloadPdf).not.toHaveBeenCalled();
  });

  it("reports the vendor refusing the download honestly, and imports nothing", async () => {
    vi.mocked(discoverManual).mockResolvedValue(unvalidatedOemDiscovery() as never);
    vi.mocked(safeDownloadPdf).mockResolvedValue({ ok: false, reason: "http_error" } as never);

    const res = await POST(makeReq(siemensBody), makeParams(NOTEBOOK_ID));
    const body = (await res.json()) as Record<string, never>;

    expect(res.status).toBe(200);
    expect(body.status).toBe("download_rejected");
    expect(body.reason).toBe("http_error");
    // No partial file, no source row, no misleading metadata.
    // The nameplate TEXT is still parked (it is its own citable source); the
    // MANUAL must not be.
    expect(vi.mocked(parkOrReuseFile).mock.calls.every((c) => c[0].source === "nameplate_text")).toBe(true);
    expect(ingestPdfToNode).not.toHaveBeenCalled();
    expect(setSourceState).not.toHaveBeenCalled();
    expect(body.manual ?? null).toBeNull();
    // The message names the category without leaking infrastructure detail.
    expect(String(body.message)).not.toMatch(/mira-ask|:8011|internal|127\.0\.0\.1|docker/i);
  });

  it("reports a timeout honestly rather than as a missing manual", async () => {
    vi.mocked(discoverManual).mockResolvedValue(unvalidatedOemDiscovery() as never);
    vi.mocked(safeDownloadPdf).mockResolvedValue({ ok: false, reason: "timeout" } as never);

    const body = (await (
      await POST(makeReq(siemensBody), makeParams(NOTEBOOK_ID))
    ).json()) as Record<string, never>;
    expect(body.status).toBe("download_rejected");
    expect(body.reason).toBe("timeout");
    expect(vi.mocked(parkOrReuseFile).mock.calls.every((c) => c[0].source === "nameplate_text")).toBe(true);
  });

  it("keeps returning only statuses the mobile client already maps", async () => {
    const KNOWN = new Set([
      "complete",
      "candidate_review",
      "no_manual_found",
      "search_unavailable",
      "no_extractable_text",
      "manufacturer_model_required",
      "nameplate_not_indexed",
      "download_rejected",
    ]);
    vi.mocked(discoverManual).mockResolvedValue(unvalidatedOemDiscovery() as never);
    vi.mocked(safeDownloadPdf).mockResolvedValue(pdfDownload());
    const a = (await (
      await POST(makeReq(siemensBody), makeParams(NOTEBOOK_ID))
    ).json()) as Record<string, never>;
    expect(KNOWN.has(String(a.status))).toBe(true);

    vi.mocked(safeDownloadPdf).mockResolvedValue({ ok: false, reason: "network_error" } as never);
    const b = (await (
      await POST(makeReq(siemensBody), makeParams(NOTEBOOK_ID))
    ).json()) as Record<string, never>;
    expect(KNOWN.has(String(b.status))).toBe(true);
  });
});

// ── 085: logical-evidence idempotency + supersede (Commodity PRD Phase 2) ────
describe("canonical-evidence contract (085)", () => {
  function happyIngestMocks() {
    vi.mocked(parkOrReuseFile).mockResolvedValue({
      fileId: "f11e0000-0000-4000-8000-000000000001",
      uploadId: null,
      reused: false,
    } as never);
    vi.mocked(claimIngest).mockResolvedValue({ claimed: true, claimToken: "tok-1" } as never);
    vi.mocked(ingestTextToNode).mockResolvedValue({
      uploadId: NAMEPLATE_DOC_ID,
      chunkCount: 3,
    } as never);
    vi.mocked(linkFileToUpload).mockResolvedValue(true);
    vi.mocked(attachSource).mockResolvedValue({ ok: true });
  }

  it("supersedes prior readings of the SAME photo after attaching the new derived doc", async () => {
    happyIngestMocks();
    const res = await POST(makeReq({ ...baseBody, discover: false }), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(200);
    expect(supersedePriorOriginSources).toHaveBeenCalledWith(
      TENANT_ID,
      NOTEBOOK_ID,
      PHOTO_FILE_ID,
      NAMEPLATE_DOC_ID,
    );
    // supersede runs only AFTER a successful attach
    const attachOrder = vi.mocked(attachSource).mock.invocationCallOrder[0];
    const supersedeOrder = vi.mocked(supersedePriorOriginSources).mock.invocationCallOrder[0];
    expect(supersedeOrder).toBeGreaterThan(attachOrder);
  });

  it("records the clientKey on the source row as audit evidence", async () => {
    happyIngestMocks();
    await POST(
      makeReq({ ...baseBody, discover: false, clientKey: "ck-abc" }),
      makeParams(NOTEBOOK_ID),
    );
    expect(attachSource).toHaveBeenCalledWith(
      TENANT_ID,
      NOTEBOOK_ID,
      NAMEPLATE_DOC_ID,
      expect.objectContaining({
        originFileId: PHOTO_FILE_ID,
        matchEvidence: { confirm_client_key: "ck-abc" },
      }),
    );
  });

  it("a replay carrying the SAME clientKey reuses the existing derived doc — no re-park, no re-ingest, no supersede", async () => {
    vi.mocked(findVisibleOriginSource).mockResolvedValue({
      docId: NAMEPLATE_DOC_ID,
      matchEvidence: { confirm_client_key: "ck-abc" },
    });
    const res = await POST(
      makeReq({ ...baseBody, discover: false, clientKey: "ck-abc" }),
      makeParams(NOTEBOOK_ID),
    );
    expect(res.status).toBe(200);
    expect(parkOrReuseFile).not.toHaveBeenCalled();
    expect(ingestTextToNode).not.toHaveBeenCalled();
    expect(attachSource).not.toHaveBeenCalled();
    expect(supersedePriorOriginSources).not.toHaveBeenCalled();
  });

  it("a DIFFERENT clientKey against an existing reading processes normally (an edited re-confirm)", async () => {
    vi.mocked(findVisibleOriginSource).mockResolvedValue({
      docId: "eeeeeeee-0000-4000-8000-000000000009",
      matchEvidence: { confirm_client_key: "ck-old" },
    });
    happyIngestMocks();
    const res = await POST(
      makeReq({ ...baseBody, discover: false, clientKey: "ck-new" }),
      makeParams(NOTEBOOK_ID),
    );
    expect(res.status).toBe(200);
    expect(parkOrReuseFile).toHaveBeenCalled();
    expect(supersedePriorOriginSources).toHaveBeenCalled();
  });

  it("a supersede failure does not fail a confirm that already attached its source", async () => {
    happyIngestMocks();
    vi.mocked(supersedePriorOriginSources).mockRejectedValue(new Error("db down"));
    const res = await POST(makeReq({ ...baseBody, discover: false }), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; status: string };
    expect(body.ok).toBe(true);
    expect(body.status).toBe("complete"); // the confirm still completed
  });
});
