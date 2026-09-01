// @vitest-environment jsdom
// PIXEL ACCEPTANCE PRE-FLIGHT — what the composer actually shows ON DEVICE.
//
// WHY THIS EXISTS. Every other composer test mocks `isNativePlatform: () => false`,
// i.e. the dev browser. So the shipped NATIVE behaviour — the thing a technician
// on a Pixel actually sees — had no coverage at all. That gap matters right now
// because a physical-device acceptance script that says "press Stop" would send
// the operator looking for a control that is deliberately not rendered.
//
// THE SHIPPED RULE (`client.ts::canCancelChatTransport`):
//     return !Capacitor.isNativePlatform();
// and the composer:
//     busy && canStopGeneration ? <Stop> : busy ? <Working… disabled> : <Send>
//
// So on native: NO Stop control, a DISABLED "Working…" instead. That is an
// honest-UI decision, not a bug — the CapacitorHttp fetch patch buffers the
// response and drops AbortSignal (#3453), so a Stop button there would
// fabricate a stopped turn while the server kept working and kept billing.
//
// This file pins BOTH sides so the affordance cannot silently flip. When #3453
// lands (Hub CORS + WebView cookie store) the native expectation here is the
// thing that must be deliberately updated — it is the tripwire for that change.
//
// Run: cd mira-mobile && npx vitest run src/screens/__tests__/native-stop-affordance

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const platform = { native: true };

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => platform.native, convertFileSrc: (p: string) => p },
  CapacitorHttp: { request: vi.fn() },
  registerPlugin: () => ({}),
}));
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    // Pin the CLASSIC surface: it is the fail-closed fallback a technician
    // lands on when the ChatV2 capability is off, and it owns this composer.
    get: vi.fn(async ({ key }: { key: string }) =>
      key === "flm.chatui.v1" ? { value: "legacy" } : { value: null },
    ),
    set: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  },
}));

const { askNotebook, getNotebookDetail } = vi.hoisted(() => ({
  askNotebook: vi.fn(),
  getNotebookDetail: vi.fn(),
}));
vi.mock("../../api/resources", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../api/resources")>();
  return { ...real, askNotebook, getNotebookDetail };
});

import { NotebookScreen } from "../NotebookScreen";
import { canCancelChatTransport } from "../../api/client";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
if (!("scrollTo" in Element.prototype)) {
  Object.defineProperty(Element.prototype, "scrollTo", { value: () => {}, writable: true });
}

const detail = () => ({
  notebook: { id: "nb1", displayName: "CV-101", manufacturer: null, model: null },
  sources: [{ docId: "d1", filename: "GS10.pdf", enabledByDefault: true, status: "ready" }],
  turns: [],
});

function mount() {
  const backRef = { current: null as (() => boolean) | null };
  return render(<NotebookScreen id="nb1" backRef={backRef} onExit={() => {}} chatV2Available={false} />);
}

/** Put the composer into the in-flight state and leave it there. */
async function startGenerating() {
  askNotebook.mockImplementation(() => new Promise(() => {}) /* never settles */);
  mount();
  const ta = (await screen.findByRole("textbox", { name: "Ask a question" })) as HTMLTextAreaElement;
  fireEvent.change(ta, { target: { value: "what is F004" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

beforeEach(() => {
  askNotebook.mockReset();
  getNotebookDetail.mockReset();
  getNotebookDetail.mockResolvedValue(detail());
  Element.prototype.scrollTo = vi.fn();
});
afterEach(cleanup);

describe("canCancelChatTransport — the rule the composer reads", () => {
  it("is FALSE on native (the CapacitorHttp patch cannot cancel server-side)", () => {
    platform.native = true;
    expect(canCancelChatTransport()).toBe(false);
  });

  it("is TRUE in the browser (fetch propagates AbortSignal to the server)", () => {
    platform.native = false;
    expect(canCancelChatTransport()).toBe(true);
  });
});

describe("PIXEL: composer during generation on NATIVE", () => {
  beforeEach(() => {
    platform.native = true;
  });

  it("shows a DISABLED 'Working…' and NO Stop control", async () => {
    await startGenerating();

    // This is precisely what the operator will see on the phone.
    const working = await screen.findByRole("button", { name: "Working" });
    expect(working).toBeTruthy();
    expect((working as HTMLButtonElement).disabled).toBe(true);

    // The acceptance script must NOT ask anyone to press Stop here.
    expect(screen.queryByRole("button", { name: "Stop generating" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });
});

describe("WEB: the same composer in the browser", () => {
  beforeEach(() => {
    platform.native = false;
  });

  it("DOES show Stop, because there the abort reaches the server", async () => {
    await startGenerating();

    expect(await screen.findByRole("button", { name: "Stop generating" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Working" })).toBeNull();
  });
});
