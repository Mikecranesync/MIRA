import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "22222222-2222-4222-8222-222222222222";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn(async () => ({ tenantId: TENANT })) }));
vi.mock("@/lib/upload-pipeline", () => ({ runIngestPipeline: vi.fn(async () => undefined) }));
vi.mock("@/lib/uploads", () => ({
  createUpload: vi.fn(),
  deleteUpload: vi.fn(async () => true),
  findUploadByExternalFileId: vi.fn(),
  listUploads: vi.fn(),
}));

import { POST } from "../route";
import { createUpload, deleteUpload, findUploadByExternalFileId } from "@/lib/uploads";
import { runIngestPipeline } from "@/lib/upload-pipeline";

const existing = (status: string) => ({
  id: "11111111-1111-4111-8111-111111111111",
  tenantId: TENANT,
  provider: "google",
  kind: "document",
  externalFileId: "drive-file-1",
  externalDownloadUrl: null,
  filename: "manual.pdf",
  mimeType: "application/pdf",
  sizeBytes: 10,
  externalCreatedAt: null,
  status,
  statusDetail: null,
  kbFileId: null,
});

const fresh = { ...existing("queued"), id: "33333333-3333-4333-8333-333333333333" };

function repick() {
  return POST(
    new NextRequest("http://localhost/api/uploads", {
      method: "POST",
      body: JSON.stringify({
        provider: "google",
        externalFileId: "drive-file-1",
        filename: "manual.pdf",
        mimeType: "application/pdf",
      }),
    }),
  );
}

describe("POST /api/uploads — re-picking a file whose earlier import ended (#4081)", () => {
  beforeEach(() => {
    vi.mocked(createUpload).mockReset().mockResolvedValue(fresh as never);
    vi.mocked(deleteUpload).mockClear();
    vi.mocked(runIngestPipeline).mockClear();
  });

  it.each(["cancelled", "failed"])("a %s import is replaced by a fresh one, not a 409", async (status) => {
    vi.mocked(findUploadByExternalFileId).mockResolvedValue(existing(status) as never);
    const res = await repick();
    expect(res.status).toBe(201);
    expect(deleteUpload).toHaveBeenCalledWith(existing(status).id, TENANT);
    expect(createUpload).toHaveBeenCalledOnce();
    expect(runIngestPipeline).toHaveBeenCalledOnce();
    expect((await res.json()).id).toBe(fresh.id);
  });

  it("a parsed import is still returned as alreadyImported, never re-run", async () => {
    vi.mocked(findUploadByExternalFileId).mockResolvedValue(existing("parsed") as never);
    const res = await repick();
    expect(res.status).toBe(200);
    expect((await res.json()).alreadyImported).toBe(true);
    expect(deleteUpload).not.toHaveBeenCalled();
    expect(createUpload).not.toHaveBeenCalled();
  });

  it("an in-flight import is still returned as alreadyInProgress", async () => {
    vi.mocked(findUploadByExternalFileId).mockResolvedValue(existing("parsing") as never);
    const res = await repick();
    expect(res.status).toBe(200);
    expect((await res.json()).alreadyInProgress).toBe(true);
    expect(deleteUpload).not.toHaveBeenCalled();
  });
});
