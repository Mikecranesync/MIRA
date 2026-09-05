// @vitest-environment jsdom
// ADR-0038 rule 6 — the mobile half.
//
// THE INVARIANT UNDER TEST: a stream that ended WITHOUT the authoritative
// `status` frame is a truncation, and no surface may render it as a completed,
// cited answer.
//
// WHY THIS IS SUBTLE. Nothing throws. An aborted or dropped body is simply
// CLOSED, so the read loop exits with `done:true` exactly as a healthy stream
// does; `askNotebook` resolves normally and the turn arrives with `status: ""`.
// And because `sources` lands BEFORE `status` on the wire, the turn is holding
// real citations at that moment. A surface that branches only on
// `status === "stopped"` therefore paints a cut-off stream as a finished answer
// with source chips — a fabricated completion (PRD §10.9) and a client
// inferring terminal state the server never sent (PRD §7.6).
//
// WHY BOTH SURFACES. `chatV2Available` is a SERVER capability that fails CLOSED
// to the classic screen, so classic is what a technician lands on during an
// incident — exactly when a truncated stream is most likely. The ChatV2 adapter
// already refused to fabricate; the classic screen is what did not. Both are
// asserted so they cannot drift apart again.
//
// Run: cd mira-mobile && npx vitest run src/screens/__tests__/mobile-truncation

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
import { isTruncatedTurn, parseChatSse, type ChatTurn } from "../../lib/sse";

const CITATION = {
  citationId: "1",
  sourceTitle: "GS10 manual",
  page: 42,
  quote: "115% FLA",
  docId: "d1",
  fileId: "f1",
  originFileId: null,
};

const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

/** The exact fabricated-citation shape: content + sources + evidence all
 *  landed, then the stream died. No `status`, no `[DONE]`. Built by the ONE
 *  parser from real frames rather than hand-assembled, so the fixture cannot
 *  drift from the wire. */
const LIVE_TRUNCATED = parseChatSse(
  frame({ kind: "content", content: "The overload trips at 115% FLA [1]." }) +
    frame({ kind: "sources", citations: [CITATION], sourceSnapshot: ["d1"] }) +
    frame({ kind: "evidence", basis: "general_reasoning", label: "General guidance" }),
);

/** The control: identical frames, plus the terminal `status`. */
const LIVE_ANSWERED = parseChatSse(
  frame({ kind: "content", content: "The overload trips at 115% FLA [1]." }) +
    frame({ kind: "sources", citations: [CITATION], sourceSnapshot: ["d1"] }) +
    frame({ kind: "evidence", basis: "oem_documentation", label: "From the manual" }) +
    frame({ kind: "status", status: "answered" }),
);

/** What the screen produces when the technician presses Stop: the catch path
 *  sets `status: "stopped"` explicitly. It ALSO has no `status` frame — which
 *  is exactly why the predicate must separate the two. */
const LIVE_STOPPED: ChatTurn = { ...LIVE_TRUNCATED, status: "stopped", citations: [] };

const detail = (turns: unknown[] = []) => ({
  notebook: { id: "nb1", displayName: "CV-101", manufacturer: null, model: null },
  sources: [],
  turns,
});

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

async function ask(question: string) {
  const input = (await screen.findByRole("textbox", { name: "Ask a question" })) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: question } });
  await act(async () => {
    fireEvent.keyDown(input, { key: "Enter" });
  });
}

function resolveWith(turn: ChatTurn) {
  askNotebook.mockImplementation(
    async (_id: string, _msg: string, _scope: unknown, opts: { onUpdate?: (t: ChatTurn) => void }) => {
      opts.onUpdate?.({ answer: "The overload", citations: [], status: "" });
      return turn;
    },
  );
}

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

describe("isTruncatedTurn — the one predicate both surfaces share", () => {
  it("guards the fixtures: the parser really produced a truncated turn holding citations", () => {
    expect(LIVE_TRUNCATED.sawStatus).toBe(false);
    expect(LIVE_TRUNCATED.citations).toHaveLength(1);
    expect(LIVE_TRUNCATED.status).toBe("");
    // The control must NOT look truncated, or every assertion below is vacuous.
    expect(LIVE_ANSWERED.sawStatus).toBeUndefined();
    expect(LIVE_ANSWERED.status).toBe("answered");
  });

  it("a missing status frame is a truncation", () => {
    expect(isTruncatedTurn(LIVE_TRUNCATED)).toBe(true);
  });

  it("a technician Stop is NOT a truncation, even though it also has no status frame", () => {
    expect(isTruncatedTurn(LIVE_STOPPED)).toBe(false);
  });

  it("a completed turn is not a truncation", () => {
    expect(isTruncatedTurn(LIVE_ANSWERED)).toBe(false);
  });
});

describe.each(SURFACES)("ADR-0038 rule 6 — unexpected truncation — %s", (_name, available) => {
  it("keeps the partial text but ships NO citation chip", async () => {
    resolveWith(LIVE_TRUNCATED);
    mount(available);
    await ask("trip point?");

    expect(await screen.findByText(/overload trips at 115%/i)).toBeTruthy();
    // The chip is the fabricated-completion tell: the turn never finished, so
    // it cannot present a source as proof of a finished answer.
    await waitFor(() => expect(screen.queryByText(/GS10 manual/)).toBeNull());
  });

  it("wears no other success chrome (basis caption, follow-ups)", async () => {
    resolveWith(LIVE_TRUNCATED);
    mount(available);
    await ask("trip point?");
    await screen.findByText(/overload trips at 115%/i);

    expect(screen.queryByText(/General guidance/i)).toBeNull();
    expect(screen.queryByLabelText(/Ask follow-up/i)).toBeNull();
  });

  it("is visually distinguishable from a successful answer", async () => {
    resolveWith(LIVE_TRUNCATED);
    mount(available);
    await ask("trip point?");

    expect(await screen.findByText(/incomplete/i)).toBeTruthy();
  });

  it("does NOT blame the technician by calling it Stopped", async () => {
    resolveWith(LIVE_TRUNCATED);
    mount(available);
    await ask("trip point?");
    await screen.findByText(/incomplete/i);

    expect(screen.queryByText(/^Stopped$/)).toBeNull();
  });
});

describe.each(SURFACES)("ADR-0038 rule 6 — technician Stop still works — %s", (_name, available) => {
  it("reads as Stopped, not as a truncation", async () => {
    resolveWith(LIVE_STOPPED);
    mount(available);
    await ask("trip point?");

    expect(await screen.findByText(/^Stopped$/)).toBeTruthy();
    expect(screen.queryByText(/incomplete/i)).toBeNull();
  });

  it("keeps the partial text and still ships no citations", async () => {
    resolveWith(LIVE_STOPPED);
    mount(available);
    await ask("trip point?");
    await screen.findByText(/^Stopped$/);

    expect(screen.queryByText(/GS10 manual/)).toBeNull();
  });
});

describe.each(SURFACES)("ADR-0038 rule 6 — the healthy path is untouched — %s", (_name, available) => {
  it("a completed answer keeps its citation chip and shows no incomplete caption", async () => {
    resolveWith(LIVE_ANSWERED);
    mount(available);
    await ask("trip point?");

    // The non-regression control: if the guards over-fire, this goes red.
    expect(await screen.findByText(/GS10 manual/)).toBeTruthy();
    expect(screen.queryByText(/incomplete/i)).toBeNull();
    expect(screen.queryByText(/^Stopped$/)).toBeNull();
  });
});
