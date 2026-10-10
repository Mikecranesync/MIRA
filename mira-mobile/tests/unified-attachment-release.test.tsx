// @vitest-environment jsdom
// A picked photo's chip preview is a `blob:` URL (#4306). The browser keeps the
// photo's bytes alive until that URL is revoked, so every way a held photo can
// stop being sendable — removed from the composer, left behind on a thread
// switch, kept for a Try again the technician never takes — has to revoke it.
// Codex review of #4306 (F1): removal and unmount revoked nothing.
//
// Run: cd mira-mobile && bunx vitest run tests/unified-attachment-release
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nativePick = vi.hoisted(() => ({ pickPhoto: vi.fn(), capturePhoto: vi.fn(), pickDocument: vi.fn() }));
vi.mock("../src/lib/native-pick", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/native-pick")>();
  return { ...real, ...nativePick };
});
const resources = vi.hoisted(() => ({ lookAtPhoto: vi.fn(), uploadSourceToNotebook: vi.fn(), getNotebookDetail: vi.fn() }));
vi.mock("../src/api/resources", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/api/resources")>();
  return { ...real, ...resources };
});
vi.mock("@capacitor/share", () => ({ Share: { share: vi.fn(async () => ({})) } }));

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UnifiedChat } from "../src/screens/UnifiedChat";
import { useUnifiedAttachments } from "../src/unified/attachments";
import { clearAttachments } from "../src/unified/attachment-handoff";
import { _resetTransientLayersForTest } from "../src/lib/transient-layer";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
if (!("scrollTo" in Element.prototype)) {
  Object.defineProperty(Element.prototype, "scrollTo", { value: () => {}, writable: true });
}

const META = {
  notebookId: "nb-1",
  title: "Drive A",
  asset: { id: "asset-1", name: "Siemens G120" },
  identityConfirmed: true,
};

const LOOK_OK = {
  fileId: "file-1",
  observation: { capturedAt: "2026-10-08T00:00:00Z" },
  attachment: { linkId: "link-1", notebookId: "nb-1" },
  observationPersisted: true,
};

function handlers() {
  return {
    onSend: vi.fn(),
    onStop: vi.fn(),
    onCitation: vi.fn(),
    onRetry: vi.fn(),
    // Inline, exactly as UnifiedRoot and NotebookScreen pass it: a NEW function
    // on every parent render.
    onScanMachine: async () => null,
  };
}

function chat(h: ReturnType<typeof handlers>) {
  return (
    <UnifiedChat turns={[]} liveTurns={[]} pending={null} busy={false} canStop={false} canRetry={false}
      chatError={null} handlers={h} meta={META} />
  );
}

const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;
let created: string[] = [];
const revoke = vi.fn();

beforeEach(() => {
  created = [];
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:https://localhost/${created.length + 1}`;
    created.push(url);
    return url;
  });
  URL.revokeObjectURL = revoke;
});

afterEach(() => {
  cleanup();
  _resetTransientLayersForTest();
  clearAttachments();
  vi.clearAllMocks();
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
  revoke.mockReset();
});

async function pickPhoto(name: string) {
  nativePick.pickPhoto.mockResolvedValueOnce(new File(["x"], name, { type: "image/jpeg" }));
  fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Photo" })); });
}

function thumbs(): string[] {
  return Array.from(document.querySelectorAll("img.fl-composer__pending-thumb")).map((img) => img.getAttribute("src") ?? "");
}

describe("unified attachment previews are released", () => {
  it("revokes a photo's preview when its chip is removed", async () => {
    render(chat(handlers()));
    await pickPhoto("bearing.jpg");
    expect(thumbs()).toEqual(["blob:https://localhost/1"]);

    fireEvent.click(screen.getByRole("button", { name: "Remove bearing.jpg" }));

    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("blob:https://localhost/1");
  });

  // The trap behind the fix: the shared Composer releases whatever is pending
  // when its adapter changes, and the hosts hand UnifiedChat a fresh
  // onScanMachine on every render. A re-render must not cost the technician
  // the photo they are about to send.
  it("keeps a pending photo, and its preview, across a parent re-render", async () => {
    resources.lookAtPhoto.mockResolvedValue(LOOK_OK);
    const first = handlers();
    const { rerender } = render(chat(first));
    await pickPhoto("bearing.jpg");

    const second = handlers();
    rerender(chat(second));
    rerender(chat(handlers()));

    expect(revoke).not.toHaveBeenCalled();
    expect(thumbs()).toEqual(["blob:https://localhost/1"]);

    const box = screen.getByRole("textbox", { name: "Ask MIRA" }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "what is this" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
    await waitFor(() => expect(resources.lookAtPhoto).toHaveBeenCalledTimes(1));
    expect((resources.lookAtPhoto.mock.calls[0]?.[1] as File).name).toBe("bearing.jpg");
  });

  it("revokes a pending photo and a photo held for Try again when the chat goes away", async () => {
    resources.lookAtPhoto.mockRejectedValueOnce(new Error("Network request failed"));
    const { unmount } = render(chat(handlers()));

    // Photo 1: sent, failed, held for Try again (its chip is gone).
    await pickPhoto("first.jpg");
    const box = screen.getByRole("textbox", { name: "Ask MIRA" }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "what is this" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
    await waitFor(() => expect(screen.getByRole("alert", { name: "Send error" })).toBeTruthy());
    // Photo 2: still in the composer.
    await pickPhoto("second.jpg");
    expect(revoke).not.toHaveBeenCalled();

    unmount();

    expect(revoke).toHaveBeenCalledTimes(2);
    expect(new Set(revoke.mock.calls.map((call) => call[0]))).toEqual(
      new Set(["blob:https://localhost/1", "blob:https://localhost/2"]),
    );
  });

  // Control: a sent photo is revoked once by the send, and teardown does not
  // revoke it a second time.
  it("revokes a sent photo exactly once, including after the chat goes away", async () => {
    resources.lookAtPhoto.mockResolvedValue(LOOK_OK);
    const h = handlers();
    const { unmount } = render(chat(h));
    await pickPhoto("bearing.jpg");
    const box = screen.getByRole("textbox", { name: "Ask MIRA" }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "what is this" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
    await waitFor(() => expect(h.onSend).toHaveBeenCalledTimes(1));
    expect(revoke).toHaveBeenCalledTimes(1);

    unmount();

    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it("never creates a preview for a pick that resolves after the composer is gone", async () => {
    let resolvePick: (file: File) => void = () => {};
    nativePick.pickPhoto.mockReturnValueOnce(new Promise<File>((resolve) => { resolvePick = resolve; }));
    let attach: (() => Promise<unknown>) | null = null;
    function Probe() {
      attach = useUnifiedAttachments("nb-1").attachPhoto;
      return null;
    }
    const { unmount } = render(<Probe />);
    const result = (attach as unknown as () => Promise<unknown>)();

    unmount();
    resolvePick(new File(["x"], "late.jpg", { type: "image/jpeg" }));

    await expect(result).resolves.toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it("retains every preview through a refused batch and revokes all on a superseding plain send", async () => {
    let controller: ReturnType<typeof useUnifiedAttachments> | undefined;
    function Probe() {
      controller = useUnifiedAttachments("nb-1");
      return null;
    }
    const { unmount } = render(<Probe />);
    const chips = [];
    for (let i = 0; i < 5; i++) {
      nativePick.pickPhoto.mockResolvedValueOnce(new File(["x"], `mode-${i}.jpg`, { type: "image/jpeg" }));
      chips.push(await controller!.attachPhoto());
    }
    const descriptors = chips.filter((chip): chip is NonNullable<typeof chip> => chip !== null);
    const refused = await controller!.compose("Does this help?", descriptors);
    expect(refused.failure).toBe("Attach one photo per question.");
    expect(revoke).not.toHaveBeenCalled();
    const retry = await controller!.compose("Does this help?", [], { retry: true });
    expect(retry.failure).toBe("Attach one photo per question.");
    expect(revoke).not.toHaveBeenCalled();
    await controller!.compose("What is still unknown?", []);
    expect(new Set(revoke.mock.calls.map(call => call[0]))).toEqual(new Set(created));
    expect(revoke).toHaveBeenCalledTimes(5);
    expect(resources.lookAtPhoto).not.toHaveBeenCalled();
    unmount();
    expect(revoke).toHaveBeenCalledTimes(5);
  });

  it("preserves a retained chip's bytes and preview when explicitly resubmitted", async () => {
    let controller: ReturnType<typeof useUnifiedAttachments> | undefined;
    function Probe() {
      controller = useUnifiedAttachments("nb-1");
      return null;
    }
    const { unmount } = render(<Probe />);
    nativePick.pickPhoto.mockResolvedValueOnce(new File(["x"], "seat.jpg", { type: "image/jpeg" }));
    const chip = await controller!.attachPhoto();
    resources.lookAtPhoto.mockRejectedValueOnce(new Error("offline"));
    await expect(controller!.compose("What does this show?", [chip!])).rejects.toThrow("offline");
    expect(revoke).not.toHaveBeenCalled();
    resources.lookAtPhoto.mockResolvedValueOnce(LOOK_OK);
    const result = await controller!.compose("What does this show?", [chip!]);
    expect(result.failure).toBeUndefined();
    expect(result.rider?.visualEvidence.fileId).toBe("file-1");
    expect(revoke).toHaveBeenCalledTimes(1);
    unmount();
    expect(revoke).toHaveBeenCalledTimes(1);
  });

});
