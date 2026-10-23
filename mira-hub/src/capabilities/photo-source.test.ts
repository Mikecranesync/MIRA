import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({})),
}));
vi.mock("@/lib/equipment-notebooks", () => ({
  attachSource: vi.fn(async () => ({ ok: true })),
  findVisibleOriginSource: vi.fn(async () => null),
  supersedePriorOriginSources: vi.fn(async () => []),
  markNameplateDocVerified: vi.fn(async () => 0),
}));
vi.mock("@/lib/workspace-files", () => ({
  parkOrReuseFile: vi.fn(async () => ({ fileId: "text-file-1", uploadId: null })),
  claimIngest: vi.fn(async () => ({ claimed: true, claimToken: "tok-1" })),
  linkFileToUpload: vi.fn(async () => true),
  releaseIngestClaim: vi.fn(async () => undefined),
  photoLinkedToTarget: vi.fn(async () => ({ fileId: PHOTO, capturedAt: "2026-10-23T08:44:41.003Z" })),
}));
vi.mock("@/lib/node-knowledge-ingest", () => ({
  ingestTextToNode: vi.fn(async () => ({ uploadId: "doc-1", chunkCount: 2 })),
  deleteOrphanNodeIngest: vi.fn(async () => undefined),
}));
vi.mock("@/capabilities/screen-text", () => ({
  loadScreenTextLines: vi.fn(async () => null),
}));
vi.mock("@/lib/visual-evidence-context", () => ({
  loadVisualEvidenceForPhoto: vi.fn(async () => READING),
  correctVisualObservations: vi.fn(async () => ({
    corrected: [{ supersededId: "obs-1", replacementId: "obs-replaced" }],
    mismatched: [],
  })),
  MAX_LOOK_CORRECTION_VALUE_CHARS: 20_000,
}));

import { attachSource, findVisibleOriginSource, markNameplateDocVerified, supersedePriorOriginSources } from "@/lib/equipment-notebooks";
import { claimIngest, linkFileToUpload, parkOrReuseFile, photoLinkedToTarget } from "@/lib/workspace-files";
import { deleteOrphanNodeIngest, ingestTextToNode } from "@/lib/node-knowledge-ingest";
import { correctVisualObservations, loadVisualEvidenceForPhoto } from "@/lib/visual-evidence-context";
import { buildPhotoSourceText, citesOnlyUnconfirmedPhotoReadings, keepPhotoAsSource, materializeDerivedTextDoc } from "./photo-source";

const TENANT = "11111111-1111-4111-8111-111111111111";
const PHOTO = "f803bb1e-325e-46fd-a1a7-4421425c1f3e";
const NOTEBOOK = { id: "dfe74725-a4ac-4c5f-8e8c-1f06002daf0f", nodeId: "d400e0ae-218b-4dbc-8705-ad951ef0b80c", displayName: "Ride A — Coaster" };
const OBSERVATION = 'Coach 3 is labeled "-F55.3". Continuation arrows include "-L24-3-Aux1 15.0".';
const MISREAD = "-F53 /150";
const REVIEWED = "-F55.3 /15.0";
const READING = {
  observationId: "obs-1",
  sessionId: "sess-1",
  text: MISREAD,
  obsKind: "entity",
  trust: "candidate" as const,
  confidence: null,
  fileId: PHOTO,
  photoHash: "fcbabbc9fac2ebb2d175ae8bc3c549e9e3f630c02793e8cd8d2e66fa2890ddac",
  observedAt: "2026-10-23T08:44:41.003Z",
};

const keep = (extra: {
  reviewedReading?: string | null;
  threadId?: string | null;
  userId?: string | null;
} = {}) =>
  keepPhotoAsSource({
    tenantId: TENANT,
    userId: extra.userId === undefined ? "user-1" : extra.userId,
    notebook: NOTEBOOK,
    fileId: PHOTO,
    ...(extra.threadId !== undefined ? { threadId: extra.threadId } : {}),
    ...(extra.reviewedReading !== undefined ? { reviewedReading: extra.reviewedReading } : {}),
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildPhotoSourceText", () => {
  it("states the transcription is not technician-verified and carries the reading verbatim", () => {
    const text = buildPhotoSourceText({
      machineName: NOTEBOOK.displayName,
      fileId: PHOTO,
      photoSha256: READING.photoHash,
      capturedAt: READING.observedAt,
      observation: OBSERVATION,
    });
    expect(text).toContain("NOT technician-verified");
    expect(text).toContain("confirmed this photo belongs to this machine");
    expect(text).toContain(`Machine: ${NOTEBOOK.displayName}`);
    expect(text).toContain(`Photo sha256: ${READING.photoHash}`);
    expect(text).toContain(OBSERVATION);
  });

  it("states a technician reviewed the reading when confirmed", () => {
    const text = buildPhotoSourceText({
      machineName: NOTEBOOK.displayName,
      fileId: PHOTO,
      photoSha256: READING.photoHash,
      capturedAt: READING.observedAt,
      observation: REVIEWED,
      technicianConfirmed: true,
    });
    expect(text).toContain("technician reviewed this photo reading");
    expect(text).not.toContain("NOT technician-verified");
    expect(text).toContain(REVIEWED);
  });
});

describe("keepPhotoAsSource", () => {
  it("refuses a photo that is not linked to this notebook, before reading or ingesting anything", async () => {
    vi.mocked(photoLinkedToTarget).mockResolvedValueOnce(null);
    expect(await keep()).toEqual({ ok: false, status: 404, error: "photo_not_found" });
    expect(photoLinkedToTarget).toHaveBeenCalledWith(TENANT, PHOTO, "equipment_notebook", NOTEBOOK.id);
    expect(loadVisualEvidenceForPhoto).not.toHaveBeenCalled();
    expect(ingestTextToNode).not.toHaveBeenCalled();
    expect(attachSource).not.toHaveBeenCalled();
  });

  it("returns the existing source for a photo already kept or confirmed, and ingests nothing", async () => {
    vi.mocked(findVisibleOriginSource).mockResolvedValueOnce({ docId: "doc-existing", matchEvidence: null });
    expect(await keep()).toEqual({ ok: true, docId: "doc-existing", alreadyKept: true, chunkCount: 0 });
    expect(loadVisualEvidenceForPhoto).not.toHaveBeenCalled();
    expect(correctVisualObservations).not.toHaveBeenCalled();
    expect(ingestTextToNode).not.toHaveBeenCalled();
    expect(attachSource).not.toHaveBeenCalled();
    expect(markNameplateDocVerified).not.toHaveBeenCalled();
    expect(supersedePriorOriginSources).not.toHaveBeenCalled();
  });

  it("refuses a photo with no stored reading instead of attaching an empty document", async () => {
    vi.mocked(loadVisualEvidenceForPhoto).mockResolvedValueOnce(null);
    expect(await keep()).toEqual({ ok: false, status: 409, error: "no_photo_reading" });
    expect(parkOrReuseFile).not.toHaveBeenCalled();
    expect(attachSource).not.toHaveBeenCalled();
  });

  it("refuses a stored reading whose text is blank", async () => {
    vi.mocked(loadVisualEvidenceForPhoto).mockResolvedValueOnce({ ...READING, text: "   " });
    expect(await keep()).toEqual({ ok: false, status: 409, error: "no_photo_reading" });
    expect(attachSource).not.toHaveBeenCalled();
  });

  it("returns 409 reading_required and does not ingest when Keep has no reviewed reading", async () => {
    expect(await keep()).toEqual({
      ok: false,
      status: 409,
      error: "reading_required",
      reading: MISREAD,
      observationId: "obs-1",
    });
    expect(correctVisualObservations).not.toHaveBeenCalled();
    expect(ingestTextToNode).not.toHaveBeenCalled();
    expect(attachSource).not.toHaveBeenCalled();
    expect(markNameplateDocVerified).not.toHaveBeenCalled();
  });

  it("refuses a reviewed reading that is empty after trim", async () => {
    expect(await keep({ reviewedReading: "   " })).toEqual({ ok: false, status: 409, error: "no_photo_reading" });
    expect(correctVisualObservations).not.toHaveBeenCalled();
    expect(ingestTextToNode).not.toHaveBeenCalled();
  });

  it("refuses to attest a review without an owner", async () => {
    expect(await keep({ userId: null, reviewedReading: REVIEWED })).toEqual({
      ok: false,
      status: 409,
      error: "reading_required",
      reading: MISREAD,
      observationId: "obs-1",
    });
    expect(correctVisualObservations).not.toHaveBeenCalled();
    expect(ingestTextToNode).not.toHaveBeenCalled();
  });

  it("corrects the F53/150 misread, ingests the reviewed text, and marks the source verified", async () => {
    expect(await keep({ reviewedReading: REVIEWED, threadId: "thrd-1" })).toEqual({
      ok: true,
      docId: "doc-1",
      alreadyKept: false,
      chunkCount: 2,
    });

    expect(correctVisualObservations).toHaveBeenCalledWith({
      tenantId: TENANT,
      boundEntityId: null,
      fileId: PHOTO,
      corrections: [{ observationId: "obs-1", value: REVIEWED }],
      correctedBy: "user-1",
      conversation: { notebookId: NOTEBOOK.id, ownerUserId: "user-1", threadId: "thrd-1" },
    });

    const ingested = vi.mocked(ingestTextToNode).mock.calls[0][0];
    expect(ingested.nodeId).toBe(NOTEBOOK.nodeId);
    expect(ingested.filename).toBe("Technician-confirmed photo reading 2026-10-23.txt");
    const stored = ingested.buffer.toString("utf8");
    expect(stored).toContain("F55.3");
    expect(stored).toContain("/15.0");
    expect(stored).toContain("technician reviewed this photo reading");
    expect(stored).not.toContain(MISREAD);

    expect(markNameplateDocVerified).toHaveBeenCalledWith(TENANT, "doc-1");
    expect(attachSource).toHaveBeenCalledWith(TENANT, NOTEBOOK.id, "doc-1", {
      matchState: "user_confirmed",
      sourceRole: "photo",
      addedBy: "user-1",
      originFileId: PHOTO,
      matchEvidence: { kept_from_observation: "obs-replaced" },
    });
    expect(supersedePriorOriginSources).toHaveBeenCalledWith(TENANT, NOTEBOOK.id, PHOTO, "doc-1");
  });

  it("still corrects and verifies when the technician keeps the proposed reading as-is", async () => {
    expect(await keep({ reviewedReading: MISREAD })).toEqual({
      ok: true,
      docId: "doc-1",
      alreadyKept: false,
      chunkCount: 2,
    });
    expect(correctVisualObservations).toHaveBeenCalledWith({
      tenantId: TENANT,
      boundEntityId: null,
      fileId: PHOTO,
      corrections: [{ observationId: "obs-1", value: MISREAD }],
      correctedBy: "user-1",
      conversation: { notebookId: NOTEBOOK.id, ownerUserId: "user-1", threadId: "legacy" },
    });
    expect(vi.mocked(ingestTextToNode).mock.calls[0][0].filename).toBe("Technician-confirmed photo reading 2026-10-23.txt");
    expect(markNameplateDocVerified).toHaveBeenCalledWith(TENANT, "doc-1");
  });

  it("does not ingest when correctVisualObservations applies no correction", async () => {
    vi.mocked(correctVisualObservations).mockResolvedValueOnce({ corrected: [], mismatched: [] });
    expect(await keep({ reviewedReading: REVIEWED })).toEqual({
      ok: false,
      status: 409,
      error: "correction_not_applied",
    });
    expect(ingestTextToNode).not.toHaveBeenCalled();
    expect(attachSource).not.toHaveBeenCalled();
    expect(markNameplateDocVerified).not.toHaveBeenCalled();
  });

  it("keeps the reading from the conversation the technician pressed Keep in", async () => {
    await keep({ threadId: "thrd-1" });
    expect(vi.mocked(loadVisualEvidenceForPhoto).mock.calls[0][3]).toEqual({
      notebookId: NOTEBOOK.id,
      ownerUserId: "user-1",
      threadId: "thrd-1",
    });
  });

  it("scopes the load to the notebook owner, using the legacy thread when none is given", async () => {
    await keep();
    expect(vi.mocked(loadVisualEvidenceForPhoto).mock.calls[0][3]).toEqual({
      notebookId: NOTEBOOK.id,
      ownerUserId: "user-1",
      threadId: "legacy",
    });
  });

  it("loads the latest reading when there is no owner to scope by", async () => {
    await keep({ userId: null });
    expect(vi.mocked(loadVisualEvidenceForPhoto).mock.calls[0][3]).toBeUndefined();
  });

  it("fails closed when the source row cannot be attached", async () => {
    vi.mocked(attachSource).mockResolvedValueOnce({ ok: false, error: "notebook_not_found" });
    expect(await keep({ reviewedReading: REVIEWED })).toEqual({
      ok: false,
      status: 503,
      error: "attach_source_failed:notebook_not_found",
    });
    expect(supersedePriorOriginSources).not.toHaveBeenCalled();
  });
});

describe("materializeDerivedTextDoc", () => {
  const args = { tenantId: TENANT, nodeId: NOTEBOOK.nodeId, filename: "x.txt", text: "hello", createdBy: null, source: "photo_text" };

  it("reuses an already-ingested identical document without ingesting again", async () => {
    vi.mocked(parkOrReuseFile).mockResolvedValueOnce({ fileId: "text-file-1", uploadId: "doc-old" } as never);
    expect(await materializeDerivedTextDoc(args)).toEqual({ docId: "doc-old", chunkCount: 0 });
    expect(claimIngest).not.toHaveBeenCalled();
    expect(ingestTextToNode).not.toHaveBeenCalled();
  });

  it("does not ingest a second copy while another request holds the claim", async () => {
    vi.mocked(claimIngest).mockResolvedValueOnce({ claimed: false, reason: "ingest_in_progress", uploadId: null } as never);
    expect(await materializeDerivedTextDoc(args)).toEqual({ docId: null, chunkCount: 0 });
    expect(ingestTextToNode).not.toHaveBeenCalled();
  });

  it("deletes its own chunk set when it loses the claim fence", async () => {
    vi.mocked(linkFileToUpload).mockResolvedValueOnce(false);
    expect(await materializeDerivedTextDoc(args)).toEqual({ docId: null, chunkCount: 0 });
    expect(deleteOrphanNodeIngest).toHaveBeenCalledWith(TENANT, "doc-1");
  });
});

describe("citesOnlyUnconfirmedPhotoReadings", () => {
  const photoCite = { docId: "doc-photo", originFileId: PHOTO };
  const manualCite = { docId: "doc-manual", originFileId: null };

  it("is true when every citation is a kept photo reading with no verified chunk", () => {
    expect(citesOnlyUnconfirmedPhotoReadings([photoCite], [{ docId: "doc-photo", verified: false }])).toBe(true);
  });

  it("is false for a confirmed nameplate, whose chunks the technician verified", () => {
    expect(citesOnlyUnconfirmedPhotoReadings([photoCite], [{ docId: "doc-photo", verified: true }])).toBe(false);
  });

  it("is false when a manual is cited alongside the photo reading", () => {
    expect(citesOnlyUnconfirmedPhotoReadings([photoCite, manualCite], [{ docId: "doc-photo", verified: false }])).toBe(false);
  });

  it("is false with no citations", () => {
    expect(citesOnlyUnconfirmedPhotoReadings([], [])).toBe(false);
  });
});
