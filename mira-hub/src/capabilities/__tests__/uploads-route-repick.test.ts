import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "22222222-2222-4222-8222-222222222222";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn(async () => ({ tenantId: TENANT })) }));
vi.mock("@/lib/upload-pipeline", () => ({
  runIngestPipeline: vi.fn(async () => undefined),
  pipelineInputFromRow: vi.fn((row: { id: string }) => ({ uploadId: row.id })),
}));
vi.mock("@/lib/local-upload", () => ({ retryLocalUpload: vi.fn() }));
vi.mock("@/lib/uploads", () => ({
  cancelUpload: vi.fn(),
  deleteUploadAndKnowledge: vi.fn(),
  getUploadCounts: vi.fn(),
  updateUploadStatusForAttempt: vi.fn(async () => undefined),
  claimUploadForRequeue: vi.fn(),
  createUpload: vi.fn(),
  findUploadByExternalFileId: vi.fn(),
  getUpload: vi.fn(),
  listUploads: vi.fn(),
}));

import { POST } from "@/app/api/uploads/route";
import { POST as RETRY } from "@/app/api/uploads/[id]/retry/route";
import { DELETE } from "@/app/api/uploads/[id]/route";
import {
  cancelUpload,
  claimUploadForRequeue,
  createUpload,
  findUploadByExternalFileId,
  getUpload,
  updateUploadStatusForAttempt,
} from "@/lib/uploads";
import { retryLocalUpload } from "@/lib/local-upload";
import { runIngestPipeline } from "@/lib/upload-pipeline";

const ID = "11111111-1111-4111-8111-111111111111";

const row = (status: string) => ({
  id: ID,
  tenantId: TENANT,
  provider: "dropbox",
  kind: "document",
  externalFileId: "dbx-file-1",
  externalDownloadUrl: "https://old.link/expired",
  filename: "manual.pdf",
  mimeType: "application/pdf",
  sizeBytes: 10,
  externalCreatedAt: null,
  status,
  statusDetail: null,
  kbFileId: null,
  assetTag: null,
});

function repick() {
  return POST(
    new NextRequest("http://localhost/api/uploads", {
      method: "POST",
      body: JSON.stringify({
        provider: "dropbox",
        externalFileId: "dbx-file-1",
        externalDownloadUrl: "https://fresh.link/manual.pdf",
        filename: "manual.pdf",
        mimeType: "application/pdf",
      }),
    }),
  );
}

beforeEach(() => {
  vi.mocked(claimUploadForRequeue).mockReset();
  vi.mocked(createUpload).mockReset();
  vi.mocked(findUploadByExternalFileId).mockReset();
  vi.mocked(getUpload).mockReset();
  vi.mocked(runIngestPipeline).mockClear();
  vi.mocked(cancelUpload).mockReset();
  vi.mocked(updateUploadStatusForAttempt).mockClear();
});

describe("POST /api/uploads — re-picking a file whose earlier import ended (#4081)", () => {
  it.each(["cancelled", "failed"])("a %s import is requeued on the SAME row, with the fresh link", async (status) => {
    vi.mocked(findUploadByExternalFileId).mockResolvedValue(row(status) as never);
    vi.mocked(claimUploadForRequeue).mockResolvedValue({
      ...row("queued"),
      externalDownloadUrl: "https://fresh.link/manual.pdf",
    } as never);
    const res = await repick();
    expect(res.status).toBe(202);
    // F2: the fresh link is persisted BY the winning claim, so a later Retry uses it.
    expect(claimUploadForRequeue).toHaveBeenCalledWith(
      ID, TENANT, ["failed", "cancelled"], "re-picked", "https://fresh.link/manual.pdf",
    );
    expect(createUpload).not.toHaveBeenCalled();
    expect(runIngestPipeline).toHaveBeenCalledOnce();
    expect(vi.mocked(runIngestPipeline).mock.calls[0][0]).toMatchObject({
      uploadId: ID,
      externalDownloadUrl: "https://fresh.link/manual.pdf",
    });
  });

  it("race: a retry requeued the row first — no second pipeline, the row is reported as in progress", async () => {
    vi.mocked(findUploadByExternalFileId)
      .mockResolvedValueOnce(row("failed") as never)
      .mockResolvedValueOnce(row("queued") as never);
    vi.mocked(claimUploadForRequeue).mockResolvedValue(null);
    const res = await repick();
    expect(res.status).toBe(200);
    expect((await res.json()).alreadyInProgress).toBe(true);
    expect(runIngestPipeline).not.toHaveBeenCalled();
    expect(createUpload).not.toHaveBeenCalled();
  });

  it("a parsed import is still returned as alreadyImported, never re-run", async () => {
    vi.mocked(findUploadByExternalFileId).mockResolvedValue(row("parsed") as never);
    const res = await repick();
    expect(res.status).toBe(200);
    expect((await res.json()).alreadyImported).toBe(true);
    expect(claimUploadForRequeue).not.toHaveBeenCalled();
    expect(runIngestPipeline).not.toHaveBeenCalled();
  });

  it("an in-flight import is still returned as alreadyInProgress", async () => {
    vi.mocked(findUploadByExternalFileId).mockResolvedValue(row("parsing") as never);
    const res = await repick();
    expect((await res.json()).alreadyInProgress).toBe(true);
    expect(claimUploadForRequeue).not.toHaveBeenCalled();
  });
});

describe("POST /api/uploads/:id/retry — the same atomic claim (#4081 review F1)", () => {
  const retry = () =>
    RETRY(new NextRequest(`http://localhost/api/uploads/${ID}/retry`, { method: "POST" }), {
      params: Promise.resolve({ id: ID }),
    });

  it("starts one pipeline when it wins the failed → queued claim", async () => {
    vi.mocked(getUpload).mockResolvedValue(row("failed") as never);
    vi.mocked(claimUploadForRequeue).mockResolvedValue(row("queued") as never);
    const res = await retry();
    expect(res.status).toBe(202);
    expect(claimUploadForRequeue).toHaveBeenCalledWith(ID, TENANT, ["failed"], "user retry");
    expect(runIngestPipeline).toHaveBeenCalledOnce();
  });

  it("race: a re-pick claimed the row first — 409, no second pipeline", async () => {
    vi.mocked(getUpload)
      .mockResolvedValueOnce(row("failed") as never)
      .mockResolvedValueOnce(row("queued") as never);
    vi.mocked(claimUploadForRequeue).mockResolvedValue(null);
    const res = await retry();
    expect(res.status).toBe(409);
    expect((await res.json()).currentStatus).toBe("queued");
    expect(runIngestPipeline).not.toHaveBeenCalled();
  });
});

describe("099: the local retry path claims before it runs, and cancel revokes", () => {
  const retry = () =>
    RETRY(new NextRequest(`http://localhost/api/uploads/${ID}/retry`, { method: "POST" }), {
      params: Promise.resolve({ id: ID }),
    });
  const localRow = (status: string) => ({ ...row(status), provider: "local", attemptId: "att-new" });

  it("a local retry runs on the CLAIMED row (its new attempt), never the stale read", async () => {
    vi.mocked(getUpload).mockResolvedValue(localRow("failed") as never);
    vi.mocked(claimUploadForRequeue).mockResolvedValue(localRow("queued") as never);
    vi.mocked(retryLocalUpload).mockResolvedValue(true);
    const res = await retry();
    expect(res.status).toBe(202);
    expect(vi.mocked(retryLocalUpload).mock.calls[0][0]).toMatchObject({ attemptId: "att-new", status: "queued" });
  });

  it("a local retry whose buffer expired hands the row back to failed under the attempt it holds", async () => {
    vi.mocked(getUpload).mockResolvedValue(localRow("failed") as never);
    vi.mocked(claimUploadForRequeue).mockResolvedValue(localRow("queued") as never);
    vi.mocked(retryLocalUpload).mockResolvedValue(false);
    const res = await retry();
    expect(res.status).toBe(400);
    expect(updateUploadStatusForAttempt).toHaveBeenCalledWith(ID, TENANT, "att-new", "failed", "saved file expired");
  });

  const del = () =>
    DELETE(new NextRequest(`http://localhost/api/uploads/${ID}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: ID }),
    });

  it("cancelling an in-flight import goes through cancelUpload (revoke + chunk cleanup)", async () => {
    vi.mocked(getUpload).mockResolvedValue(row("parsing") as never);
    vi.mocked(cancelUpload).mockResolvedValue(true);
    const res = await del();
    expect(res.status).toBe(200);
    expect(cancelUpload).toHaveBeenCalledWith(ID, TENANT, "user cancelled");
  });

  it("a cancel that loses to completion reports the new state, never a false 'cancelled'", async () => {
    vi.mocked(getUpload)
      .mockResolvedValueOnce(row("parsing") as never)
      .mockResolvedValueOnce(row("parsed") as never);
    vi.mocked(cancelUpload).mockResolvedValue(false);
    const res = await del();
    expect(res.status).toBe(409);
    expect((await res.json()).currentStatus).toBe("parsed");
  });
});
