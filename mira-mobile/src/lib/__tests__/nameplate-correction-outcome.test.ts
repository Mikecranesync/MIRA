// Slice 3 honesty gate for the technician's EDITS (Codex round 2 F1).
//
// The defect this pins down: the confirm route is fail-safe by design (the
// nameplate document is its primary deliverable), so a correction the server
// could not apply used to come back as `visualCorrectedCount: 0` inside a
// successful confirm — and the flow reached `complete` while the misread
// vision reading was still the active one. Now the server names the failure
// and the reducer refuses `complete` unless every requested correction landed.
//
// Run: cd mira-mobile && npx vitest run src/lib/__tests__/nameplate-correction-outcome
import { describe, expect, it } from "vitest";
import {
  correctionsNotSaved,
  nameplateErrorCopy,
  nameplateReducer,
  type NameplateState,
} from "../nameplate-flow";
import type { ConfirmComponentResult, ComponentIdentity } from "../../api/resources";
import { EMPTY_COMPONENT_IDENTITY } from "../../api/resources";

const IDENTITY: ComponentIdentity = { ...EMPTY_COMPONENT_IDENTITY, manufacturer: "Automation Direct", model: "GS10" };

/** A confirm that really did add a citable source — the only shape that may become `complete`. */
function okResult(over: Partial<ConfirmComponentResult> = {}): ConfirmComponentResult {
  return {
    status: "complete",
    manual: {
      fileId: "f-manual",
      docId: "d1",
      filename: "gs10.pdf",
      matchState: "verified",
      enabledByDefault: true,
      indexed: true,
      chunkCount: 12,
      discoveryUrl: null,
      finalUrl: null,
    },
    candidate: null,
    applicability: null,
    message: null,
    warning: null,
    visualPromotedCount: 0,
    visualCorrectedCount: 0,
    visualCorrectionMismatches: [],
    visualCorrectionFailed: false,
    ...over,
  };
}

const searching: NameplateState = { name: "searching", fileId: "f-photo", identity: IDENTITY };

describe("correctionsNotSaved — every requested correction must have landed", () => {
  it("nothing requested → nothing to save, never blocks", () => {
    expect(correctionsNotSaved(0, okResult({ visualCorrectionFailed: true }))).toBe(false);
  });
  it("all applied → saved", () => {
    expect(correctionsNotSaved(2, okResult({ visualCorrectedCount: 2 }))).toBe(false);
  });
  it("server could not apply them (transient DB error / supersede race) → not saved, even if the count is 0", () => {
    expect(correctionsNotSaved(1, okResult({ visualCorrectedCount: 0, visualCorrectionFailed: true }))).toBe(true);
  });
  it("fewer applied than requested → not saved", () => {
    expect(correctionsNotSaved(2, okResult({ visualCorrectedCount: 1 }))).toBe(true);
  });
  it("a correction refused for contradicting the confirmed identity counts as not saved", () => {
    expect(
      correctionsNotSaved(1, okResult({ visualCorrectedCount: 0, visualCorrectionMismatches: [{ observationId: "o-model", field: "model" }] })),
    ).toBe(true);
  });
  it("a server that predates the fields (undefined) is read as nothing applied", () => {
    const legacy = okResult();
    delete legacy.visualCorrectedCount;
    delete legacy.visualCorrectionFailed;
    expect(correctionsNotSaved(1, legacy)).toBe(true);
    expect(correctionsNotSaved(0, legacy)).toBe(false);
  });
});

describe("nameplateReducer — `complete` is refused while an edit did not land", () => {
  it("server applied every requested correction → complete", () => {
    const s = nameplateReducer(searching, { type: "confirm_result", result: okResult({ visualCorrectedCount: 1 }), correctionsRequested: 1 });
    expect(s.name).toBe("complete");
  });

  it("server could not apply the correction → error corrections_not_saved, photo + identity kept for the retry", () => {
    const s = nameplateReducer(searching, {
      type: "confirm_result",
      result: okResult({ visualCorrectedCount: 0, visualCorrectionFailed: true }),
      correctionsRequested: 1,
    });
    expect(s.name).toBe("error");
    if (s.name === "error") {
      expect(s.reason).toBe("corrections_not_saved");
      expect(s.fileId).toBe("f-photo");
      expect(s.identity).toEqual(IDENTITY);
    }
  });

  it("one of two corrections did not land → error, not complete (a partial save is not a save)", () => {
    const s = nameplateReducer(searching, { type: "confirm_result", result: okResult({ visualCorrectedCount: 1 }), correctionsRequested: 2 });
    expect(s.name).toBe("error");
    if (s.name === "error") expect(s.reason).toBe("corrections_not_saved");
  });

  it("the gate also overrides candidate_review — a proposed manual must not hide unsaved edits", () => {
    const s = nameplateReducer(searching, {
      type: "confirm_result",
      result: okResult({ status: "candidate_review", visualCorrectionFailed: true }),
      correctionsRequested: 1,
    });
    expect(s.name).toBe("error");
  });

  it("no corrections requested → the existing outcomes are untouched", () => {
    const s = nameplateReducer(searching, { type: "confirm_result", result: okResult({ visualCorrectionFailed: true }) });
    expect(s.name).toBe("complete");
  });

  it("the copy tells the technician what to do", () => {
    expect(nameplateErrorCopy("corrections_not_saved")).toMatch(/weren't saved/);
  });
});
