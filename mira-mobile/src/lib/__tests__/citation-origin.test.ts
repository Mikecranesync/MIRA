// 085: the canonical origin rides the citation itself, server-resolved. The
// normalizer must carry it (live SSE frames AND persisted-turn evidence go
// through the same mapping) — a dropped field here silently reverts the
// citation-opens-the-sidecar defect the server fix closed.
//
// Run: cd mira-mobile && bunx vitest run src/lib/__tests__/citation-origin

import { describe, it, expect } from "vitest";
import { normalizeCitations } from "../sse";

describe("normalizeCitations originFileId", () => {
  it("carries the server-resolved canonical origin", () => {
    const [c] = normalizeCitations([
      { citationId: "1", sourceTitle: "nameplate.txt", docId: "d1", fileId: "txt", originFileId: "photo" },
    ]);
    expect(c.originFileId).toBe("photo");
    expect(c.fileId).toBe("txt");
  });

  it("is null (never invented) for ordinary documents and pre-085 evidence", () => {
    const [c] = normalizeCitations([
      { citationId: "1", sourceTitle: "manual.pdf", docId: "d2", fileId: "pdf" },
    ]);
    expect(c.originFileId).toBeNull();
  });
});
