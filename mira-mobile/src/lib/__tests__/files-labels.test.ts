// processingLabel — the technician-facing truth about whether a file can be
// searched. EVID-4: a photo whose text was read (OCR) is `indexed:true` while
// its capability stays "viewable"; the label must follow the server's truth,
// not the mime type.
//
// Run: cd mira-mobile && npx vitest run src/lib/__tests__/files-labels

import { describe, it, expect } from "vitest";
import { processingLabel } from "../../screens/FilesScreen";

describe("processingLabel", () => {
  it("an OCR'd photo (viewable + indexed) is a searchable source", () => {
    expect(processingLabel({ capability: "viewable", indexed: true })).toBe("Searchable source · indexed");
  });

  it("a photo that was not read stays a viewable attachment", () => {
    expect(processingLabel({ capability: "viewable", indexed: false })).toBe("Viewable attachment");
  });

  it("an indexable document reports its processing state honestly", () => {
    expect(processingLabel({ capability: "indexable", indexed: false })).toBe("Indexing—not searchable yet");
    expect(processingLabel({ capability: "indexable", indexed: true })).toBe("Searchable source · indexed");
  });

  it("a stored-only file never claims search", () => {
    expect(processingLabel({ capability: "stored", indexed: false })).toBe("Stored file—not searchable in chat");
  });
});
