import { describe, it, expect } from "vitest";
import type { LookResult } from "../../api/resources";
import {
  lookRefusal,
  PHOTO_ANALYSIS_UNAVAILABLE,
  PHOTO_NOT_LINKED,
  PHOTO_NOT_SAVED,
  PHOTO_UPLOAD_FAILED,
} from "../look-gate";

const good: LookResult = {
  fileId: "f-1",
  attachment: { linkId: "l-1", notebookId: "n-1" },
  observation: { text: "A GS10 drive showing oC", capturedAt: "2026-09-28T00:00:00Z", provenance: "phone_photo" },
  reason: null,
  message: null,
  quality: null,
  observationPersisted: true,
};

describe("lookRefusal — a photo rides a question only if chat can ground on it", () => {
  it("lets a parked, read, linked, saved photo ride", () => {
    expect(lookRefusal(good)).toBeNull();
  });

  it("refuses when the photo never uploaded", () => {
    expect(lookRefusal({ ...good, fileId: "" })).toBe(PHOTO_UPLOAD_FAILED);
  });

  it("refuses when vision could not read it", () => {
    expect(lookRefusal({ ...good, observation: null })).toBe(PHOTO_ANALYSIS_UNAVAILABLE);
  });

  it("refuses when the photo is not linked to this notebook (chat ignores it)", () => {
    expect(lookRefusal({ ...good, attachment: null })).toBe(PHOTO_NOT_LINKED);
    expect(lookRefusal({ ...good, attachment: { linkId: "", notebookId: "n-1" } })).toBe(PHOTO_NOT_LINKED);
  });

  it("refuses when the observation was read but not saved (#4082)", () => {
    expect(lookRefusal({ ...good, observationPersisted: false })).toBe(PHOTO_NOT_SAVED);
  });
});
