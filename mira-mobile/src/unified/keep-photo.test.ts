import { describe, expect, it, vi } from "vitest";
import { keepMobilePhoto } from "./keep-photo";

const NB = "dfe74725-a4ac-4c5f-8e8c-1f06002daf0f";
const PHOTO = "f803bb1e-325e-46fd-a1a7-4421425c1f3e";
const OBS = "64a24de7-0000-4000-8000-000000000002";

describe("keepMobilePhoto", () => {
  it("sends the reviewed reading and does not mark success when refresh fails", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({
        status: 409,
        data: { error: "reading_required", reading: "-F53.3 /150", observationId: OBS },
      })
      .mockResolvedValueOnce({ status: 200, data: { docId: "doc-1" } });
    const refresh = vi.fn(async () => false);
    await expect(keepMobilePhoto(PHOTO, {
      notebookId: NB,
      threadId: "legacy",
      request,
      refresh,
      review: async () => "-F55.3 /15.0",
    })).rejects.toThrow("keep_photo_refresh_failed");
    expect(request).toHaveBeenNthCalledWith(1, `/api/equipment-notebooks/${NB}/photos/${PHOTO}/source/`, expect.objectContaining({
      method: "POST",
      acceptStatuses: [409],
      json: { threadId: "legacy" },
    }));
    expect(request).toHaveBeenNthCalledWith(2, `/api/equipment-notebooks/${NB}/photos/${PHOTO}/source/`, expect.objectContaining({
      json: { threadId: "legacy", reviewedReading: "-F55.3 /15.0" },
    }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("a refresh-only retry is a second Keep of an already-stored source, never a silent rewrite", async () => {
    const request = vi.fn().mockResolvedValue({ status: 200, data: { docId: "doc-1", alreadyKept: true } });
    const review = vi.fn(async () => "should-not-run");
    await keepMobilePhoto(PHOTO, {
      notebookId: NB,
      threadId: null,
      request,
      refresh: async () => true,
      review,
    });
    expect(review).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
  });
});
