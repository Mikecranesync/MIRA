/**
 * #4784 — an attached manual shows its indexing state, and a question about it
 * is not sent while the manual is still being indexed.
 */
import { describe, expect, it } from "vitest";

import { indexingStateFor, pollDecision } from "./upload-indexing-state";

describe("indexingStateFor", () => {
  it("reports indexed once the parked original is linked to an upload", () => {
    expect(indexingStateFor({ indexable: true, indexed: true, claimLive: false })).toBe("indexed");
    expect(indexingStateFor({ indexable: true, indexed: true, claimLive: true })).toBe("indexed");
  });

  it("reports parsing while a live ingest claim holds the file", () => {
    expect(indexingStateFor({ indexable: true, indexed: false, claimLive: true })).toBe("parsing");
  });

  it("reports failed for an indexable file with no upload and no live claim", () => {
    expect(indexingStateFor({ indexable: true, indexed: false, claimLive: false })).toBe("failed");
  });

  it("reports no indexing state for files that are never indexed by design", () => {
    expect(indexingStateFor({ indexable: false, indexed: false, claimLive: false })).toBeNull();
  });
});

describe("pollDecision", () => {
  it("is ready only when indexed", () => {
    expect(pollDecision("indexed")).toBe("ready");
  });

  it("waits while queued, parsing or chunking", () => {
    expect(pollDecision("queued")).toBe("wait");
    expect(pollDecision("parsing")).toBe("wait");
    expect(pollDecision("chunking")).toBe("wait");
  });

  it("fails when failed, missing, or not indexable", () => {
    expect(pollDecision("failed")).toBe("failed");
    expect(pollDecision(null)).toBe("failed");
    expect(pollDecision(undefined)).toBe("failed");
  });
});
