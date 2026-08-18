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

vi.mock("@/lib/service-request-context", () => ({ requestContextOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));
vi.mock("@/lib/equipment-notebooks", () => ({
  getNotebook: vi.fn(),
  attachSource: vi.fn(),
  setSourceState: vi.fn(),
  updateNotebook: vi.fn(),
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
vi.mock("@/lib/manual-discovery", () => ({
  discoverManual: vi.fn(),
  allowedHostsForCandidate: vi.fn(() => ["rockwellautomation.com"]),
}));
vi.mock("@/lib/safe-download", () => ({
  safeDownloadPdf: vi.fn(),
  safePdfFilename: vi.fn(() => "520-um001.pdf"),
}));

import { POST } from "../confirm/route";
import { requestContextOr401 } from "@/lib/service-request-context";
import { withTenantContext } from "@/lib/tenant-context";
import { getNotebook, attachSource, setSourceState, updateNotebook } from "@/lib/equipment-notebooks";
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
  vi.mocked(requestContextOr401).mockResolvedValue({
    ...session,
    authKind: "session",
    sourceChannel: null,
  });
  vi.mocked(getNotebook).mockResolvedValue(notebook);
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
    vi.mocked(requestContextOr401).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await POST(makeReq(baseBody), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(401);
  });

  it("accepts service auth while retaining the tenant-scoped notebook gate", async () => {
    vi.mocked(requestContextOr401).mockResolvedValue({
      ...session,
      authKind: "service",
      sourceChannel: "slack",
    });
    vi.mocked(getNotebook).mockResolvedValue(null);
    const res = await POST(makeReq(baseBody), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(404);
    expect(getNotebook).toHaveBeenCalledWith(TENANT_ID, NOTEBOOK_ID);
    expect(getFile).not.toHaveBeenCalled();
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

  it("status candidate_review — an unvalidated result is never auto-imported", async () => {
    vi.mocked(discoverManual).mockResolvedValue({
      ...importableDiscovery(),
      validated: false,
    });
    const res = await POST(makeReq(baseBody), makeParams(NOTEBOOK_ID));
    const body = await res.json();
    expect(body.status).toBe("candidate_review");
    expect(body.candidate).toMatchObject({ url: CANDIDATE.url });
    expect(safeDownloadPdf).not.toHaveBeenCalled();
    // The nameplate TEXT is parked (idempotent citable source); the MANUAL is not.
    expect(vi.mocked(parkOrReuseFile).mock.calls.every((c) => c[0].source === "nameplate_text")).toBe(true);
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
