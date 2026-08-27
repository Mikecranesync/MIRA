// Pure half of the platform handoff (Phase 3 item 3). The bridge/share side
// is device-gated (Phase 4); these pin the size honesty and the cache-name
// sanitizer that the viewer app's handler selection depends on.
//
// Run: cd mira-mobile && bunx vitest run src/lib/__tests__/open-with

import { describe, it, expect } from "vitest";
import { HANDOFF_MAX_BYTES, handoffTooLarge, safeHandoffName } from "../open-with";

describe("handoffTooLarge", () => {
  it("caps exactly at the limit", () => {
    expect(handoffTooLarge(HANDOFF_MAX_BYTES)).toBe(false);
    expect(handoffTooLarge(HANDOFF_MAX_BYTES + 1)).toBe(true);
  });
});

describe("safeHandoffName", () => {
  it("keeps the extension the viewer picks its handler by", () => {
    expect(safeHandoffName("GS10 manual (rev B).pdf")).toBe("GS10_manual_rev_B_.pdf");
  });
  it("never emits a path escape or hidden file", () => {
    expect(safeHandoffName("../../etc/passwd")).toBe("etc_passwd");
    expect(safeHandoffName(".hidden")).toBe("hidden");
  });
  it("falls back rather than writing an empty name", () => {
    expect(safeHandoffName("///")).toBe("document");
  });
});

// isText routing lives in FilePreview (same PR): text/* + JSON render
// in-app; parameters and case don't break the match.
import { isText } from "../../screens/FilePreview";

describe("isText", () => {
  it("matches text/* with charset params and JSON", () => {
    expect(isText("text/plain; charset=utf-8")).toBe(true);
    expect(isText("Text/Plain")).toBe(true);
    expect(isText("application/json")).toBe(true);
  });
  it("rejects images and PDFs", () => {
    expect(isText("image/jpeg")).toBe(false);
    expect(isText("application/pdf")).toBe(false);
  });
});
