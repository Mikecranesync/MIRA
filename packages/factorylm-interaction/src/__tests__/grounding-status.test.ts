/**
 * F004 (#4303): the shared reader of the server's `grounding_status` entry.
 * Run: cd apps/factorylm-ui-lab && bun test ../../packages/factorylm-interaction/src/__tests__/grounding-status.test.ts
 */
import { describe, expect, it } from "bun:test";
import {
  fallbackSourceOf,
  groundingStatusFromEntry,
  groundingStatusOf,
  isGroundingStatusEntry,
  suppressesBasisLabel,
} from "@factorylm/interaction";

const entry = (patch: Record<string, unknown> = {}) => ({
  kind: "grounding_status",
  v: 1,
  outcome: "refused_with_passages",
  retrieval: { status: "passages_found", scopeDocIds: ["d"], passageCount: 2, returnedDocIds: ["d"], returnedSourceRefs: [] },
  citation: { status: "refused", linkedDocIds: [], linkedSourceRefs: [], unresolvedMarkerCount: 0 },
  manualCited: false,
  droppedRefCount: 0,
  fallback: { offered: true },
  ...patch,
});

describe("groundingStatusFromEntry", () => {
  it("projects a v1 entry", () => {
    expect(groundingStatusFromEntry(entry())).toEqual({
      outcome: "refused_with_passages",
      manualSearched: true,
      searchScope: "selected_manual",
      passagesFrom: "selected_manual",
      fallbackOffered: true,
      isGeneralFallback: false,
    });
  });
  // Codex #4303 r1 F1: the copy must know WHAT was searched, not just whether.
  it("no retrieval at all (e.g. the unidentified service decline) searched nothing", () => {
    const s = groundingStatusFromEntry(entry({
      outcome: "abstained_no_passages",
      retrieval: { status: "not_attempted", notAttemptedReason: "no_manual_scope", scopeDocIds: [], passageCount: 0, returnedDocIds: [], returnedSourceRefs: [] },
    }));
    expect(s).toMatchObject({ manualSearched: false, searchScope: "none", passagesFrom: null });
  });
  it("a search with no selected manual is a shared-library search", () => {
    const s = groundingStatusFromEntry(entry({
      outcome: "abstained_no_passages",
      retrieval: { status: "no_passages", scopeDocIds: [], passageCount: 0, returnedDocIds: [], returnedSourceRefs: [] },
    }));
    expect(s).toMatchObject({ manualSearched: true, searchScope: "shared_library", passagesFrom: null });
  });
  it("passages read only from the shared library are attributed to it, even when a manual was selected", () => {
    const s = groundingStatusFromEntry(entry({
      retrieval: { status: "passages_found", scopeDocIds: ["d"], passageCount: 1, returnedDocIds: [], returnedSourceRefs: ["https://oem.example/m.pdf#p4"] },
    }));
    expect(s).toMatchObject({ searchScope: "selected_manual", passagesFrom: "shared_library" });
  });
  it("passages are attributed only when the search actually found some", () => {
    const s = groundingStatusFromEntry(entry({
      outcome: "abstained_no_passages",
      retrieval: { status: "no_passages", scopeDocIds: ["d"], passageCount: 0, returnedDocIds: ["d"], returnedSourceRefs: [] },
    }));
    expect(s).toMatchObject({ searchScope: "selected_manual", passagesFrom: null });
  });
  it("malformed retrieval scope lists are read as empty, never trusted", () => {
    const s = groundingStatusFromEntry(entry({ retrieval: { status: "no_passages", scopeDocIds: "d", returnedDocIds: 7 } }));
    expect(s).toMatchObject({ searchScope: "shared_library", passagesFrom: null });
  });
  it("a turn that never searched the manual is not 'manualSearched'", () => {
    expect(groundingStatusFromEntry(entry({ retrieval: { status: "not_attempted" } }))?.manualSearched).toBe(false);
  });
  it("offered only on a literal true", () => {
    expect(groundingStatusFromEntry(entry({ fallback: { offered: "yes" } }))?.fallbackOffered).toBe(false);
    expect(groundingStatusFromEntry(entry({ fallback: {} }))?.fallbackOffered).toBe(false);
  });
  it("a general answer linked to a failed turn is a general fallback", () => {
    expect(groundingStatusFromEntry(entry({ outcome: "answered_without_manual", fallback: { offered: false, of: "t-1" } }))?.isGeneralFallback).toBe(true);
  });
  it("fails closed: other kinds, a future version, an unknown outcome or a non-object are ignored", () => {
    for (const bad of [
      entry({ kind: "citation" }),
      entry({ v: 2 }),
      entry({ v: "1" }),
      entry({ outcome: "grounded" }),
      null,
      "grounding_status",
      [entry()],
    ]) {
      expect(groundingStatusFromEntry(bad)).toBeNull();
      expect(isGroundingStatusEntry(bad)).toBe(false);
    }
  });
});

describe("evidence readers", () => {
  it("finds the entry among other evidence", () => {
    const ev = [{ citationId: "1", docId: "d" }, entry({ outcome: "abstained_no_passages" })];
    expect(groundingStatusOf(ev)?.outcome).toBe("abstained_no_passages");
    expect(groundingStatusOf([])).toBeNull();
    expect(groundingStatusOf(undefined)).toBeNull();
  });
  it("reads the fallback link only from a well-formed entry", () => {
    expect(fallbackSourceOf([entry({ fallback: { offered: false, of: "t-9" } })])).toBe("t-9");
    expect(fallbackSourceOf([entry({ v: 2, fallback: { offered: false, of: "t-9" } })])).toBeNull();
    expect(fallbackSourceOf([entry()])).toBeNull();
  });
});

describe("suppressesBasisLabel", () => {
  it("drops the 'general guidance' basis chip for refusals and abstentions only", () => {
    for (const outcome of ["refused_with_passages", "refused_without_passages", "abstained_no_passages", "abstained_retrieval_unavailable"]) {
      expect(suppressesBasisLabel(groundingStatusFromEntry(entry({ outcome })))).toBe(true);
    }
    for (const outcome of ["answered_citation_linked", "answered_uncited_with_passages", "answered_without_manual", "stopped", "safety_stop", "provider_error"]) {
      expect(suppressesBasisLabel(groundingStatusFromEntry(entry({ outcome })))).toBe(false);
    }
    expect(suppressesBasisLabel(null)).toBe(false);
  });
});
