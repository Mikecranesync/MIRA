/**
 * The repeated-serial warning on the bench confirmation screen (Mike 2026-11-19, PR #5649).
 *
 * When a technician confirms a component, the save reply may say the same serial number is
 * already on other components of this tenant. The screen says so and names them. It is a
 * warning only: the save is already committed, nothing is blocked, changed or merged, and the
 * serial number itself is never shown or carried by anything here.
 *
 * Static render: no jsdom in this repo. The whole confirm → warning flow in a real browser is
 * tests/e2e/equipment-nav.spec.ts ("repeated serial").
 *
 * Run: npx vitest run src/factorylm-ui/same-serial-warning.test.tsx
 */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const withTenantContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tenant-context", () => ({ withTenantContext }));

import { SAME_SERIAL_LIMIT, SAME_SERIAL_LOOKUP_FAILED, type SameSerialAdvisory } from "@/capabilities/bench-components/same-serial";
import { SameSerialWarning } from "./BenchComponents";
import {
  SAME_SERIAL_SHOWN,
  readSameSerialNotice,
  reportSameSerial,
  sameSerialButtonName,
  sameSerialNotice,
  sameSerialTarget,
  type SameSerialMatch,
  type SameSerialNotice,
} from "./bench-components-logic";
import { openOffer, pickRouteFor } from "./hub-host-logic";

const NB = "22222222-2222-4222-8222-222222222222";
const OTHER_NB = "99999999-9999-4999-8999-999999999999";
const SAVED = "44444444-4444-4444-8444-444444444444";
const HERE = "77777777-7777-4777-8777-777777777777";
const AWAY = "55555555-5555-4555-8555-555555555555";
const GONE = "66666666-6666-4666-8666-666666666666";
const SERIAL = "SN-9Z7-QX41";
const saved = { notebookId: NB, componentId: SAVED };

const here = { componentId: HERE, notebookId: NB, notebookName: "GS10 — Line 3 conveyor", label: "Q1 · MLC", retired: false };
const away = { componentId: AWAY, notebookId: OTHER_NB, notebookName: "Packaging line", label: "VFD1 · AutomationDirect GS11N-20P2", retired: false };
const gone = { componentId: GONE, notebookId: OTHER_NB, notebookName: "Packaging line", label: "VFD7 · AutomationDirect GS11N-20P2", retired: true };
const checked = (candidates: unknown[], truncated = false) => ({ status: "created", current: {}, changed: [], selection: null, sameSerial: { status: "checked", candidates, truncated } });
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("reading the save reply (sameSerialNotice)", () => {
  it("matching: lists the other components and says which are in this machine's checklist", () => {
    expect(sameSerialNotice(checked([here, away, gone]), saved)).toEqual({
      kind: "matches",
      componentId: SAVED,
      matches: [{ ...here, here: true }, { ...away, here: false }, { ...gone, here: false }],
      more: false,
    });
  });

  it("nonmatching: a check that found nothing says nothing", () => {
    expect(sameSerialNotice(checked([]), saved)).toBeNull();
  });

  it("a save that was not confirmed, or has no usable serial, says nothing", () => {
    for (const reason of ["not_confirmed", "no_usable_serial"]) {
      expect(sameSerialNotice({ status: "created", sameSerial: { status: "not_checked", reason } }, saved)).toBeNull();
    }
  });

  it("a check that failed or timed out is told apart from a check that found nothing", () => {
    expect(sameSerialNotice({ status: "created", sameSerial: SAME_SERIAL_LOOKUP_FAILED }, saved)).toEqual({ kind: "not_run", componentId: SAVED });
  });

  it("a reply from a server that does not send the field says nothing", () => {
    for (const reply of [{ status: "created", current: {}, changed: [], selection: null }, { sameSerial: null }, null, undefined, "ok", 7, [], { sameSerial: "checked" }, { sameSerial: { status: "later" } }]) {
      expect(sameSerialNotice(reply, saved)).toBeNull();
    }
  });

  it("never lists the component that was just saved, and lists a component once", () => {
    const self = { ...here, componentId: SAVED };
    expect(sameSerialNotice(checked([self]), saved)).toBeNull();
    expect(sameSerialNotice(checked([self, away, { ...away }]), saved)).toEqual({ kind: "matches", componentId: SAVED, matches: [{ ...away, here: false }], more: false });
  });

  it("the server's truncated flag becomes 'more than listed'", () => {
    expect(sameSerialNotice(checked([away], true), saved)).toMatchObject({ kind: "matches", more: true });
  });

  it("lists at most the server's limit, and says so when the reply holds more", () => {
    expect(SAME_SERIAL_SHOWN).toBe(SAME_SERIAL_LIMIT);
    const many = Array.from({ length: SAME_SERIAL_SHOWN + 3 }, (_, i) => ({ ...away, componentId: uuid(i + 1) }));
    const notice = sameSerialNotice(checked(many), saved);
    expect(notice).toMatchObject({ kind: "matches", more: true });
    expect(notice?.kind === "matches" && notice.matches).toHaveLength(SAME_SERIAL_SHOWN);
  });

  it("an entry that is not a readable match is dropped and counted as 'more', never rendered as given", () => {
    const bad = [
      { ...away, componentId: "not-a-uuid" },
      { ...away, componentId: uuid(2), notebookId: "../../admin" },
      { ...away, componentId: uuid(3), label: 12 },
      { ...away, componentId: uuid(4), notebookName: { toString: () => "x" } },
      { ...away, componentId: uuid(5), retired: "no" },
      null,
      "VFD1",
    ];
    expect(sameSerialNotice(checked([...bad, here]), saved)).toEqual({ kind: "matches", componentId: SAVED, matches: [{ ...here, here: true }], more: true });
  });

  it("a result that says it checked but cannot be read is 'the check did not run', not 'no match'", () => {
    expect(sameSerialNotice(checked([{ ...away, componentId: "x" }]), saved)).toEqual({ kind: "not_run", componentId: SAVED });
    expect(sameSerialNotice({ sameSerial: { status: "checked", candidates: "none" } }, saved)).toEqual({ kind: "not_run", componentId: SAVED });
    expect(sameSerialNotice({ sameSerial: { status: "checked" } }, saved)).toEqual({ kind: "not_run", componentId: SAVED });
  });

  it("carries nothing but the fields it names: a serial number in the reply never reaches the notice", () => {
    const leaky = checked([{ ...away, serialNumber: SERIAL, current: { serialNumber: SERIAL } }]);
    (leaky as Record<string, unknown>).current = { serialNumber: SERIAL };
    const notice = sameSerialNotice(leaky, saved);
    expect(notice?.kind).toBe("matches");
    expect(JSON.stringify(notice)).not.toContain(SERIAL);
  });

  it("blank names fall back to plain words instead of an empty row", () => {
    expect(sameSerialNotice(checked([{ ...away, label: "  ", notebookName: "" }]), saved)).toMatchObject({
      matches: [{ label: "A component", notebookName: "another machine" }],
    });
  });

  it("accepts every shape the route can answer with", () => {
    const answers: SameSerialAdvisory[] = [
      { status: "checked", candidates: [], truncated: false },
      { status: "checked", candidates: [away], truncated: true },
      { status: "not_checked", reason: "not_confirmed" },
      { status: "not_checked", reason: "no_usable_serial" },
      { status: "not_checked", reason: "lookup_failed" },
    ];
    expect(answers.map((sameSerial) => sameSerialNotice({ sameSerial }, saved)?.kind ?? null)).toEqual([null, "matches", null, null, "not_run"]);
  });
});

describe("reading the reply never fails or stalls a save (readSameSerialNotice)", () => {
  const reply = (body: unknown, status = 201) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("reads a real reply body", async () => {
    await expect(readSameSerialNotice(reply(checked([away])), saved)).resolves.toMatchObject({ kind: "matches", matches: [{ componentId: AWAY }] });
    await expect(readSameSerialNotice(reply(checked([]), 200), saved)).resolves.toBeNull();
  });

  it("a body that is not JSON resolves to 'the check did not run'; it never throws", async () => {
    await expect(readSameSerialNotice(new Response("<html>bad gateway</html>", { status: 200 }), saved)).resolves.toEqual({ kind: "not_run", componentId: SAVED });
    await expect(readSameSerialNotice({ json: () => { throw new Error("already read"); } }, saved)).resolves.toEqual({ kind: "not_run", componentId: SAVED });
  });

  it("a body that never arrives is given up on, so the save's result is not held back", async () => {
    const started = performance.now();
    await expect(readSameSerialNotice({ json: () => new Promise<unknown>(() => {}) }, saved, 20)).resolves.toEqual({ kind: "not_run", componentId: SAVED });
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("a body that fails after it was given up on is not an unhandled error", async () => {
    const late = { json: () => new Promise<unknown>((_, reject) => setTimeout(() => reject(new Error("connection reset")), 30)) };
    await expect(readSameSerialNotice(late, saved, 5)).resolves.toEqual({ kind: "not_run", componentId: SAVED });
    await new Promise((r) => setTimeout(r, 60)); // an unhandled rejection here fails the run
  });
});

describe("the warning on the confirmation screen (SameSerialWarning)", () => {
  const matches: SameSerialMatch[] = [{ ...here, here: true }, { ...away, here: false }, { ...gone, here: false }];
  const notice: SameSerialNotice = { kind: "matches", componentId: SAVED, matches, more: false };
  const render = (n: SameSerialNotice, over: Partial<Parameters<typeof SameSerialWarning>[0]> = {}) =>
    renderToStaticMarkup(<SameSerialWarning notice={n} savedLabel="VFD1 · AutomationDirect GS10" disabled={false} onOpen={vi.fn()} onDismiss={vi.fn()} {...over} />);

  it("says the serial is already on other components, that the save stands, and that nothing was blocked, changed or merged", () => {
    const html = render(notice);
    expect(html).toContain('data-testid="bench-same-serial"');
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Repeated serial number"');
    expect(html).toContain("This serial number is already on 3 other components.");
    expect(html).toContain("VFD1 · AutomationDirect GS10 is saved as confirmed.");
    expect(html).toContain("This may be the same unit.");
    expect(html).toContain("Nothing was blocked, changed or merged.");
  });

  it("the headline is a polite status, so a screen reader announces it", () => {
    expect(render(notice)).toMatch(/<p[^>]*role="status"[^>]*data-testid="bench-same-serial-headline"/);
  });

  it("one match reads as one", () => {
    expect(render({ ...notice, matches: [matches[1]] })).toContain("This serial number is already on another component.");
  });

  it("names each match by its checklist label and where it is, enough to tell two VFD1s apart", () => {
    const html = render(notice);
    expect(html).toContain(`data-testid="bench-same-serial-match-${HERE}"`);
    expect(html).toContain("<strong>Q1 · MLC</strong>");
    expect(html).toContain("in this machine&#x27;s checklist");
    expect(html).toContain("<strong>VFD1 · AutomationDirect GS11N-20P2</strong>");
    expect(html).toContain("in Packaging line");
    expect(html).toContain("<strong>VFD7 · AutomationDirect GS11N-20P2</strong>");
  });

  it("a match here is shown in the checklist; a match elsewhere opens that machine; both use the navigator's words", () => {
    const html = render(notice);
    expect(html).toMatch(new RegExp(`<button[^>]*data-testid="bench-same-serial-open-${HERE}"[^>]*>Show in checklist</button>`));
    expect(html).toMatch(new RegExp(`<button[^>]*aria-label="Open Packaging line in a new chat: VFD1 · AutomationDirect GS11N-20P2"[^>]*data-testid="bench-same-serial-open-${AWAY}"[^>]*>Open</button>`));
  });

  it("two matches in the same other machine have different button names, so a screen reader can tell them apart", () => {
    const twin = { ...away, componentId: "33333333-3333-4333-8333-333333333333", label: "VFD2 · AutomationDirect GS11N-20P2", here: false };
    const html = render({ ...notice, matches: [{ ...away, here: false }, twin] });
    const names = [...html.matchAll(/<button[^>]*aria-label="([^"]*)"[^>]*bench-same-serial-open-/g)].map((m) => m[1]);
    expect(names).toEqual([
      "Open Packaging line in a new chat: VFD1 · AutomationDirect GS11N-20P2",
      "Open Packaging line in a new chat: VFD2 · AutomationDirect GS11N-20P2",
    ]);
  });

  it("two matches that read exactly alike still have different button names: each gets its place among them", () => {
    const first = { ...away, here: false };
    const second = { ...away, componentId: "33333333-3333-4333-8333-333333333333", here: false };
    const removed = { ...away, componentId: "12121212-1212-4212-8212-121212121212", here: false, retired: true };
    const other = { ...away, componentId: "34343434-3434-4434-8434-343434343434", label: "VFD2 · AutomationDirect GS11N-20P2", here: false };
    const html = render({ ...notice, matches: [first, removed, other, second] });
    const names = [...html.matchAll(/<button[^>]*aria-label="([^"]*)"[^>]*bench-same-serial-open-/g)].map((m) => m[1]);
    expect(names).toEqual([
      "Open Packaging line in a new chat: VFD1 · AutomationDirect GS11N-20P2 (1 of 2)",
      "Open Packaging line in a new chat: VFD2 · AutomationDirect GS11N-20P2",
      "Open Packaging line in a new chat: VFD1 · AutomationDirect GS11N-20P2 (2 of 2)",
    ]);
    expect(new Set(names).size).toBe(names.length);
    // The same holds in this machine's own checklist, and a lone match keeps its plain name.
    const a = { ...here, here: true };
    const b = { ...here, componentId: "56565656-5656-4656-8656-565656565656", here: true };
    expect(sameSerialButtonName([a, b], a)).toBe("Show in checklist: Q1 · MLC (1 of 2)");
    expect(sameSerialButtonName([a, b], b)).toBe("Show in checklist: Q1 · MLC (2 of 2)");
    expect(sameSerialButtonName([a], a)).toBe("Show in checklist: Q1 · MLC");
    // A removed component with the same words has no button, so it does not make a lone button "1 of 2".
    expect(sameSerialButtonName([first, removed], first)).toBe("Open Packaging line in a new chat: VFD1 · AutomationDirect GS11N-20P2");
  });

  it("a row reads as separate words: the label, where it is, and the removed mark do not run together", () => {
    const words = (m: SameSerialMatch) => {
      const html = render({ ...notice, matches: [m] }, { onOpen: undefined });
      return html.slice(html.indexOf("<li"), html.indexOf("</li>")).replace(/<[^>]*>/g, "").replaceAll("&#x27;", "'");
    };
    expect(words({ ...here, here: true })).toBe("Q1 · MLC in this machine's checklist");
    expect(words({ ...away, here: false })).toBe("VFD1 · AutomationDirect GS11N-20P2 in Packaging line");
    expect(words({ ...gone, here: false })).toBe("VFD7 · AutomationDirect GS11N-20P2 in Packaging line (removed from the checklist)");
    expect(words({ ...here, here: true, retired: true })).toBe("Q1 · MLC on this machine (removed from the checklist)");
  });

  it("a removed component is named and marked, and has no button", () => {
    const html = render(notice);
    expect(html).toContain("removed from the checklist");
    expect(html).not.toContain(`bench-same-serial-open-${GONE}`);
  });

  it("a removed component of this machine is not said to be in its checklist", () => {
    const row = (m: SameSerialMatch) => {
      const html = render({ ...notice, matches: [m] });
      return html.slice(html.indexOf("<li"), html.indexOf("</li>"));
    };
    const removedHere = row({ ...here, retired: true, here: true });
    expect(removedHere).toContain("on this machine");
    expect(removedHere).toContain("(removed from the checklist)");
    expect(removedHere).not.toContain("in this machine");
    expect(row({ ...here, here: true })).toContain("in this machine&#x27;s checklist");
    expect(row({ ...gone, here: false })).toContain("in Packaging line");
  });

  it("the removed mark is muted text on the amber ground, not a grey chip that falls under 4.5:1", () => {
    const html = render(notice);
    expect(html).toMatch(new RegExp(`<span[^>]*data-testid="bench-same-serial-removed-${GONE}"[^>]*color:var\\(--fl-muted\\)[^>]*>\\(removed from the checklist\\)</span>`));
    expect(html).not.toContain("var(--fl-bg)");
  });

  it("buttons are finger-sized and are off while a save or an answer is in progress", () => {
    const live = render(notice);
    expect(live.match(/min-height:44px/g)?.length).toBe(3); // two opens and OK
    expect(live).not.toContain("disabled");
    const busy = render(notice, { disabled: true });
    expect(busy.match(/<button[^>]*disabled=""[^>]*bench-same-serial-open-/g)?.length).toBe(2);
    expect(busy).toMatch(/<button[^>]*data-testid="bench-same-serial-dismiss"[^>]*>OK<\/button>/);
    expect(busy).not.toMatch(/<button[^>]*disabled=""[^>]*bench-same-serial-dismiss/);
  });

  it("without a way to open equipment it still names every match", () => {
    const html = render(notice, { onOpen: undefined });
    expect(html).not.toContain("bench-same-serial-open-");
    expect(html).toContain("in Packaging line");
  });

  it("says when more components carry the serial than are listed", () => {
    expect(render(notice)).not.toContain("bench-same-serial-more");
    const html = render({ ...notice, more: true });
    expect(html).toContain("This serial number is already on more than 3 other components.");
    expect(html).toContain('data-testid="bench-same-serial-more"');
    expect(html).toContain("Only the first 3 are listed.");
  });

  it("names the saved component plainly when the checklist has no label for it", () => {
    expect(render(notice, { savedLabel: null })).toContain("This component is saved as confirmed.");
  });

  it("names and labels are text, never markup", () => {
    const html = render({ ...notice, matches: [{ ...matches[1], label: '<img src=x onerror="alert(1)">', notebookName: "<script>alert(2)</script>" }] });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("colour comes from the shared tokens: amber is the warning state, never a hex value", () => {
    const html = render(notice);
    expect(html).toContain("var(--fl-warn-bg)");
    expect(html).toContain("var(--fl-warn)");
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("amber is the border and the ground only: the words stay ink, because amber text on amber is about 3:1", () => {
    const html = render({ ...notice, more: true });
    expect(html).toMatch(/border:1px solid var\(--fl-warn\)/);
    expect(html).toMatch(/color:var\(--fl-ink\)/);
    // No text in the warning is amber, the headline included.
    expect(html).not.toMatch(/(^|[;"])color:var\(--fl-warn\)/);
  });

  it("a check that did not run is a quiet line, not a warning", () => {
    const html = render({ kind: "not_run", componentId: SAVED });
    expect(html).toContain('data-testid="bench-same-serial-not-run"');
    expect(html).toContain('role="status"');
    expect(html).toContain("The check for this serial number on other components did not run this time. Your save is not affected.");
    expect(html).not.toContain('data-testid="bench-same-serial"');
    expect(html).not.toContain("var(--fl-warn");
    expect(html).not.toContain("<button");
  });
});

describe("opening a match reuses the equipment hand-off (#5625); there is no second navigation", () => {
  const mint = () => "fresh-thread";
  const open = { notebookId: NB, threadId: "t1" };
  const now = { generation: 4, selection: open, answering: false };
  const tap = (m: SameSerialMatch, at = now) => pickRouteFor(sameSerialTarget(m), { conversation: at.selection, generation: at.generation }, at, 21);

  it("a match is the navigator's question target: the machine is its notebook", () => {
    expect(sameSerialTarget({ ...away, here: false })).toEqual({
      machineId: OTHER_NB, machineLabel: "Packaging line", componentId: AWAY, componentLabel: "VFD1 · AutomationDirect GS11N-20P2", location: "",
    });
  });

  it("a match in this machine is shown in this chat's checklist; nothing is opened and nothing is selected", () => {
    const route = tap({ ...here, here: true });
    expect(route).toMatchObject({ kind: "offer", offer: { here: true } });
    expect(route.kind === "offer" && openOffer(route.offer, now, mint)).toEqual({ open: null, focus: { notebookId: NB, threadId: "t1", componentId: HERE, token: 21 } });
  });

  it("a match in another machine opens it in a fresh chat and shows the component there", () => {
    const route = tap({ ...away, here: false });
    expect(route.kind === "offer" && openOffer(route.offer, now, mint)).toEqual({
      open: { notebookId: OTHER_NB, threadId: "fresh-thread" },
      focus: { notebookId: OTHER_NB, threadId: "fresh-thread", componentId: AWAY, token: 21 },
    });
  });

  it("a tap while an answer is coming in does nothing", () => {
    expect(tap({ ...away, here: false }, { ...now, answering: true })).toEqual({ kind: "dropped", reason: "answer_in_progress" });
  });
});

describe("a save's notice is handed over without waiting for a slow reply", () => {
  const notice: SameSerialNotice = { kind: "not_run", componentId: SAVED };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("a reply already read is shown before this returns, so it lands with the save's own result", async () => {
    const shown: (SameSerialNotice | null)[] = [];
    const read = readSameSerialNotice({ json: async () => ({ sameSerial: SAME_SERIAL_LOOKUP_FAILED }) }, saved);
    await tick();
    await reportSameSerial(read, (n) => shown.push(n));
    expect(shown).toEqual([notice]);
  });

  it("a reply with no match is handed over too, as nothing to show", async () => {
    const shown: (SameSerialNotice | null)[] = [];
    await reportSameSerial(Promise.resolve(null), (n) => shown.push(n));
    expect(shown).toEqual([null]);
  });

  it("a reply that never arrives does not hold the caller: it returns with nothing shown", async () => {
    const shown: (SameSerialNotice | null)[] = [];
    await reportSameSerial(new Promise(() => undefined), (n) => shown.push(n));
    expect(shown).toEqual([]);
  });

  it("a reply that arrives later is shown then, not before", async () => {
    const shown: (SameSerialNotice | null)[] = [];
    let arrive!: (n: SameSerialNotice) => void;
    const late = new Promise<SameSerialNotice>((resolve) => {
      arrive = resolve;
    });
    await reportSameSerial(late, (n) => shown.push(n));
    expect(shown).toEqual([]);
    arrive(notice);
    await tick();
    expect(shown).toEqual([notice]);
  });

  it("a notice that fails, early or late, shows nothing and throws nothing", async () => {
    const shown: (SameSerialNotice | null)[] = [];
    await expect(reportSameSerial(Promise.reject(new Error("early")), (n) => shown.push(n))).resolves.toBeUndefined();
    let fail!: (e: Error) => void;
    const late = new Promise<SameSerialNotice>((_, reject) => {
      fail = reject;
    });
    await reportSameSerial(late, (n) => shown.push(n));
    fail(new Error("late"));
    await tick();
    expect(shown).toEqual([]);
  });
});

describe("the browser bundle stays free of the server lookup", () => {
  // same-serial.ts imports the database layer. The screen may use its TYPES only.
  const dir = new URL("./", import.meta.url);
  const src = (name: string) => readFileSync(new URL(name, dir), "utf8");
  const sources = (readdirSync(dir, { recursive: true }) as string[])
    .map((name) => name.split("\\").join("/"))
    .filter((name) => /\.tsx?$/.test(name) && !/(^|\/)__tests__\//.test(name) && !/\.test\.tsx?$/.test(name))
    .sort();

  /** Every mention of the lookup module that is not a type-only import or re-export. */
  function runtimeLookupRefs(source: string): string[] {
    const found: string[] = [];
    for (const m of source.matchAll(/["'`][^"'`\n]*\/same-serial(?:\.[jt]sx?)?["'`]/g)) {
      const statement = source.slice(source.lastIndexOf(";", m.index) + 1, m.index);
      const keyword = [...statement.matchAll(/^[ \t]*(?:import|export)\b/gm)].pop();
      const head = keyword ? statement.slice(keyword.index).trim() : "";
      const called = /\b(?:import|require)\s*\(\s*$/.test(statement); // import("…") or require("…")
      if (called || !/^(?:import|export)\s+type\s*[{*]/.test(head)) found.push(`${statement.trim().replace(/\s+/g, " ").slice(-60)} ${m[0]}`);
    }
    return found;
  }

  it("the scan covers the screen's source files, not an empty list", () => {
    expect(sources.length).toBeGreaterThanOrEqual(40);
    for (const name of ["bench-components-logic.ts", "BenchComponents.tsx", "hub-host.tsx", "hub-host-logic.ts"]) expect(sources).toContain(name);
    expect(sources.some((name) => /\.test\./.test(name))).toBe(false);
  });

  it("no source file of the screen refers to the lookup module at run time", () => {
    const offenders = sources.flatMap((name) => runtimeLookupRefs(src(name)).map((ref) => `${name}: ${ref}`));
    expect(offenders).toEqual([]);
  });

  it.each([
    ['import { SAME_SERIAL_LIMIT } from "@/capabilities/bench-components/same-serial";'],
    ['import { type SameSerialAdvisory } from "@/capabilities/bench-components/same-serial";'],
    ['import {\n  SAME_SERIAL_LIMIT,\n} from "@/capabilities/bench-components/same-serial";'],
    ['import "@/capabilities/bench-components/same-serial";'],
    ['export { SAME_SERIAL_LIMIT } from "@/capabilities/bench-components/same-serial";'],
    ['export * from "@/capabilities/bench-components/same-serial";'],
    ['import { sameSerialAdvisory } from "../capabilities/bench-components/same-serial";'],
    ['import { sameSerialAdvisory } from "@/capabilities/bench-components/same-serial.ts";'],
    ['const lookup = await import("@/capabilities/bench-components/same-serial");'],
    ['const x = 1;\nimport("@/capabilities/bench-components/same-serial");'],
    ['const lookup = require("@/capabilities/bench-components/same-serial");'],
    ['import type { A } from "a"\nconst lookup = await import("@/capabilities/bench-components/same-serial")'],
    ['import type from "@/capabilities/bench-components/same-serial";'],
  ])("the guard catches a run-time reference: %s", (line) => {
    expect(runtimeLookupRefs(`/** a file */\nimport { useState } from "react";\n${line}\n`)).toHaveLength(1);
  });

  it.each([
    ['import type { SameSerialAdvisory } from "@/capabilities/bench-components/same-serial";'],
    ['import type {\n  SameSerialAdvisory,\n} from "@/capabilities/bench-components/same-serial";'],
    ['export type { SameSerialAdvisory } from "@/capabilities/bench-components/same-serial";'],
    ['import type * as lookup from "@/capabilities/bench-components/same-serial";'],
    ['<div data-testid="bench-same-serial" />;'],
    ['const id = `bench-same-serial-match-${m.componentId}`;'],
  ])("the guard allows a type-only use or an unrelated string: %s", (line) => {
    expect(runtimeLookupRefs(`/** a file; with a semicolon */\nimport { useState } from "react";\n${line}\n`)).toEqual([]);
  });

  it("the screen reads the reply only through the guarded reader, and never waits for it before reporting the save", () => {
    const view = src("BenchComponents.tsx");
    expect(view).toContain("readSameSerialNotice(");
    expect(view).toContain("await reportSameSerial(serial,");
    expect(view).not.toMatch(/res\.json\(\)[^\n]*sameSerial/);
    expect(view).not.toMatch(/await serial\b/);
  });

  it("opening a match is off while a save or an answer is in progress", () => {
    expect(src("BenchComponents.tsx")).toMatch(/<SameSerialWarning\b[\s\S]{0,300}?\bdisabled=\{saving \|\| busy\}/);
  });

  it("a match's button is named by the one naming rule, with the whole list in hand", () => {
    expect(src("BenchComponents.tsx")).toContain("aria-label={sameSerialButtonName(notice.matches, m)}");
  });
});
