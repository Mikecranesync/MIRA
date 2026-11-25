import { describe, expect, it, vi } from "vitest";
import type { HubThreadSummary } from "./notebook-tree";
import { openNotebookSelection, searchForSelection, selectionFromSearch } from "./hub-host-logic";
import { resumeProjectSelection } from "./project-resume";

const NB = "nb-1";
const t = (id: string, updatedAt: string, o: Partial<HubThreadSummary> = {}): HubThreadSummary => ({
  id, notebookId: NB, title: id, createdAt: "2026-11-01T00:00:00.000Z", updatedAt, turnCount: 2, sharedLegacy: false, ...o,
});
const mint = () => "fresh-minted";
const open = (threads?: HubThreadSummary[]) => resumeProjectSelection({ id: NB, threads }, mint);

describe("resumeProjectSelection — #4681 reopening a project resumes its newest saved conversation", () => {
  it("picks the newest by updatedAt whatever the input order", () => {
    const a = t("old", "2026-11-10T10:00:00.000Z");
    const b = t("newest", "2026-11-12T10:00:00.000Z");
    const c = t("mid", "2026-11-11T10:00:00.000Z");
    for (const order of [[a, b, c], [b, c, a], [c, a, b], [c, b, a]]) {
      expect(open(order)).toEqual({ notebookId: NB, threadId: "newest" });
    }
  });

  it("compares instants, not strings (offsets)", () => {
    // 10:00-05:00 is 15:00Z, later than 12:00Z although it sorts earlier as text.
    expect(open([t("utc", "2026-11-12T12:00:00.000Z"), t("est", "2026-11-12T10:00:00.000-05:00")]).threadId).toBe("est");
  });

  it("keeps a real legacy conversation (turnCount > 0), and it can be the newest", () => {
    const legacy = t("legacy", "2026-11-12T10:00:00.000Z", { sharedLegacy: true, turnCount: 3 });
    expect(open([t("x1", "2026-11-01T10:00:00.000Z"), legacy])).toEqual({ notebookId: NB, threadId: "legacy" });
    expect(open([legacy, t("x1", "2026-11-13T10:00:00.000Z")]).threadId).toBe("x1");
  });

  it("a zero-turn placeholder never outranks real history", () => {
    const placeholder = t("blank-newer", "2026-11-20T10:00:00.000Z", { turnCount: 0 });
    expect(open([placeholder, t("real", "2026-11-01T10:00:00.000Z")]).threadId).toBe("real");
  });

  it("mints only when no real conversation exists (none, empty, zero-turn legacy placeholder)", () => {
    const mintSpy = vi.fn(mint);
    for (const threads of [undefined, [], [t("legacy", "2026-11-12T10:00:00.000Z", { turnCount: 0, sharedLegacy: true })]]) {
      expect(resumeProjectSelection({ id: NB, threads }, mintSpy)).toEqual({ notebookId: NB, threadId: "fresh-minted" });
    }
    expect(mintSpy).toHaveBeenCalledTimes(3);
  });

  it("does not mint when it resumes (control)", () => {
    const mintSpy = vi.fn(mint);
    resumeProjectSelection({ id: NB, threads: [t("real", "2026-11-01T10:00:00.000Z")] }, mintSpy);
    expect(mintSpy).not.toHaveBeenCalled();
  });

  it("ignores a summary of another notebook, even a newer one", () => {
    const foreign = t("foreign-newest", "2026-11-30T10:00:00.000Z", { notebookId: "nb-2" });
    expect(open([foreign, t("mine", "2026-11-01T10:00:00.000Z")]).threadId).toBe("mine");
    expect(open([foreign]).threadId).toBe("fresh-minted");
  });

  it.each(["", " ", "../etc", "a/b", "-lead", ".lead", "x".repeat(121), "has space", "semi;colon", "ünï"])(
    "ignores a malformed thread id %j",
    (bad) => {
      expect(open([t(bad, "2026-11-30T10:00:00.000Z"), t("mine", "2026-11-01T10:00:00.000Z")]).threadId).toBe("mine");
    },
  );

  it("accepts the 120-character boundary and the grammar's punctuation", () => {
    for (const id of ["a".repeat(120), "a.b_c:d-e", "e2e-thread-1"]) {
      expect(open([t(id, "2026-11-12T10:00:00.000Z")]).threadId).toBe(id);
    }
  });

  it("ignores a non-numeric or negative turnCount", () => {
    const bad = [Number.NaN, -1, Infinity].map((n, i) => t(`bad${i}`, "2026-11-30T10:00:00.000Z", { turnCount: n }));
    expect(open([...bad, t("good", "2026-11-01T10:00:00.000Z")]).threadId).toBe("good");
  });

  it("ties are deterministic: same updatedAt → newer createdAt → smaller id, in any order", () => {
    const same = "2026-11-12T10:00:00.000Z";
    const a = t("a", same), b = t("b", same), c = t("c", same, { createdAt: "2026-11-05T00:00:00.000Z" });
    for (const order of [[a, b, c], [c, b, a], [b, c, a]]) expect(open(order).threadId).toBe("c");
    for (const order of [[a, b], [b, a]]) expect(open(order).threadId).toBe("a");
  });

  it("an unparseable updatedAt ranks last but is still resumable when it is all there is", () => {
    expect(open([t("junk", "not-a-date"), t("dated", "2026-11-01T10:00:00.000Z")]).threadId).toBe("dated");
    expect(open([t("junk", "not-a-date")]).threadId).toBe("junk");
  });

  it("does not mutate its input", () => {
    const threads = [t("a", "2026-11-01T10:00:00.000Z"), t("b", "2026-11-02T10:00:00.000Z")];
    const snapshot = JSON.stringify(threads);
    open(threads);
    expect(JSON.stringify(threads)).toBe(snapshot);
  });
});

describe("controls — the other entry points keep their meaning", () => {
  const threads = [t("real", "2026-11-12T10:00:00.000Z")];
  it("an explicit fresh link / equipment offer (openNotebookSelection) still mints, even with saved threads", () => {
    expect(openNotebookSelection({ id: NB }, mint)).toEqual({ notebookId: NB, threadId: "fresh-minted" });
  });
  it("a deep link that names a thread still addresses exactly that thread", () => {
    const sel = { notebookId: NB, threadId: "real" };
    expect(selectionFromSearch(searchForSelection(sel), [{ id: NB, threads } as never], mint)).toEqual(sel);
  });
  it("a notebook link with no thread is still a fresh chat", () => {
    expect(selectionFromSearch(`?notebook=${NB}`, [{ id: NB, threads } as never], mint)).toEqual({ notebookId: NB, threadId: "fresh-minted" });
  });
});
