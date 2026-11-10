/**
 * #5089: the fixes a technician saved on a project, read back from GET /fixes so they are
 * visible after a reload. Pure helpers against a fake fetch (the hub's node vitest pattern).
 */
import { describe, expect, it, vi } from "vitest";
import {
  fixWhenLabel,
  fixesReducer,
  loadSavedFixes,
  mergeFixPages,
  pageToShow,
  parseFixesPage,
  savedFixesHeading,
  savedFixesPillLabel,
  type SavedFix,
} from "./saved-fixes-logic";

const NB = "11111111-1111-4111-8111-111111111111";
const row = (n: number, patch: Record<string, unknown> = {}) => ({
  id: `0000000${n}-0000-4000-8000-000000000000`,
  notebookId: NB,
  equipmentEntityId: null,
  symptom: `Problem ${n}`,
  faultCode: null,
  fix: `Fix ${n}`,
  recordedBy: "user-1",
  createdAt: `2026-11-0${n}T14:05:00.000Z`,
  delivery: null,
  ...patch,
});
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

describe("parseFixesPage", () => {
  it("keeps what the list shows and drops the rest of each record", () => {
    const page = parseFixesPage({ fixes: [row(1, { faultCode: "F0004" })], nextCursor: null, assetConfirmed: true });
    expect(page).toEqual({
      fixes: [{ id: row(1).id, symptom: "Problem 1", faultCode: "F0004", fix: "Fix 1", createdAt: "2026-11-01T14:05:00.000Z" }],
      nextCursor: null,
      assetConfirmed: true,
    });
  });

  it("an unbound project reports assetConfirmed null, and a cursor is carried", () => {
    const page = parseFixesPage({ fixes: [row(1)], nextCursor: row(1).id, assetConfirmed: null });
    expect(page?.assetConfirmed).toBeNull();
    expect(page?.nextCursor).toBe(row(1).id);
  });

  it("a record without an id, a problem or a fix is left out, never shown half-empty", () => {
    const page = parseFixesPage({
      fixes: [row(1), row(2, { id: 7 }), row(3, { symptom: "" }), row(4, { fix: null }), "junk", null],
      nextCursor: null,
      assetConfirmed: true,
    });
    expect(page?.fixes.map((f) => f.symptom)).toEqual(["Problem 1"]);
  });

  it.each([null, "text", 42, {}, { fixes: "no" }, { error: "notebook_not_found" }])("a body that is not a fixes page (%j) is null", (body) => {
    expect(parseFixesPage(body)).toBeNull();
  });
});

describe("loadSavedFixes", () => {
  it("reads the project's fixes route with the session cookie", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => ok({ fixes: [row(1)], nextCursor: null, assetConfirmed: true }));
    const page = await loadSavedFixes(fetchImpl as unknown as typeof fetch, "/hub", NB);
    expect(page?.fixes).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]).toEqual([
      `/hub/api/equipment-notebooks/${NB}/fixes/`,
      { credentials: "include", headers: { accept: "application/json" } },
    ]);
  });

  it("the next page is asked for by the last id shown", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => ok({ fixes: [row(2)], nextCursor: null, assetConfirmed: true }));
    await loadSavedFixes(fetchImpl as unknown as typeof fetch, "", NB, row(1).id);
    expect(fetchImpl.mock.calls[0]![0]).toBe(`/api/equipment-notebooks/${NB}/fixes/?before=${row(1).id}`);
  });

  it("a refused read, a thrown read and an unreadable body are all null", async () => {
    // The refused read carries a well-formed list on purpose: the status decides, not the body.
    const refused = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ fixes: [row(1)], nextCursor: null, assetConfirmed: true }) }) as unknown as Response);
    const thrown = vi.fn(async () => { throw new TypeError("fetch failed"); });
    const garbled = vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad json"); } }) as unknown as Response);
    for (const f of [refused, thrown, garbled]) {
      expect(await loadSavedFixes(f as unknown as typeof fetch, "", NB)).toBeNull();
    }
  });
});

describe("pageToShow", () => {
  const page = (assetConfirmed: boolean | null) => parseFixesPage({ fixes: [row(1)], nextCursor: null, assetConfirmed });
  it("a confirmed machine and an unbound project are both shown", () => {
    expect(pageToShow(page(true))?.fixes).toHaveLength(1);
    expect(pageToShow(page(null))?.fixes).toHaveLength(1);
  });
  it("a machine that is picked but not confirmed shows nothing, and so does a failed read", () => {
    expect(pageToShow(page(false))).toBeNull();
    expect(pageToShow(null)).toBeNull();
  });
});

describe("mergeFixPages", () => {
  const fx = (n: number): SavedFix => ({ id: row(n).id, symptom: `Problem ${n}`, faultCode: null, fix: `Fix ${n}`, createdAt: row(n).createdAt });
  it("appends the next page in order", () => {
    expect(mergeFixPages([fx(3), fx(2)], [fx(1)]).map((f) => f.id)).toEqual([fx(3).id, fx(2).id, fx(1).id]);
  });
  it("a record already shown is not shown twice", () => {
    expect(mergeFixPages([fx(3), fx(2)], [fx(2), fx(1)]).map((f) => f.id)).toEqual([fx(3).id, fx(2).id, fx(1).id]);
  });
});

describe("fixesReducer: what the list holds as reads come back", () => {
  const fx = (n: number): SavedFix => ({ id: row(n).id, symptom: `Problem ${n}`, faultCode: null, fix: `Fix ${n}`, createdAt: row(n).createdAt });
  const page = (ns: number[], nextCursor: string | null, assetConfirmed: boolean | null = true) => ({ fixes: ns.map(fx), nextCursor, assetConfirmed });
  const first = (ns: number[], cursor: string | null) => fixesReducer(null, { type: "first-page", page: page(ns, cursor) });

  it("the first page fills the list", () => {
    expect(first([3, 2], fx(2).id)).toEqual({ fixes: [fx(3), fx(2)], cursor: fx(2).id, assetConfirmed: true, loadingMore: false, moreError: null });
  });

  it("an unconfirmed machine empties the list, even one already shown", () => {
    expect(fixesReducer(first([3], null), { type: "first-page", page: page([], null, false) })).toBeNull();
  });

  it("a failed re-read keeps what is already shown; a failed first read shows nothing", () => {
    const shown = first([3], null);
    expect(fixesReducer(shown, { type: "first-page", page: null })).toEqual(shown);
    expect(fixesReducer(null, { type: "first-page", page: null })).toBeNull();
  });

  it("Show more marks the list as loading, once, and only when there is more", () => {
    const loading = fixesReducer(first([3, 2], fx(2).id), { type: "more-started" });
    expect(loading?.loadingMore).toBe(true);
    expect(fixesReducer(loading, { type: "more-started" })).toBe(loading);
    const all = first([3], null);
    expect(fixesReducer(all, { type: "more-started" })).toBe(all);
  });

  it("the next page is appended and the list stops loading", () => {
    const loading = fixesReducer(first([3, 2], fx(2).id), { type: "more-started" });
    const done = fixesReducer(loading, { type: "more-loaded", before: fx(2).id, page: page([1], null) });
    expect(done).toEqual({ fixes: [fx(3), fx(2), fx(1)], cursor: null, assetConfirmed: true, loadingMore: false, moreError: null });
  });

  it("a next page that could not be read says so and can be asked for again", () => {
    const loading = fixesReducer(first([3, 2], fx(2).id), { type: "more-started" });
    const failed = fixesReducer(loading, { type: "more-loaded", before: fx(2).id, page: null });
    expect(failed).toMatchObject({ fixes: [fx(3), fx(2)], cursor: fx(2).id, loadingMore: false, moreError: "More saved fixes could not be loaded." });
    expect(fixesReducer(failed, { type: "more-started" })).toMatchObject({ loadingMore: true, moreError: null });
  });

  // A save lands while "Show more" is in flight: the list is re-read from the top.
  it("a re-read while Show more is in flight never leaves the button stuck on Loading", () => {
    const loading = fixesReducer(first([3, 2], fx(2).id), { type: "more-started" });
    const reread = fixesReducer(loading, { type: "first-page", page: page([4, 3], fx(3).id) });
    expect(reread).toMatchObject({ fixes: [fx(4), fx(3)], cursor: fx(3).id, loadingMore: false, moreError: null });
  });

  it("a late next page asked for from an older list is dropped", () => {
    const loading = fixesReducer(first([3, 2], fx(2).id), { type: "more-started" });
    const reread = fixesReducer(loading, { type: "first-page", page: page([4, 3], fx(3).id) });
    expect(fixesReducer(reread, { type: "more-loaded", before: fx(2).id, page: page([1], null) })).toBe(reread);
    const again = fixesReducer(reread, { type: "more-started" });
    expect(fixesReducer(again, { type: "more-loaded", before: fx(2).id, page: page([1], null) })).toBe(again);
  });

  it("a re-read that changes nothing still takes the page that was in flight", () => {
    const loading = fixesReducer(first([3, 2], fx(2).id), { type: "more-started" });
    const same = fixesReducer(loading, { type: "first-page", page: page([3, 2], fx(2).id) });
    expect(same?.loadingMore).toBe(false);
    expect(fixesReducer(same, { type: "more-loaded", before: fx(2).id, page: page([1], null) })).toMatchObject({ fixes: [fx(3), fx(2), fx(1)], cursor: null, loadingMore: false });
  });

  it("a failed re-read while Show more is in flight keeps the list and lets the page arrive", () => {
    const loading = fixesReducer(first([3, 2], fx(2).id), { type: "more-started" });
    const kept = fixesReducer(loading, { type: "first-page", page: null });
    expect(kept).toBe(loading);
    expect(fixesReducer(kept, { type: "more-loaded", before: fx(2).id, page: page([1], null) })?.fixes).toHaveLength(3);
  });
});

describe("labels", () => {
  it("the button counts what is loaded and says when there are more", () => {
    expect(savedFixesPillLabel(1, false)).toBe("Saved fixes (1)");
    expect(savedFixesPillLabel(10, true)).toBe("Saved fixes (10+)");
  });

  it("the heading says whose fixes these are", () => {
    expect(savedFixesHeading(true)).toBe("Saved fixes for this machine");
    expect(savedFixesHeading(null)).toBe("Saved fixes in this project");
  });

  it("the saved time is shown in the reader's zone", () => {
    expect(fixWhenLabel("2026-11-10T14:05:00.000Z", "en-US", "America/New_York")).toBe("Nov 10, 2026, 9:05 AM");
    expect(fixWhenLabel("2026-11-10T14:05:00.000Z", "en-US", "UTC")).toBe("Nov 10, 2026, 2:05 PM");
  });

  it("a time that cannot be read is left blank, never 'Invalid Date'", () => {
    expect(fixWhenLabel("not a date", "en-US", "UTC")).toBe("");
    expect(fixWhenLabel("", "en-US", "UTC")).toBe("");
  });
});
