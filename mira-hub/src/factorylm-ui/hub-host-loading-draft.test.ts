/**
 * #4695: typing into `/v3` while an opened thread's turns were still loading
 * dropped the first word ("How do I clear a fault…" was sent as "do I clear a
 * fault…"). The shell's render-time `hydrate` used a placeholder thread whose
 * id differed from the open thread's, and the reducer blanks the draft whenever
 * the thread id changes, so the composer showed "" on every render and each
 * keystroke stored only itself. These tests drive the same reducer steps the
 * host does: `syncThread` on open, the loading-branch projection, and the
 * composer's read-the-shown-draft-then-store keystroke.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { shellReducer, type ShellState } from "../../../packages/factorylm-interaction/src";
import { EMPTY_FIXTURE, hubHostReducer, initialHubShellState, loadingThread, openThreadAction, shellThreadId, type HubSelection } from "./hub-host-logic";

const SEL: HubSelection = { notebookId: "nb-micro810", threadId: "thread-1" };
const OTHER: HubSelection = { notebookId: "nb-micro810", threadId: "thread-2" };
const AT = "2026-10-24T00:00:00.000Z";

type ViewThread = ReturnType<typeof loadingThread>;

/** What `syncThread` dispatches when a thread is opened (hub-host.tsx). */
function open(state: ShellState, sel: HubSelection): ShellState {
  return shellReducer(state, {
    type: "hydrate",
    data: { thread: { ...EMPTY_FIXTURE.thread, id: shellThreadId(sel), notebookId: sel.notebookId, createdAt: AT, updatedAt: AT } },
  });
}

/** The render-time projection while the open thread's detail is loading (hub-host.tsx `view`). */
function view(state: ShellState, thread: ViewThread): ShellState {
  return shellReducer(state, { type: "hydrate", data: { thread, projects: [], machines: [] } });
}

/** One keystroke as the composer makes it: read the draft it shows, append, store. */
function typeText(state: ShellState, text: string, thread: ViewThread): ShellState {
  let next = state;
  for (const key of text) next = shellReducer(next, { type: "set-draft", draft: view(next, thread).draft + key });
  return next;
}

describe("loadingThread — #4695 the composer keeps what is typed while a thread loads", () => {
  it("keeps every keystroke typed before the open thread's turns arrive", () => {
    const typed = typeText(open(initialHubShellState(), SEL), "How do I clear a fault", loadingThread(SEL, []));
    expect(view(typed, loadingThread(SEL, [])).draft).toBe("How do I clear a fault");
  });

  it("control: the old placeholder thread kept only the last keystroke (the reported bug)", () => {
    const typed = typeText(open(initialHubShellState(), SEL), "How do I", EMPTY_FIXTURE.thread);
    expect(view(typed, EMPTY_FIXTURE.thread).draft).toBe("");
    expect(typed.draft).toBe("I");
  });

  it("names the open thread and its notebook, the identity syncThread stored", () => {
    const opened = open(initialHubShellState(), SEL);
    expect(loadingThread(SEL, []).id).toBe(opened.thread.id);
    expect(loadingThread(SEL, []).notebookId).toBe(SEL.notebookId);
  });

  it("still clears the draft when a DIFFERENT thread is opened (control: the reset itself is intended)", () => {
    const typed = typeText(open(initialHubShellState(), SEL), "draft for thread one", loadingThread(SEL, []));
    expect(open(typed, OTHER).draft).toBe("");
  });

  it("HOME keeps the fixture thread, which is the state's initial thread", () => {
    expect(loadingThread(null, [])).toBe(EMPTY_FIXTURE.thread);
    expect(view(initialHubShellState(), loadingThread(null, [])).thread.id).toBe(initialHubShellState().thread.id);
  });

  it("is what the host's loading branch hydrates with (HubShellHost cannot render in unit tests, #4430)", () => {
    const host = readFileSync(new URL("./hub-host.tsx", import.meta.url), "utf8");
    const branch = host.slice(host.indexOf("if (!detail || !meta || !selection) {"), host.indexOf("const base = fixtureFor("));
    expect(branch).toContain("const thread = loadingThread(selection, turns);");
    expect(branch).not.toMatch(/:\s*EMPTY_FIXTURE\.thread;/);
  });
});

describe("hubHostReducer land-thread — #4695: an automatic landing keeps what was typed on HOME", () => {
  /** Type on HOME, before the notebook list arrives (HOME projects the fixture thread). */
  const typedOnHome = (text: string) => typeText(initialHubShellState(), text, loadingThread(null, []));
  const land = (state: ShellState, sel: HubSelection) => hubHostReducer(state, { type: "land-thread", selection: sel, at: AT });

  it("keeps the HOME draft when the deep link / reload lands on its thread", () => {
    const landed = land(typedOnHome("How do I clear a fault on th"), SEL);
    expect(landed.thread.id).toBe(shellThreadId(SEL));
    const done = typeText(landed, "e Micro810", loadingThread(SEL, []));
    expect(view(done, loadingThread(SEL, [])).draft).toBe("How do I clear a fault on the Micro810");
  });

  it("keeps the draft of the state it transitions, not a copy taken earlier (staging lost \"How\" that way)", () => {
    // The landing can arrive right after a keystroke, before any effect has
    // copied the draft anywhere. Only the reducer's own state is current.
    expect(land(typedOnHome("How"), SEL).draft).toBe("How");
  });

  it("control: a plain hydrate (a CHOSEN thread) wipes the HOME draft, the bug staging showed as \"e Micro810\"", () => {
    const done = typeText(hubHostReducer(typedOnHome("How do I clear a fault on th"), openThreadAction(SEL, AT)), "e Micro810", loadingThread(SEL, []));
    expect(view(done, loadingThread(SEL, [])).draft).toBe("e Micro810");
  });

  it("choosing another thread still clears the draft", () => {
    const opened = typeText(open(initialHubShellState(), SEL), "draft for one", loadingThread(SEL, []));
    expect(hubHostReducer(opened, openThreadAction(OTHER, AT)).draft).toBe("");
  });

  it("opens the same thread identity syncThread always used, and passes every shell action through", () => {
    expect(land(initialHubShellState(), SEL).thread).toEqual(open(initialHubShellState(), SEL).thread);
    expect(hubHostReducer(initialHubShellState(), { type: "set-draft", draft: "x" }).draft).toBe("x");
  });

  it("is wired: the host reduces with hubHostReducer and the automatic landing is a land-thread", () => {
    const host = readFileSync(new URL("./hub-host.tsx", import.meta.url), "utf8");
    expect(host).toContain("useReducer(hubHostReducer, undefined, initialHubShellState)");
    expect(host).toContain('syncThread(next, "land");');
    expect(host).toContain('dispatch(how === "land" ? { type: "land-thread", selection: sel, at } : openThreadAction(sel, at));');
    expect(host).not.toContain("syncThread(next, draftRef.current)");
    expect(host.match(/syncThread\(sel\);/g)?.length).toBe(1);
  });
});

describe("Hub draft isolation across notebook navigation (#5684)", () => {
  const destination = { notebookId: "nb-conveyor", threadId: SEL.threadId };

  it("restores the origin draft without carrying it into the destination", () => {
    const origin = hubHostReducer(initialHubShellState(), openThreadAction(SEL, AT));
    const withDraft = hubHostReducer(origin, { type: "set-draft", draft: "Check VFD1 on the origin" });
    const elsewhere = hubHostReducer(withDraft, openThreadAction(destination, AT));
    expect(elsewhere.draft).toBe("");

    const withOtherDraft = hubHostReducer(elsewhere, { type: "set-draft", draft: "Destination question" });
    const returned = hubHostReducer(withOtherDraft, openThreadAction(SEL, AT));
    expect(view(returned, loadingThread(SEL, [])).draft).toBe("Check VFD1 on the origin");

    const cleared = hubHostReducer(returned, { type: "set-draft", draft: "" });
    const backToDestination = hubHostReducer(cleared, openThreadAction(destination, AT));
    expect(backToDestination.draft).toBe("Destination question");
    expect(hubHostReducer(backToDestination, openThreadAction(SEL, AT)).draft).toBe("");
  });

  it("clears a successfully retried origin draft even after switching; identical destination text stays", () => {
    const question = "Check the drive";
    const origin = hubHostReducer(initialHubShellState(), openThreadAction(SEL, AT));
    const retry = hubHostReducer(origin, { type: "set-draft", draft: question });
    const switched = hubHostReducer(retry, openThreadAction(destination, AT));
    const sameText = hubHostReducer(switched, { type: "set-draft", draft: question });

    const completed = hubHostReducer(sameText, { type: "sent-draft", threadId: shellThreadId(SEL), question });
    expect(completed.draft).toBe(question);
    expect(hubHostReducer(completed, openThreadAction(SEL, AT)).draft).toBe("");
  });

  it("keeps newer text whether the sending conversation is active or parked", () => {
    const origin = hubHostReducer(initialHubShellState(), openThreadAction(SEL, AT));
    const edited = hubHostReducer(origin, { type: "set-draft", draft: "A new question" });
    const completion = { type: "sent-draft", threadId: shellThreadId(SEL), question: "The sent question" } as const;
    expect(hubHostReducer(edited, completion).draft).toBe("A new question");

    const switched = hubHostReducer(edited, openThreadAction(destination, AT));
    const completed = hubHostReducer(switched, completion);
    expect(hubHostReducer(completed, openThreadAction(SEL, AT)).draft).toBe("A new question");
  });
});
