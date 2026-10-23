import { describe, expect, it } from "vitest";
import {
  KEEP_PHOTO_REVIEW_PROMPT,
  mergeKeptDocIntoScope,
  nextKeepPhotoStep,
  reviewedReadingFromPrompt,
} from "./keep-photo";

describe("nextKeepPhotoStep — a wrong reading cannot be kept silently (#4643)", () => {
  it("asks the host to show the stored reading when Keep has no review", () => {
    expect(nextKeepPhotoStep(409, {
      error: "reading_required",
      reading: "Protected by -F53.3",
      observationId: "obs-1",
    })).toEqual({ action: "review", reading: "Protected by -F53.3" });
  });

  it("treats a 200 with a docId as kept", () => {
    expect(nextKeepPhotoStep(200, { docId: "doc-1", alreadyKept: false, chunkCount: 2 })).toEqual({
      action: "done", docId: "doc-1", alreadyKept: false,
    });
  });

  it("does not treat an empty reading_required body as something to review", () => {
    expect(nextKeepPhotoStep(409, { error: "reading_required", reading: "   " })).toEqual({
      action: "fail", error: "reading_required",
    });
  });

  it("passes other refusals through as failures", () => {
    expect(nextKeepPhotoStep(409, { error: "no_photo_reading" })).toEqual({
      action: "fail", error: "no_photo_reading",
    });
    expect(nextKeepPhotoStep(503, null)).toEqual({ action: "fail", error: "keep_photo_503" });
  });
});

describe("reviewedReadingFromPrompt", () => {
  it("returns the technician's edit", () => {
    expect(reviewedReadingFromPrompt("F53.3", (msg, value) => {
      expect(msg).toBe(KEEP_PHOTO_REVIEW_PROMPT);
      expect(value).toBe("F53.3");
      return "F55.3";
    })).toBe("F55.3");
  });

  it("treats cancel or a blank edit as no keep", () => {
    expect(reviewedReadingFromPrompt("F53.3", () => null)).toBeNull();
    expect(reviewedReadingFromPrompt("F53.3", () => "   ")).toBeNull();
  });
});

describe("mergeKeptDocIntoScope — a failed refresh must not drop the kept doc (#4648)", () => {
  it("adds the returned docId to an empty or existing next-send scope", () => {
    expect(mergeKeptDocIntoScope(null, "doc-1")).toEqual(["doc-1"]);
    expect(mergeKeptDocIntoScope(["doc-a"], "doc-1")).toEqual(["doc-a", "doc-1"]);
  });

  it("does not duplicate a doc already in scope", () => {
    expect(mergeKeptDocIntoScope(["doc-1"], "doc-1")).toEqual(["doc-1"]);
  });

  it("preserves the current scope when the keep produced no docId", () => {
    expect(mergeKeptDocIntoScope(["doc-a"], "")).toEqual(["doc-a"]);
  });
});
