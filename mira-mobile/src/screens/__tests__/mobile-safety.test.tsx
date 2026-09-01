// @vitest-environment jsdom
// FLEET-003 — the mobile completion of ADR-0038 safety identity.
//
// THE INVARIANT UNDER TEST: an industrial safety hard-stop must remain
// unmistakably a safety hard-stop during the live response, after persistence,
// after hydration/reload, and after relaunch. It must never reappear as an
// ordinary completed assistant answer.
//
// WHY BOTH SURFACES. `chatV2Available` is a SERVER capability that fails
// CLOSED to the classic screen. So the classic screen is not a legacy
// afterthought — it is the surface a technician lands on precisely when the
// fleet has rolled ChatV2 back, i.e. during an incident. A safety guarantee
// that holds only on the happy-path surface is not a safety guarantee. Every
// assertion below therefore runs against BOTH surfaces.
//
// Run: cd mira-mobile && bunx vitest run src/screens/__tests__/mobile-safety

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

const { nativePlatform, askNotebook, getNotebookDetail, lookAtPhoto, pickPhoto } = vi.hoisted(() => ({
  nativePlatform: { value: false },
  askNotebook: vi.fn(),
  getNotebookDetail: vi.fn(),
  lookAtPhoto: vi.fn(),
  pickPhoto: vi.fn(),
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
vi.mock("../../lib/native-pick", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/native-pick")>();
  return { ...real, pickPhoto };
});

import { NotebookScreen } from "../NotebookScreen";
import { parseChatSse, type ChatTurn } from "../../lib/sse";

const CITATION = {
  citationId: "1",
  sourceTitle: "GS10 manual",
  page: 42,
  quote: "115% FLA",
  docId: "d1",
  fileId: "f1",
  originFileId: null,
};

/** A persisted safety hard-stop exactly as FLEET-001 writes it to the row. */
const PERSISTED_SAFETY = {
  id: "t-safety",
  question: "can I change the belt while it's running?",
  answerStatus: "answered",
  answerText: "Do not work on this equipment while energized. Apply LOTO first.",
  evidence: [{ kind: "safety_notice", trigger: "loto" }, CITATION],
  basis: "general_reasoning",
};

/** An ordinary grounded answer — the non-regression control. */
const PERSISTED_NORMAL = {
  id: "t-normal",
  question: "what is the overload trip point?",
  answerStatus: "answered",
  answerText: "The overload trips at 115% FLA [1].",
  evidence: [CITATION],
  basis: null,
};

const detail = (turns: unknown[] = []) => ({
  notebook: { id: "nb1", displayName: "CV-101", manufacturer: null, model: null },
  sources: [],
  turns,
});

/** `available=false` forces the fail-closed classic surface; `true` gives the
 *  ChatV2 default. Same component either way — the capability is the switch. */
function mount(available: boolean) {
  const backRef = { current: null as (() => boolean) | null };
  return render(
    <NotebookScreen id="nb1" backRef={backRef} onExit={() => {}} chatV2Available={available} />,
  );
}

const SURFACES: [string, boolean][] = [
  ["classic (fail-closed fallback)", false],
  ["ChatV2 (default)", true],
];

beforeEach(() => {
  nativePlatform.value = false;
  askNotebook.mockReset();
  getNotebookDetail.mockReset();
  lookAtPhoto.mockReset();
  pickPhoto.mockReset();
  getNotebookDetail.mockResolvedValue(detail());
  Element.prototype.scrollTo = vi.fn();
});
afterEach(cleanup);

describe.each(SURFACES)("FLEET-003 mobile safety identity — %s", (_name, available) => {
  it("a PERSISTED safety stop hydrates as a safety notice, not an ordinary answer", async () => {
    getNotebookDetail.mockResolvedValue(detail([PERSISTED_SAFETY]));
    mount(available);

    // The banner is the identity. `role="alert"` carries it to a screen
    // reader; the glyph + wording carry it without relying on colour.
    const banner = await screen.findByTestId("safety-notice");
    expect(banner.getAttribute("role")).toBe("alert");
    expect(banner.textContent).toMatch(/safety stop/i);

    // The refusal text itself still renders — the technician must be able to
    // read WHY it stopped.
    expect(await screen.findByText(/apply loto first/i)).toBeTruthy();
  });

  it("the persisted safety turn wears NO ordinary-success chrome", async () => {
    getNotebookDetail.mockResolvedValue(detail([PERSISTED_SAFETY]));
    mount(available);
    await screen.findByTestId("safety-notice");

    // The row deliberately carries a citation AND general_reasoning basis, so
    // these assertions fail loudly if the guards are dropped. A hard stop that
    // shows a source chip reads as a researched, completed answer.
    expect(screen.queryByText(/GS10 manual/)).toBeNull();
    expect(screen.queryByText(/General guidance/i)).toBeNull();
    expect(screen.queryByTestId("machine-replay-card")).toBeNull();
    expect(screen.queryByTestId("visual-observation-card")).toBeNull();
  });

  it("an ordinary grounded answer is UNAFFECTED (no false safety banner)", async () => {
    getNotebookDetail.mockResolvedValue(detail([PERSISTED_NORMAL]));
    mount(available);

    expect(await screen.findByText(/overload trips at 115%/i)).toBeTruthy();
    expect(screen.queryByTestId("safety-notice")).toBeNull();
    // Its citation chip must still be there — the guards must not leak.
    expect(await screen.findByText(/GS10 manual/)).toBeTruthy();
  });

  it("an OLD persisted turn with no safety marker still loads (back-compat)", async () => {
    getNotebookDetail.mockResolvedValue(
      detail([{ id: "old", question: "q?", answerStatus: "answered", answerText: "A plain answer." }]),
    );
    mount(available);

    expect(await screen.findByText("A plain answer.")).toBeTruthy();
    expect(screen.queryByTestId("safety-notice")).toBeNull();
  });

  it("a STOPPED persisted turn carrying the marker still shows the banner", async () => {
    // Hardening: not reachable under today's server contract (a stopped turn
    // persists evidence=[]). Pinned because both surfaces branch on
    // isStoppedTurn BEFORE reading the marker.
    getNotebookDetail.mockResolvedValue(
      detail([
        {
          id: "t-stopped-safety",
          question: "can I open it live?",
          answerStatus: "error",
          answerText: "Do not work on this equipment while ener",
          evidence: [{ kind: "safety_notice", trigger: "loto" }],
          basis: null,
        },
      ]),
    );
    mount(available);

    expect(await screen.findByTestId("safety-notice")).toBeTruthy();
    // ...and the honest terminal caption is still there. Safety identity is
    // added to the stopped turn, it does not replace what actually happened.
    expect(await screen.findByText(/^Stopped$/)).toBeTruthy();
  });

  it("RELOAD/RELAUNCH: the same turn re-fetched is still a safety notice", async () => {
    getNotebookDetail.mockResolvedValue(detail([PERSISTED_SAFETY]));
    const first = mount(available);
    await screen.findByTestId("safety-notice");

    // Unmount and remount from server truth — the app-relaunch path. Nothing
    // in-memory survives; if the identity lived only in live state it dies
    // here, which is precisely the defect this slice fixes.
    first.unmount();
    mount(available);

    const banner = await screen.findByTestId("safety-notice");
    expect(banner.textContent).toMatch(/safety stop/i);
    expect(screen.queryByText(/GS10 manual/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// LIVE path. Driven through the real send path so the SSE `safety` frame is
// parsed by the ONE parser (lib/sse.ts) rather than injected as state.
// ---------------------------------------------------------------------------

const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

/** The turn a REAL safety stop produces: built by the one parser
 *  (`lib/sse.ts`) from real frames, not hand-assembled. The `sources` frame is
 *  deliberately included — on the wire it arrives BEFORE `status`, so this is
 *  the exact shape that would ship citation chips on a hard stop if the guards
 *  were missing. */
const LIVE_SAFETY = parseChatSse(
  frame({ kind: "content", text: "Do not work on this while energized." }) +
    frame({ kind: "safety", trigger: "arc flash" }) +
    frame({ kind: "sources", citations: [CITATION] }) +
    frame({ kind: "status", status: "answered" }),
);

describe.each(SURFACES)("FLEET-003 live safety frame — %s", (_name, available) => {
  it("the parser really did capture the safety identity (guards the fixture)", () => {
    expect(LIVE_SAFETY.safetyTrigger).toBe("arc flash");
    expect(LIVE_SAFETY.citations.length).toBe(1);
  });

  it("a live safety frame renders the banner and suppresses success chrome", async () => {
    askNotebook.mockImplementation(async (_id: string, _msg: string, _scope: unknown, opts: {
      onUpdate?: (t: ChatTurn) => void;
    }) => {
      opts.onUpdate?.({ answer: "Do not work on this while energized.", citations: [], status: "" });
      return LIVE_SAFETY;
    });
    mount(available);

    const input = (await screen.findByRole("textbox", {
      name: "Ask a question",
    })) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "is it safe?" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    const banner = await screen.findByTestId("safety-notice");
    expect(banner.getAttribute("role")).toBe("alert");
    // The `sources` frame arrived on a safety turn; it must not become a chip.
    await waitFor(() => expect(screen.queryByText(/GS10 manual/)).toBeNull());
  });

  it("an ordinary live answer keeps its citation chip and shows no banner", async () => {
    const normal = parseChatSse(
      frame({ kind: "content", text: "The overload trips at 115% FLA [1]." }) +
        frame({ kind: "sources", citations: [CITATION] }) +
        frame({ kind: "status", status: "answered" }),
    );
    askNotebook.mockImplementation(async (_id: string, _msg: string, _scope: unknown, opts: {
      onUpdate?: (t: ChatTurn) => void;
    }) => {
      opts.onUpdate?.({ answer: "The overload", citations: [], status: "" });
      return normal;
    });
    mount(available);

    const input = (await screen.findByRole("textbox", {
      name: "Ask a question",
    })) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "trip point?" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(await screen.findByText(/GS10 manual/)).toBeTruthy();
    expect(screen.queryByTestId("safety-notice")).toBeNull();
  });
});
