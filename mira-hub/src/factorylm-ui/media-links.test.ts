import { describe, expect, it } from "vitest";
import { API_BASE } from "@/lib/config";
import type { EvidenceCitation, VisualObservationEntry } from "@/lib/notebook-chat-types";
import { citationHref, fileUrl, sourceFor, visualObservationPart } from "./to-interaction";

// Photo thumbnails and openable references in the /v3 shell (owner ask
// 2026-10-05). The adapter says where the bytes live; the shell renders them.
const base: EvidenceCitation = { citationId: "1", docId: "doc-1", sourceTitle: "GS10 User Manual", page: 47, fileId: null, quote: "q" };

describe("fileUrl — the existing byte route the classic notebook and mobile already use", () => {
  it("serves a parked original by id", () => {
    expect(fileUrl("f-1")).toBe(`${API_BASE}/api/namespace/files/f-1/`);
  });
  it("encodes the id", () => {
    expect(fileUrl("a/b")).toBe(`${API_BASE}/api/namespace/files/a%2Fb/`);
  });
});

describe("citationHref — the classic source page's rule", () => {
  it("a parked document opens at its cited page", () => {
    expect(citationHref({ ...base, fileId: "f-1" })).toBe(`${API_BASE}/api/namespace/files/f-1/#page=47`);
  });
  it("without a page it opens at the start", () => {
    expect(citationHref({ ...base, fileId: "f-1", page: null })).toBe(`${API_BASE}/api/namespace/files/f-1/`);
  });
  it("the canonical origin wins: a photo-derived doc opens the photograph, which has no page (085)", () => {
    expect(citationHref({ ...base, fileId: "ocr-sidecar", originFileId: "photo-9" })).toBe(`${API_BASE}/api/namespace/files/photo-9/`);
  });
  it("a manufacturer manual opens at its own web address, at the cited page", () => {
    expect(citationHref({ ...base, sourceUrl: "https://lit.example.com/gs10.pdf" })).toBe("https://lit.example.com/gs10.pdf#page=47");
    expect(citationHref({ ...base, sourceUrl: "https://lit.example.com/gs10.pdf#nameddest=x" })).toBe("https://lit.example.com/gs10.pdf#nameddest=x");
  });
  it("control — nothing parked and no web address: nothing to open", () => {
    expect(citationHref(base)).toBeUndefined();
    expect(citationHref({ ...base, sourceUrl: "hub-upload://tenant/file.pdf" })).toBeUndefined();
    expect(citationHref({ ...base, sourceUrl: "javascript:alert(1)" })).toBeUndefined();
  });
});

describe("parts carry the address", () => {
  it("a source part carries href when there is something to open", () => {
    expect(sourceFor({ ...base, fileId: "f-1" }, "t").href).toBe(`${API_BASE}/api/namespace/files/f-1/#page=47`);
    expect(sourceFor(base, "t")).not.toHaveProperty("href");
  });
  it("a photo observation carries the photo's address", () => {
    const entry: VisualObservationEntry = { kind: "visual_observation", fileId: "f9fdad9c", capturedAt: "2026-10-01T00:08:07.818Z", provenance: "phone_photo" };
    expect(visualObservationPart(entry)).toEqual({
      type: "visual_observation",
      observation: { fileId: "f9fdad9c", capturedAt: "2026-10-01T00:08:07.818Z", provenance: "phone_photo", verified: false, previewUrl: `${API_BASE}/api/namespace/files/f9fdad9c/` },
    });
  });
});
