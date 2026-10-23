import { describe, expect, it, vi } from "vitest";
import { keepPhotoWithReview, type PhotoKeepTransport } from "./keep-photo-review";

const READING = {
  observationId: "64a24de7-0000-4000-8000-000000000002",
  reading: "Coach 3 is protected by -F53.3. Aux /150",
};
const CORRECTED = "Coach 3 is protected by -F55.3. Aux /15.0";

function transport(over: Partial<PhotoKeepTransport> & Pick<PhotoKeepTransport, "post">): PhotoKeepTransport {
  return {
    refresh: vi.fn(async () => true),
    review: vi.fn(async (proposed) => proposed.reading),
    ...over,
  };
}

describe("keepPhotoWithReview — #4643 correct-before-keep + #4648 refresh honesty", () => {
  it("refuses to finish Keep until the technician reviews the stored reading", async () => {
    const post = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        body: { error: "reading_required", ...READING },
      })
      .mockResolvedValueOnce({ ok: true, status: 200, body: { docId: "doc-1" } });
    const review = vi.fn(async () => CORRECTED);
    const refresh = vi.fn(async () => true);
    await keepPhotoWithReview("thread-1", transport({ post, review, refresh }));
    expect(review).toHaveBeenCalledWith(READING);
    expect(post).toHaveBeenNthCalledWith(2, { threadId: "thread-1", reviewedReading: CORRECTED });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not write when the technician cancels the review", async () => {
    const post = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      body: { error: "reading_required", ...READING },
    });
    const refresh = vi.fn(async () => true);
    await expect(keepPhotoWithReview("thread-1", transport({
      post,
      review: async () => null,
      refresh,
    }))).rejects.toThrow("keep_photo_cancelled");
    expect(post).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each([false, "throw"] as const)("a successful Keep whose refresh is %s is not success", async (outcome) => {
    const post = vi.fn().mockResolvedValue({ ok: true, status: 200, body: { docId: "doc-1" } });
    const refresh = outcome === "throw"
      ? vi.fn(async () => { throw new Error("offline"); })
      : vi.fn(async () => false);
    await expect(keepPhotoWithReview("thread-1", transport({ post, refresh }))).rejects.toThrow("keep_photo_refresh_failed");
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("a failed write never refreshes and never looks kept", async () => {
    const post = vi.fn().mockResolvedValue({ ok: false, status: 503, body: { error: "photo_source_in_progress" } });
    const refresh = vi.fn(async () => true);
    await expect(keepPhotoWithReview(undefined, transport({ post, refresh }))).rejects.toThrow("keep_photo_503");
    expect(refresh).not.toHaveBeenCalled();
  });
});
