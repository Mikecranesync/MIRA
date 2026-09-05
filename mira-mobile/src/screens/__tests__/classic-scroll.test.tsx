// @vitest-environment jsdom
// The classic NotebookScreen must open a notebook AT THE LATEST TURN, the same
// way ChatV2 does.
//
// THE BUG THIS PINS. The scroll effect's deps were
// `[liveTurns, busy, panel, pending]` — none of which change when the PERSISTED
// history finishes loading. On mount the component is still in its `loading`
// branch, so `scrollRef.current` is null and the effect is a no-op; on the
// render where the thread actually appears, no dep changed, so the effect never
// runs again. Result: opening a machine with history landed on the OLDEST
// question, ~4600 px above the newest answer (measured in Chromium at 412x915).
//
// Why it matters beyond tidiness: a safety hard-stop is normally the LAST turn.
// Landing at the top hides it below the fold, which reads exactly like "the
// safety banner is missing" — a false alarm during acceptance, or worse, a
// technician who scrolls away and never sees the refusal.
//
// Run: cd mira-mobile && bunx vitest run src/screens/__tests__/classic-scroll

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

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
    // "legacy" pins the CLASSIC surface — the one under test here.
    get: vi.fn(async () => ({ value: "legacy" })),
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

const turns = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    question: `Question ${i + 1}?`,
    answerStatus: "answered",
    answerText: `Answer ${i + 1}.`,
    evidence: [],
    basis: null,
  }));

const detail = (t: unknown[]) => ({
  notebook: { id: "nb1", displayName: "CV-101", manufacturer: null, model: null },
  sources: [],
  turns: t,
  photos: [],
});

let scrollCalls: { top?: number }[] = [];

beforeEach(() => {
  nativePlatform.value = false;
  askNotebook.mockReset();
  getNotebookDetail.mockReset();
  scrollCalls = [];
  // Record every scrollTo the screen performs on its scroll container.
  Object.defineProperty(Element.prototype, "scrollTo", {
    value: function (opts: { top?: number }) {
      scrollCalls.push(opts ?? {});
    },
    writable: true,
    configurable: true,
  });
  // jsdom reports 0 for layout; give the container a real height so
  // "scroll to the bottom" is a meaningful, non-zero assertion.
  Object.defineProperty(Element.prototype, "scrollHeight", {
    get() {
      return 4635;
    },
    configurable: true,
  });
});
afterEach(cleanup);

function mountClassic() {
  const backRef = { current: null as (() => boolean) | null };
  return render(
    <NotebookScreen id="nb1" backRef={backRef} onExit={() => {}} chatV2Available={false} />,
  );
}

describe("classic NotebookScreen — opens at the latest turn", () => {
  it("scrolls to the bottom once the PERSISTED thread has loaded", async () => {
    getNotebookDetail.mockResolvedValue(detail(turns(30)));
    mountClassic();

    // Wait for the thread to actually be on screen before asserting.
    expect(await screen.findByText("Question 30?")).toBeTruthy();

    await waitFor(() => {
      expect(scrollCalls.length).toBeGreaterThan(0);
    });
    // ...and it scrolled DOWN to the end, not to an arbitrary offset.
    expect(scrollCalls.at(-1)?.top).toBe(4635);
  });

  it("an empty notebook does not blow up (no turns to scroll to)", async () => {
    getNotebookDetail.mockResolvedValue(detail([]));
    mountClassic();
    expect(await screen.findByText(/Ask anything now/i)).toBeTruthy();
  });
});
