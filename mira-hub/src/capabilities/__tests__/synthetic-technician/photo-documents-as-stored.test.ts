// The photo-document fixtures in bench.ts, checked against what the hub would
// actually store: its own chunker over the full text, first block, as
// `document_heading` is read (left(first chunk, 2000)). A fixture that only
// resembles the stored text proves nothing about the stored text.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn(async () => undefined) }));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));

import { chunkText } from "@/lib/node-knowledge-ingest";
import { manualAnswersFor, unlistedModelNumbers } from "../../manual-applicability";
import { buildPhotoSourceText, photoDocumentBody } from "../../photo-document-text";
import { PHOTO_DOCUMENT_TEXTS } from "./bench";

const storedHeading = (text: string) => chunkText(text)[0].slice(0, 2000);

describe("photo documents as the hub stores them", () => {
  it.each(PHOTO_DOCUMENT_TEXTS.map(([m, text]) => [m.key, m.heading, text] as const))("%s: the fixture is the stored first block", (_key, heading, text) => {
    expect(storedHeading(text)).toBe(heading);
    expect(photoDocumentBody(heading)).not.toBe("");
  });

  // A long reading is cut into blocks. Whatever the cut, the first block is
  // still recognised, and the part of the reading in view still decides.
  it.each([true, false])("a reading longer than one block keeps its marker and its first lines in view (reviewed=%s)", (reviewed) => {
    const text = buildPhotoSourceText({
      machineName: "CV-101",
      fileId: "0b6f4c1e-7a2d-4e59-9c3a-5d1f8e2b7a40",
      photoSha256: "9f2c41d07be35a68c1d2e4f5a6b7c8d90e1f2a3b4c5d6e7f8091a2b3c4d5e6f7",
      capturedAt: "2026-11-09T14:32:08.000Z",
      reviewed,
      observation: `Relay CA3KN22BD, 24 V DC coil. ${"Terminal markings are legible and match the drawing. ".repeat(40)}`,
    });
    expect(text.length).toBeGreaterThan(2000);
    const heading = storedHeading(text);
    expect(photoDocumentBody(heading)).toContain("Relay CA3KN22BD");
    expect(manualAnswersFor(unlistedModelNumbers("coil voltage of the CA3KN22BD?"), heading, "x.txt")).toEqual({ admit: true });
    expect(manualAnswersFor(unlistedModelNumbers("coil voltage of the CA3KN31BD?"), heading, "x.txt")).toMatchObject({ admit: false, kind: "other-model", reading: true });
    expect(manualAnswersFor(unlistedModelNumbers("What is saved for CV-101?"), heading, "x.txt")).toEqual({ admit: true });
  });
});
