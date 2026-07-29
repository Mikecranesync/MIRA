import { describe, it, expect } from "vitest";
import {
  SUPPORTED_MIMES,
  SUPPORTED_TEXT_MIMES,
  isTextMime,
  inferKindFromMime,
} from "../mira-ingest-client";
import { isMimeCompatible, sniffMime } from "../sniff-mime";

/**
 * #2277 — the upload gate accepts text/markdown + text/plain, routes them as
 * documents, and the magic-byte sniff (which has no signature for text) accepts
 * a well-formed text file while still rejecting a text file that is actually a
 * binary in disguise.
 */
describe("#2277 text upload allowlist + sniff", () => {
  it("SUPPORTED_MIMES accepts markdown + plain", () => {
    expect(SUPPORTED_MIMES.has("text/markdown")).toBe(true);
    expect(SUPPORTED_MIMES.has("text/plain")).toBe(true);
    // Did not regress the existing types.
    expect(SUPPORTED_MIMES.has("application/pdf")).toBe(true);
    expect(SUPPORTED_MIMES.has("image/png")).toBe(true);
    // A genuinely unsupported type stays out.
    expect(SUPPORTED_MIMES.has("application/zip")).toBe(false);
  });

  it("isTextMime is true only for the two text types", () => {
    for (const m of SUPPORTED_TEXT_MIMES) expect(isTextMime(m)).toBe(true);
    expect(isTextMime("application/pdf")).toBe(false);
    expect(isTextMime("image/png")).toBe(false);
    expect(isTextMime(null)).toBe(false);
    expect(isTextMime(undefined)).toBe(false);
  });

  it("text routes as a document, not a photo", () => {
    expect(inferKindFromMime("text/markdown")).toBe("document");
    expect(inferKindFromMime("text/plain")).toBe("document");
  });

  it("sniff accepts a real text file (null signature) for a text MIME", () => {
    const md = new TextEncoder().encode("# Procedure\nStep 1: ...");
    expect(sniffMime(md.subarray(0, 16))).toBeNull();
    expect(isMimeCompatible("text/markdown", null)).toBe(true);
    expect(isMimeCompatible("text/plain", null)).toBe(true);
  });

  it("sniff rejects a binary-in-disguise text upload", () => {
    // A .txt whose bytes start with %PDF- sniffs as pdf → declared text is a spoof.
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    expect(sniffMime(pdfBytes)).toBe("pdf");
    expect(isMimeCompatible("text/plain", "pdf")).toBe(false);
    expect(isMimeCompatible("text/markdown", "png")).toBe(false);
  });

  it("did not weaken binary compatibility", () => {
    expect(isMimeCompatible("application/pdf", "pdf")).toBe(true);
    expect(isMimeCompatible("application/pdf", null)).toBe(false);
    expect(isMimeCompatible("image/png", "jpeg")).toBe(true);
    expect(isMimeCompatible("image/png", null)).toBe(false);
  });
});
