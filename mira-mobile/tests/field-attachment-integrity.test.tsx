// @vitest-environment jsdom
// The canonical attachment controller: hold on pick, upload ONLY on send, and
// compose the evidence rider so it rides the notebook's one existing send path.
//
// Run: cd mira-mobile && bunx vitest run ../mira-mobile/tests/unified-attachments
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UnifiedChat } from "../src/screens/UnifiedChat";
import { _resetTransientLayersForTest } from "../src/lib/transient-layer";

const api = vi.hoisted(() => ({
  lookAtPhoto: vi.fn(),
  uploadSourceToNotebook: vi.fn(),
  getNotebookDetail: vi.fn(),
}));
const pick = vi.hoisted(() => ({
  pickPhoto: vi.fn(),
  capturePhoto: vi.fn(),
  pickDocument: vi.fn(),
}));

vi.mock("../src/api/resources", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/api/resources")>();
  return { ...real, ...api };
});
vi.mock("../src/lib/native-pick", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/native-pick")>();
  return { ...real, ...pick };
});

const missingChip = vi.hoisted(() => ({ enabled: false }));
vi.mock("../src/unified/attachments", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/unified/attachments")>();
  const { useCallback } = await import("react");
  return { ...real, useUnifiedAttachments: (...args: Parameters<typeof real.useUnifiedAttachments>) => {
    const controller = real.useUnifiedAttachments(...args);
    // Preserve the real hook's picker identity: #4306 releases pending chips
    // when the platform adapter changes, so an unstable test wrapper would
    // itself discard otherwise valid evidence on every render.
    const attachPhoto = useCallback(async () => {
      const chip = await controller.attachPhoto();
      return missingChip.enabled && chip ? { ...chip, id: "lost-byte-identity" } : chip;
    }, [controller.attachPhoto]);
    return { ...controller, attachPhoto };
  } };
});

import { useUnifiedAttachments } from "../src/unified/attachments";
import { claimAttachments, clearAttachments } from "../src/unified/attachment-handoff";
import type { Attachment } from "@factorylm/interaction";

type Controller = ReturnType<typeof useUnifiedAttachments>;

/** Render the hook and hand its API back, since it is a hook not a function. */
function mount(notebookId: string | null, threadId?: string | null): () => Controller {
  let current: Controller | null = null;
  function Probe() {
    current = useUnifiedAttachments(notebookId, threadId);
    return null;
  }
  render(<Probe />);
  return () => current as Controller;
}

afterEach(() => {
  cleanup();
  _resetTransientLayersForTest();
  clearAttachments();
  vi.clearAllMocks();
  missingChip.enabled = false;
});

describe("field photo batch evidence integrity", () => {
  it("refuses a five-photo question before any upload and retains every file for explicit retry", async () => {
    const get = mount("nb-1", "case-thread");
    const chips: Attachment[] = [];
    for (let i = 0; i < 5; i++) {
      pick.pickPhoto.mockResolvedValue(new File([`screen${i}`], `mode-${i}.jpg`, { type: "image/jpeg" }));
      await act(async () => { chips.push((await get().attachPhoto()) as Attachment); });
    }
    api.lookAtPhoto.mockResolvedValue({ fileId: "only-first", observation: { text: "PERI1", capturedAt: "2026-10-09T00:00:00Z" }, attachment: { linkId: "link" }, observationPersisted: true });
    let first: Awaited<ReturnType<Controller["compose"]>> | undefined;
    await act(async () => { first = await get().compose("Does this help?", chips); });
    expect(first?.failure).toBe("Attach one photo per question.");
    expect(first?.rider).toBeUndefined();
    expect(api.lookAtPhoto).not.toHaveBeenCalled();
    expect(api.uploadSourceToNotebook).not.toHaveBeenCalled();
    expect(get().hasRetained()).toBe(true);
    let retry: Awaited<ReturnType<Controller["compose"]>> | undefined;
    await act(async () => { retry = await get().compose("Does this help?", [], { retry: true }); });
    expect(retry?.failure).toBe("Attach one photo per question.");
    expect(api.lookAtPhoto).not.toHaveBeenCalled();
    await act(async () => { await get().compose("What is still unknown?", []); });
    expect(get().hasRetained()).toBe(false);
    expect(api.lookAtPhoto).not.toHaveBeenCalled();
  });
  it("does not upload a manual when the same unsupported send contains two photos", async () => {
    const get = mount("nb-1");
    const chips: Attachment[] = [];
    for (let i = 0; i < 2; i++) {
      pick.pickPhoto.mockResolvedValue(new File(["photo"], `mode-${i}.jpg`, { type: "image/jpeg" }));
      await act(async () => { chips.push((await get().attachPhoto()) as Attachment); });
    }
    pick.pickDocument.mockResolvedValue(new File(["manual"], "manual.pdf", { type: "application/pdf" }));
    await act(async () => { chips.push((await get().attachFile()) as Attachment); });
    api.getNotebookDetail.mockResolvedValue({ notebook: { id: "nb-1", nodeId: "node-1" }, sources: [] });
    api.uploadSourceToNotebook.mockResolvedValue({ attached: true });
    let result: Awaited<ReturnType<Controller["compose"]>> | undefined;
    await act(async () => { result = await get().compose("Compare these", chips); });
    expect(result?.failure).toBe("Attach one photo per question.");
    expect(api.lookAtPhoto).not.toHaveBeenCalled();
    expect(api.uploadSourceToNotebook).not.toHaveBeenCalled();
    expect(api.getNotebookDetail).not.toHaveBeenCalled();
  });
  it("keeps a missing chip explicit on retry instead of sending only the surviving photo", async () => {
    const get = mount("nb-1");
    pick.pickPhoto.mockResolvedValue(new File(["valid"], "valid.jpg", { type: "image/jpeg" }));
    let valid: Attachment | null = null;
    await act(async () => { valid = await get().attachPhoto(); });
    const missing: Attachment = { id: "lost-bytes", name: "missing.jpg", mediaType: "image/jpeg", kind: "photo", status: "ready" };
    api.lookAtPhoto.mockResolvedValue({ fileId: "valid-only", observation: { text: "One display", capturedAt: "2026-10-09T00:00:00Z" }, attachment: { linkId: "link" }, observationPersisted: true });
    let result: Awaited<ReturnType<Controller["compose"]>> | undefined;
    await act(async () => { result = await get().compose("Compare these two", [valid as Attachment, missing]); });
    expect(result?.failure).toContain("missing.jpg is no longer available");
    expect(api.lookAtPhoto).not.toHaveBeenCalled();
    expect(get().hasRetained()).toBe(true);
    await act(async () => { result = await get().compose("Compare these two", [], { retry: true }); });
    expect(result?.failure).toContain("missing.jpg is no longer available");
    expect(api.lookAtPhoto).not.toHaveBeenCalled();
  });
  it("counts distinct chip identities so a repeated descriptor is still one photo", async () => {
    const get = mount("nb-1");
    pick.pickPhoto.mockResolvedValue(new File(["valid"], "valid.jpg", { type: "image/jpeg" }));
    let valid: Attachment | null = null;
    await act(async () => { valid = await get().attachPhoto(); });
    api.lookAtPhoto.mockResolvedValue({ fileId: "one", observation: { text: "One display", capturedAt: "2026-10-09T00:00:00Z" }, attachment: { linkId: "link" }, observationPersisted: true });
    let result: Awaited<ReturnType<Controller["compose"]>> | undefined;
    await act(async () => { result = await get().compose("What is this?", [valid as Attachment, valid as Attachment]); });
    expect(result?.failure).toBeUndefined();
    expect(result?.rider?.visualEvidence.fileId).toBe("one");
    expect(api.lookAtPhoto).toHaveBeenCalledTimes(1);
  });
});

// Component seam: the adapter's refusal must remain visible and never invoke
// the host send. This is a local DOM test, not physical-device acceptance.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
if (!("scrollTo" in Element.prototype)) Object.defineProperty(Element.prototype, "scrollTo", { value: () => {}, writable: true });

describe("mobile shell photo-batch failure", () => {
  it("shows the refusal, restores the question, and does not send a partial turn", async () => {
    const onSend = vi.fn();
    render(<UnifiedChat turns={[]} liveTurns={[]} pending={null} busy={false} canStop={false} canRetry={false} chatError={null}
      handlers={{ onSend, onStop: vi.fn(), onCitation: vi.fn(), onAttachPhoto: vi.fn(), onAttachCamera: vi.fn(), onAttachFile: vi.fn() }}
      meta={{ notebookId: "nb-1", title: "ASI replay", asset: null, identityConfirmed: false }} />);
    for (let i = 0; i < 5; i++) {
      pick.pickPhoto.mockResolvedValue(new File([`display${i}`], `display-${i}.jpg`, { type: "image/jpeg" }));
      fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Photo" })); });
    }
    const box = screen.getByRole("textbox", { name: "Ask MIRA" }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Does this help?" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Attach one photo per question."));
    expect(box.value).toBe("Does this help?");
    expect(onSend).not.toHaveBeenCalled();
    expect(api.lookAtPhoto).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Attach one photo per question."));
    expect(onSend).not.toHaveBeenCalled();
    expect(api.lookAtPhoto).not.toHaveBeenCalled();
    expect(box.value).toBe("Does this help?");
  });
  it("keeps unavailable bytes explicit when Try again has no prior turn or host retry", async () => {
    missingChip.enabled = true;
    const onSend = vi.fn();
    render(<UnifiedChat turns={[]} liveTurns={[]} pending={null} busy={false} canStop={false} canRetry={false} chatError={null}
      handlers={{ onSend, onStop: vi.fn(), onCitation: vi.fn() }}
      meta={{ notebookId: "nb-1", title: "ASI replay", asset: null, identityConfirmed: false }} />);
    pick.pickPhoto.mockResolvedValue(new File(["x"], "missing.jpg", { type: "image/jpeg" }));
    fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Photo" })); });
    const box = screen.getByRole("textbox", { name: "Ask MIRA" }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "What does it show?" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("missing.jpg is no longer available"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("missing.jpg is no longer available"));
    expect(onSend).not.toHaveBeenCalled();
    expect(api.lookAtPhoto).not.toHaveBeenCalled();
    expect(box.value).toBe("What does it show?");
  });
  it.each([1, 2])("never revives %i dismissed photo(s) when an unrelated text failure is retried", async (count) => {
    const onSend = vi.fn();
    const handlers = { onSend, onStop: vi.fn(), onCitation: vi.fn() };
    const meta = { notebookId: "nb-1", title: "ASI replay", asset: null, identityConfirmed: false };
    const view = (chatError: string | null) => <UnifiedChat turns={[]} liveTurns={[]} pending={null}
      busy={false} canStop={false} canRetry={false} chatError={chatError} failedQuestion="What is P06.01?"
      handlers={handlers} meta={meta} />;
    const { rerender } = render(view(null));
    api.lookAtPhoto.mockReset();
    api.lookAtPhoto.mockRejectedValueOnce(new Error("offline"));
    for (let i = 0; i < count; i++) {
      pick.pickPhoto.mockResolvedValue(new File(["x"], `old-${i}.jpg`, { type: "image/jpeg" }));
      fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Photo" })); });
    }
    const box = screen.getByRole("textbox", { name: "Ask MIRA" }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "What does this show?" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
    await waitFor(() => expect(screen.getByRole("alert", { name: "Send error" })).toBeTruthy());
    const uploads = api.lookAtPhoto.mock.calls.length;
    expect(uploads).toBe(count === 1 ? 1 : 0);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    fireEvent.change(box, { target: { value: "What is P06.01?" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
    expect(onSend).toHaveBeenCalledTimes(1);
    rerender(view("Text request failed"));
    await waitFor(() => expect(screen.getByRole("alert", { name: "Send error" })).toBeTruthy());
    api.lookAtPhoto.mockResolvedValue({ fileId: "stale-photo", observation: { capturedAt: "now" }, attachment: { linkId: "link" }, observationPersisted: true });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2));
    expect(onSend.mock.calls[1]?.[0]).toBe("What is P06.01?");
    expect(onSend.mock.calls[1]?.[1]).toBeUndefined();
    expect(api.lookAtPhoto).toHaveBeenCalledTimes(uploads);
    expect(screen.queryByRole("alert", { name: "Send error" })).toBeNull();
  });

});
