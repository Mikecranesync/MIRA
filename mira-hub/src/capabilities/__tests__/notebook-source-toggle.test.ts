import { describe, expect, it } from "vitest";
import { createSourceToggles, persistedEnabled } from "../notebook-source-toggle";

/**
 * Codex r1 + r2 on #5476 (F2). The Sources sheet's checkbox, the server's
 * "will chat search this" label and the doc ids a chat turn sends must agree.
 * A fake server stands behind the same two calls the page makes (PATCH one
 * source, GET the list), so these cover the join the page relies on.
 */
type Row = { docId: string; enabledByDefault: boolean; matchState: string; searchableLabel: string };

function fakeServer(initial: Record<string, boolean>) {
  const db: Record<string, boolean> = { ...initial };
  const rejected = new Set<string>();
  const server = {
    db,
    rejected,
    /** What the next PATCH does: commit?, then answer how. */
    patchMode: "ok" as "ok" | "refuse" | "commit-then-lose-reply" | "offline",
    listMode: "ok" as "ok" | "fail" | "throw",
    patches: [] as string[],
    lists: 0,
    rows(): Row[] {
      return Object.keys(db).map((docId) => ({
        docId,
        enabledByDefault: db[docId],
        matchState: rejected.has(docId) ? "rejected" : "matched",
        searchableLabel: db[docId] ? "Ready to ask" : "Not searchable: not turned on",
      }));
    },
    async patch(docId: string, enabled: boolean): Promise<{ ok: boolean }> {
      server.patches.push(`${docId}:${enabled}`);
      if (server.patchMode === "offline") throw new Error("offline");
      if (server.patchMode === "refuse") return { ok: false };
      db[docId] = enabled;
      if (server.patchMode === "commit-then-lose-reply") throw new Error("connection reset after commit");
      return { ok: true };
    },
    async list(): Promise<Row[] | undefined> {
      server.lists++;
      if (server.listMode === "throw") throw new Error("offline");
      if (server.listMode === "fail") return undefined;
      return server.rows();
    },
  };
  return server;
}

function setup(initial: Record<string, boolean>) {
  const server = fakeServer(initial);
  let renders = 0;
  const toggles = createSourceToggles<Row>({
    patch: (docId, enabled) => server.patch(docId, enabled),
    list: () => server.list(),
    onChange: () => void renders++,
  });
  toggles.applySources(server.rows());
  /** Checkbox, label and outgoing chat ids for one source, as the page shows them. */
  const view = (docId: string) => ({
    checkbox: toggles.isEnabled(docId),
    label: toggles.getSources().find((s) => s.docId === docId)?.searchableLabel,
    inChat: toggles.enabledDocIds().includes(docId),
  });
  return { server, toggles, view, renders: () => renders };
}

const ON = { checkbox: true, label: "Ready to ask", inChat: true };
const OFF = { checkbox: false, label: "Not searchable: not turned on", inChat: false };

describe("createSourceToggles", () => {
  it("seeds from the server list; a rejected source is never on or in chat", () => {
    const { server, toggles, view } = setup({ a: true, b: false, c: true });
    server.rejected.add("c");
    toggles.applySources(server.rows());
    expect(view("a")).toEqual(ON);
    expect(view("b")).toEqual(OFF);
    expect(toggles.isEnabled("c")).toBe(false);
    expect(toggles.enabledDocIds()).toEqual(["a"]);
  });

  it("enable: persists, re-reads, and the label changes without a reload", async () => {
    const { server, toggles, view } = setup({ a: false });
    expect(await toggles.toggle("a")).toBe(true);
    expect(server.patches).toEqual(["a:true"]);
    expect(view("a")).toEqual(ON);
  });

  it("disable: the off warning appears without a reload", async () => {
    const { toggles, view } = setup({ a: true });
    expect(await toggles.toggle("a")).toBe(true);
    expect(view("a")).toEqual(OFF);
  });

  it("the checkbox moves at once, before the server answers", async () => {
    const { toggles } = setup({ a: false });
    const done = toggles.toggle("a");
    expect(toggles.isEnabled("a")).toBe(true);
    expect(toggles.isBusy("a")).toBe(true);
    await done;
    expect(toggles.isBusy("a")).toBe(false);
  });

  it("a refused PATCH (non-2xx) puts everything back to the server's state", async () => {
    const { server, toggles, view } = setup({ a: false });
    server.patchMode = "refuse";
    expect(await toggles.toggle("a")).toBe(false);
    expect(view("a")).toEqual(OFF);
    expect(toggles.hasUnsettled()).toBe(false);
  });

  it("offline, nothing committed: back to off, and it does not throw", async () => {
    const { server, toggles, view } = setup({ a: false });
    server.patchMode = "offline";
    expect(await toggles.toggle("a")).toBe(false);
    expect(view("a")).toEqual(OFF);
  });

  // Codex r2: the write COMMITS, the response is lost.
  it("enable committed, reply lost: checkbox, label and chat ids all end ON", async () => {
    const { server, toggles, view } = setup({ a: false });
    server.patchMode = "commit-then-lose-reply";
    expect(await toggles.toggle("a")).toBe(true);
    expect(view("a")).toEqual(ON);
    expect(toggles.hasUnsettled()).toBe(false);
  });

  it("disable committed, reply lost: checkbox, label and chat ids all end OFF", async () => {
    const { server, toggles, view } = setup({ a: true });
    server.patchMode = "commit-then-lose-reply";
    expect(await toggles.toggle("a")).toBe(true);
    expect(view("a")).toEqual(OFF);
  });

  it.each(["fail", "throw"] as const)(
    "reply lost AND the re-read fails (%s): the three still agree, and the next list read reconciles",
    async (listMode) => {
      const { server, toggles, view } = setup({ a: false });
      server.patchMode = "commit-then-lose-reply";
      server.listMode = listMode;
      expect(await toggles.toggle("a")).toBe(false);
      // Last known server state, consistently — never a half-updated row.
      expect(view("a")).toEqual(OFF);
      expect(toggles.hasUnsettled()).toBe(true);

      server.listMode = "ok"; // the network is back
      await toggles.retryUnsettled();
      expect(view("a")).toEqual(ON);
      expect(toggles.hasUnsettled()).toBe(false);
    },
  );

  it("an unsettled source is also reconciled by the page's own reload", async () => {
    const { server, toggles, view } = setup({ a: true });
    server.patchMode = "commit-then-lose-reply";
    server.listMode = "fail";
    await toggles.toggle("a");
    toggles.applySources(server.rows()); // e.g. the reload after an upload
    expect(view("a")).toEqual(OFF);
    expect(toggles.hasUnsettled()).toBe(false);
  });

  it("retryUnsettled does nothing when every write is settled", async () => {
    const { server, toggles } = setup({ a: false });
    await toggles.toggle("a");
    const before = server.lists;
    await toggles.retryUnsettled();
    expect(server.lists).toBe(before);
  });

  it("accepted write, failed re-read: the checkbox stays on the accepted value", async () => {
    const { server, toggles } = setup({ a: false });
    server.listMode = "fail";
    expect(await toggles.toggle("a")).toBe(true);
    expect(toggles.isEnabled("a")).toBe(true);
    expect(toggles.enabledDocIds()).toEqual(["a"]);
  });

  it("a 2xx the server did not keep: everything follows the server, reported not persisted", async () => {
    const { server, toggles, view } = setup({ a: false });
    const realPatch = server.patch;
    server.patch = async (docId, enabled) => {
      server.patches.push(`${docId}:${enabled}`);
      return { ok: true }; // says yes, stores nothing
    };
    expect(await toggles.toggle("a")).toBe(false);
    expect(view("a")).toEqual(OFF);
    server.patch = realPatch;
  });

  it("a second tap on a source whose toggle is in flight sends nothing", async () => {
    const { server, toggles, view } = setup({ a: false });
    const first = toggles.toggle("a");
    expect(await toggles.toggle("a")).toBe(false);
    await first;
    expect(server.patches).toEqual(["a:true"]);
    expect(view("a")).toEqual(ON);
  });

  it("toggling two different sources at once settles both", async () => {
    const { toggles, view } = setup({ a: false, b: true });
    await Promise.all([toggles.toggle("a"), toggles.toggle("b")]);
    expect(view("a")).toEqual(ON);
    expect(view("b")).toEqual(OFF);
  });

  it("a list read that started before a write settled is discarded", async () => {
    const { server, toggles, view } = setup({ a: false });
    // A slow read captures the pre-write list…
    let release!: (rows: Row[]) => void;
    const realList = server.list;
    server.list = () => new Promise<Row[]>((r) => (release = r));
    const slow = toggles.refresh();
    const stale = server.rows();
    server.list = realList;
    // …the toggle commits and re-reads…
    await toggles.toggle("a");
    expect(view("a")).toEqual(ON);
    // …then the slow, stale read lands. It must not put OFF back.
    release(stale);
    expect(await slow).toBe(false);
    expect(view("a")).toEqual(ON);
  });

  it("the page's own reload, started before a write settled, cannot put the old state back", async () => {
    const { server, toggles, view } = setup({ a: false });
    const readNo = toggles.beginRead(); // the reload's request goes out…
    const stale = server.rows();
    await toggles.toggle("a"); // …a toggle commits and re-reads meanwhile…
    expect(toggles.applySources(stale, readNo)).toBe(false); // …then the reload lands
    expect(view("a")).toEqual(ON);
  });

  // The two above are also covered by "newest applied wins". These two take
  // that away (the toggle's own re-read fails), so only the write-ordering
  // rule stands between a pre-write list and the checkbox.
  it("a pre-write read is discarded even when the toggle's own re-read failed", async () => {
    const { server, toggles } = setup({ a: false });
    let release!: (rows: Row[]) => void;
    const realList = server.list;
    server.list = () => new Promise<Row[]>((r) => (release = r));
    const slow = toggles.refresh();
    const stale = server.rows();
    server.list = realList;
    server.listMode = "fail";
    expect(await toggles.toggle("a")).toBe(true); // accepted; re-read failed
    release(stale);
    expect(await slow).toBe(false);
    expect(toggles.isEnabled("a")).toBe(true);
    expect(toggles.enabledDocIds()).toEqual(["a"]);
  });

  it("a pre-write page reload is discarded even when the toggle's own re-read failed", async () => {
    const { server, toggles } = setup({ a: false });
    const readNo = toggles.beginRead();
    const stale = server.rows();
    server.listMode = "fail";
    expect(await toggles.toggle("a")).toBe(true);
    expect(toggles.applySources(stale, readNo)).toBe(false);
    expect(toggles.isEnabled("a")).toBe(true);
  });

  it("an older read that lands after a newer one was applied is discarded (no write involved)", async () => {
    const { server, toggles, view } = setup({ a: false });
    let release!: (rows: Row[]) => void;
    const realList = server.list;
    server.list = () => new Promise<Row[]>((r) => (release = r));
    const older = toggles.refresh();
    const stale = server.rows();
    server.list = realList;
    server.db.a = true; // turned on elsewhere
    expect(await toggles.refresh()).toBe(true);
    release(stale);
    expect(await older).toBe(false);
    expect(view("a")).toEqual(ON);
  });

  it("a good older read is applied when a newer read fails", async () => {
    const { server, toggles } = setup({ a: false });
    let release!: (rows: Row[] | undefined) => void;
    const realList = server.list;
    server.list = () => new Promise<Row[] | undefined>((r) => (release = r));
    const older = toggles.refresh();
    server.list = realList;
    server.db.a = true; // changed elsewhere
    const fresh = server.rows();
    server.listMode = "fail";
    expect(await toggles.refresh()).toBe(false); // the newer read fails
    release(fresh);
    expect(await older).toBe(true);
    expect(toggles.isEnabled("a")).toBe(true);
  });

  it("tells the page to re-render on every visible change", async () => {
    const { toggles, renders } = setup({ a: false });
    const before = renders();
    await toggles.toggle("a");
    expect(renders()).toBeGreaterThanOrEqual(before + 3); // tick, settle, re-read
  });
});

describe("persistedEnabled", () => {
  const list = [
    { docId: "a", enabledByDefault: true, matchState: "matched" },
    { docId: "b", enabledByDefault: false, matchState: "matched" },
    { docId: "c", enabledByDefault: true, matchState: "rejected" },
  ];
  it("reads the server's on/off for the source", () => {
    expect(persistedEnabled(list, "a")).toBe(true);
    expect(persistedEnabled(list, "b")).toBe(false);
  });
  it("a rejected source is never on", () => expect(persistedEnabled(list, "c")).toBe(false));
  it("cannot say for a source that is not listed", () => expect(persistedEnabled(list, "zz")).toBeUndefined());
});
