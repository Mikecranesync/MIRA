// @vitest-environment jsdom
// F4 (fleet-001-review-e9, 2026-09-06) — FAILING REGRESSION TESTS.
//
// THE INVARIANT UNDER TEST: a send that FAILS must leave the technician a way
// to retry it, on every conversation surface.
//
// THE ASYMMETRY. `NotebookScreen.sendQuestion`'s catch treats the two
// non-success outcomes differently:
//
//     if (ctl.signal.aborted) {
//       setLiveTurns((t) => [...t, { q, a: {...partial, status: "stopped"} }]);  // a TURN is rendered
//     } else {
//       setQ(question); setFailedSend(body); setChatError(e);                    // NO turn is rendered
//     }
//     // finally: setPending(null)
//
// A stop produces a rendered turn; a failure produces none. Nothing reaches
// `liveTurns`, `pending` is cleared, and a request that never arrived persisted
// nothing server-side — so `threadMessages` yields no failed turn at all.
//
// WHY THAT BREAKS ONLY THE UNIFIED SURFACE. The classic screen renders its own
// host-owned Retry banner keyed straight off `failedSend`, so it is unaffected.
// The unified shell instead binds Retry to a TURN's `error` part
// (packages/factorylm-ui/src/parts.tsx, `case "error"`). No failed turn means
// no error part, which means no Retry button — even though the host has
// `canRetry === true` and wires `onRetry` at UnifiedChat.tsx:116. `UnifiedChat`
// does not receive `chatError` either, so there is no error banner as a
// fallback. Net: the unified surface offers a restored draft and nothing else.
//
// This is a CUTOVER REGRESSION (unified loses what classic has), pre-existing
// and not caused by #3643/#3644. It is the mirror image of F2: F2 was a Retry
// button that did nothing, F4 is no Retry button at all.
//
// THE FIX these tests are written against (mira-97, Slice B): the failure
// branch pushes a `failed` turn into `liveTurns`, mirroring the abort branch's
// `stopped` turn. #3644's chrome gating already guarantees such a turn carries
// no citations/basis/evidence, and the shell's existing Retry then lights up
// through `hooks.onRetry` with no shared-package change.
//
// Run: cd mira-mobile && npx vitest run src/screens/__tests__/unified-failed-send-retry

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
if (!("scrollTo" in Element.prototype)) {
  Object.defineProperty(Element.prototype, "scrollTo", { value: () => {}, writable: true });
}

const { nativePlatform, askNotebook, getNotebookDetail, lookAtPhoto, surface } = vi.hoisted(() => ({
  nativePlatform: { value: false },
  askNotebook: vi.fn(),
  getNotebookDetail: vi.fn(),
  lookAtPhoto: vi.fn(),
  surface: { value: "unified" as "unified" | "legacy" | "v2" },
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => nativePlatform.value, convertFileSrc: (p: string) => p },
  CapacitorHttp: { request: vi.fn() },
  registerPlugin: () => ({}),
}));
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn(async () => ({ value: null })),
    set: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  },
}));
vi.mock("../../api/resources", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../api/resources")>();
  return { ...real, askNotebook, getNotebookDetail, lookAtPhoto };
});
// Drive the surface directly rather than through the preference store — the
// choice is what is under test, not how it is persisted.
vi.mock("../../lib/chat-ui-pref", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/chat-ui-pref")>();
  return { ...real, useChatUiChoice: () => surface.value };
});

import { NotebookScreen } from "../NotebookScreen";

const detail = (turns: unknown[] = []) => ({
  notebook: { id: "nb1", displayName: "CV-101", manufacturer: null, model: null },
  sources: [],
  turns,
});

/** A real transport failure: rejects, and the abort signal is NOT set — so
 *  `sendQuestion` takes the `else` branch, not the stopped branch. */
const NETWORK_FAILURE = () => Promise.reject(new Error("Network request failed"));

function mount() {
  const backRef = { current: null as (() => boolean) | null };
  return render(
    <NotebookScreen id="nb1" backRef={backRef} onExit={() => {}} chatV2Available />,
  );
}

/** The two surfaces label their composer differently: classic uses
 *  "Ask a question", the shared shell uses "Ask MIRA" inside form[Composer].
 *  Resolve whichever is mounted so a test can never fail merely for looking in
 *  the wrong place. */
async function composerInput(): Promise<HTMLTextAreaElement> {
  return (await waitFor(() => {
    const el =
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask MIRA"]') ??
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask a question"]');
    if (!el) throw new Error("no composer mounted on either surface");
    return el;
  })) as HTMLTextAreaElement;
}

async function ask(question: string) {
  const input = await composerInput();
  fireEvent.change(input, { target: { value: question } });
  await act(async () => {
    fireEvent.keyDown(input, { key: "Enter" });
  });
}

const retryButton = () =>
  screen.queryAllByRole("button").find((b) => (b.textContent ?? "").trim().startsWith("Retry")) ?? null;

beforeEach(() => {
  vi.clearAllMocks();
  getNotebookDetail.mockResolvedValue(detail());
  askNotebook.mockImplementation(NETWORK_FAILURE);
  surface.value = "unified";
});

afterEach(cleanup);

describe("F4 — a failed send must remain retryable on the unified surface", () => {
  it("renders the failed attempt as a turn, not as nothing", async () => {
    mount();
    await ask("What does fault F005 mean?");
    await waitFor(() => expect(askNotebook).toHaveBeenCalledTimes(1));

    // The stop path pushes a turn; the failure path must too, or the shell has
    // nothing to hang the error part (and therefore Retry) on.
    await waitFor(() =>
      expect(document.querySelector('[data-part-type="error"]')).not.toBeNull(),
    );
  });

  it("offers an enabled Retry control after the failure", async () => {
    mount();
    await ask("What does fault F005 mean?");
    await waitFor(() => expect(askNotebook).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(retryButton()).not.toBeNull());
    expect((retryButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("Retry re-sends the failed question through the host", async () => {
    mount();
    await ask("What does fault F005 mean?");
    await waitFor(() => expect(askNotebook).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(retryButton()).not.toBeNull());

    await act(async () => {
      fireEvent.click(retryButton() as HTMLButtonElement);
    });

    // The host's onRetry replays the SAME question — one more call, not a
    // second distinct question, and never a duplicate of the user's turn.
    await waitFor(() => expect(askNotebook).toHaveBeenCalledTimes(2));
    const [first, second] = askNotebook.mock.calls;
    expect(second?.[1] ?? second?.[0]).toEqual(first?.[1] ?? first?.[0]);
  });

  it("does not replay the failed attempt as unanswered history in the retried payload", async () => {
    // The failed live turn is rendered (above) but must never reach the model
    // as prior context: it has no answer, and on retry the same question would
    // arrive twice — once as history, once as the new message. This is the
    // payload-level twin of the transcript-level no-duplicate rule.
    mount();
    await ask("What does fault F005 mean?");
    await waitFor(() => expect(askNotebook).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(retryButton()).not.toBeNull());
    await act(async () => {
      fireEvent.click(retryButton() as HTMLButtonElement);
    });
    await waitFor(() => expect(askNotebook).toHaveBeenCalledTimes(2));
    const second = askNotebook.mock.calls[1];
    const body = (second?.[1] ?? second?.[0]) as { history?: unknown };
    expect(JSON.stringify(body?.history ?? [])).not.toContain("What does fault F005 mean?");
  });

  it("does not silently lose the question altogether", async () => {
    // CORRECTION to the first F4 write-up: I reported that the unified surface
    // leaves "a restored draft and nothing else". That was wrong — it leaves
    // NOTHING. `setQ(question)` restores the classic composer because ChatV2
    // receives `draft={q}` / `onDraftChange={setQ}`; UnifiedChat receives
    // neither, and the shell owns `draft` in its own reducer, so the restore
    // never reaches it. So on this surface a failed send loses the retry
    // control AND the question.
    //
    // The assertion is deliberately weak about WHERE the question survives:
    // pushing a failed turn puts it back in the transcript (as the user turn of
    // the rolled-forward exchange), which satisfies this without the host
    // having to reach into the shell's draft state.
    mount();
    await ask("What does fault F005 mean?");
    await waitFor(() => expect(askNotebook).toHaveBeenCalledTimes(1));

    const input = await composerInput();
    const inTranscript = (document.body.textContent ?? "").includes("What does fault F005 mean?");
    const inComposer = input.value === "What does fault F005 mean?";
    expect(
      inTranscript || inComposer,
      "after a failed send the question must survive somewhere the technician can act on",
    ).toBe(true);
  });
});

describe("F4 regression guard — the classic surface must not lose what it has", () => {
  it("still shows its own Retry banner after a failed send", async () => {
    surface.value = "legacy";
    mount();
    await ask("What does fault F005 mean?");
    await waitFor(() => expect(askNotebook).toHaveBeenCalledTimes(1));

    // Green today, and must stay green: classic renders this banner off
    // `failedSend` directly (NotebookScreen.tsx ~958), independent of turns.
    await waitFor(() => expect(retryButton()).not.toBeNull());
  });

  it("classic Retry still replays the same question", async () => {
    surface.value = "legacy";
    mount();
    await ask("What does fault F005 mean?");
    await waitFor(() => expect(retryButton()).not.toBeNull());

    await act(async () => {
      fireEvent.click(retryButton() as HTMLButtonElement);
    });
    await waitFor(() => expect(askNotebook).toHaveBeenCalledTimes(2));
  });
});
