// EVID-3: every intake failure keeps its server-given reason.
//
// The defect this pins down: five distinct server conditions (415 format,
// 413 size, 503 not-configured, 502 provider, real unreadable plate) all
// rendered as "Couldn't read the nameplate" because the client discarded the
// reason. That sentence is now reserved for a photo the recognizer actually
// looked at and could not read.
//
// Run: cd mira-mobile && npx vitest run src/lib/__tests__/nameplate-reasons

import { describe, it, expect } from "vitest";
import {
  reasonFromRecognizeError,
  nameplateErrorCopy,
  nameplateReducer,
  INITIAL_NAMEPLATE_STATE,
  type NameplateState,
} from "../nameplate-flow";

/** Shaped like ApiError without importing the transport layer. */
const apiErr = (status: number | null, detail = "") => ({ status, detail });

describe("reasonFromRecognizeError", () => {
  it("maps each server status to its own reason", () => {
    expect(reasonFromRecognizeError(apiErr(415, "unsupported_image_type"))).toBe(
      "unsupported_image_type",
    );
    expect(reasonFromRecognizeError(apiErr(413, "image_too_large"))).toBe("image_too_large");
    expect(reasonFromRecognizeError(apiErr(503, "recognizer_not_configured"))).toBe(
      "recognizer_unavailable",
    );
    expect(reasonFromRecognizeError(apiErr(502, "provider exploded"))).toBe("provider_error");
  });

  it("never invents a cause for anything else", () => {
    expect(reasonFromRecognizeError(apiErr(null, "network down"))).toBe("upload_failed");
    expect(reasonFromRecognizeError(new Error("boom"))).toBe("upload_failed");
    expect(reasonFromRecognizeError(undefined)).toBe("upload_failed");
  });
});

describe("each reason renders its own sentence", () => {
  it("distinct copy per intake failure — no collapse", () => {
    const sentences = [
      "unsupported_image_type",
      "image_too_large",
      "recognizer_unavailable",
      "provider_error",
      "unreadable_nameplate",
    ].map((r) => nameplateErrorCopy(r as never));
    expect(new Set(sentences).size).toBe(sentences.length);
  });

  it('reserves "Couldn\'t read the nameplate" for the genuinely unreadable case', () => {
    expect(nameplateErrorCopy("unreadable_nameplate")).toMatch(/read the nameplate/i);
    expect(nameplateErrorCopy("unsupported_image_type")).not.toMatch(/read the nameplate/i);
    expect(nameplateErrorCopy("image_too_large")).not.toMatch(/read the nameplate/i);
  });
});

describe("the reducer carries the reason through recognize_failed", () => {
  it("keeps a server-given reason instead of the default", () => {
    let s: NameplateState = INITIAL_NAMEPLATE_STATE;
    s = nameplateReducer(s, { type: "photo_selected" });
    s = nameplateReducer(s, { type: "upload_finished" });
    s = nameplateReducer(s, { type: "recognize_failed", reason: "image_too_large" });
    expect(s).toMatchObject({ name: "error", reason: "image_too_large" });
  });
});
