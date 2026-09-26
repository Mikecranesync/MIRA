// @vitest-environment jsdom
// The unified FactoryLM shell renders THIS notebook's real turns and routes
// every action back to the screen-owned handlers (send, stop, citation viewer,
// attach flows). Run: cd mira-mobile && npx vitest run src/screens/__tests__/unified-chat
import { afterEach, describe, expect, it, vi } from "vitest";

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
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { UnifiedChat } from "../src/screens/UnifiedChat";
import { useUnifiedAttachments } from "../src/unified/attachments";
import { clearAttachments } from "../src/unified/attachment-handoff";
import type { Attachment } from "@factorylm/interaction";
import type { NotebookServerTurn } from "../src/api/resources";
import { _resetTransientLayersForTest, closeTopTransientLayer } from "../src/lib/transient-layer";
// jsdom ships no ResizeObserver or Element.scrollTo; the assistant-ui thread
// viewport (ADR-0037) uses both to keep the scroll pinned as content grows.
// The Android WebView has had them since Chrome 64 — test-environment shim only.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
if (!("scrollTo" in Element.prototype)) {
  Object.defineProperty(Element.prototype, "scrollTo", { value: () => {}, writable: true });
}


vi.mock("@capacitor/share", () => ({ Share: { share: vi.fn(async () => ({})) } }));

const CITATION = { citationId: "c1", sourceTitle: "G120 Operating Instructions", page: 418, quote: "Check the supply.", docId: "doc-1", fileId: null };

const TURN: NotebookServerTurn = {
  id: "row-1",
  question: "Why does F30001 trip?",
  answerStatus: "answered",
  answerText: "Check the supply first [1].",
  evidence: [CITATION],
  basis: "documents",
};

// A hard stop is not a graded answer: the adapter suppresses citation/basis
// chrome on this turn (FLEET-003), and the shell must render it as an alert.
const SAFETY_TURN: NotebookServerTurn = {
  id: "row-2",
  question: "How do I bypass the interlock?",
  answerStatus: "answered",
  answerText: "Stop.",
  evidence: [
    CITATION,
    { kind: "safety_notice", trigger: "bypass the interlock" },
    { kind: "safety_stop", trigger: "bypass the interlock" },
  ],
  basis: "documents",
};

function handlers() {
  return {
    onSend: vi.fn(),
    onStop: vi.fn(),
    onCitation: vi.fn(),
    onAttachPhoto: vi.fn(),
    onAttachCamera: vi.fn(),
    onAttachFile: vi.fn(),
    onRetry: vi.fn(),
  };
}

const META = {
  notebookId: "nb-1",
  title: "Drive A",
  asset: { id: "asset-1", name: "Siemens G120" },
  identityConfirmed: true,
};

afterEach(() => {
  cleanup();
  _resetTransientLayersForTest();
  // The HOME handoff is module-level single-slot state; a test that stashes
  // must not leak into the next one.
  clearAttachments();
  vi.clearAllMocks();
});

describe("UnifiedChat", () => {
  it("renders the persisted turn through the shared shell with citation, basis, and safety parts", () => {
    const h = handlers();
    render(<UnifiedChat turns={[TURN, SAFETY_TURN]} liveTurns={[]} pending={null} busy={false} canStop={false} canRetry={false} chatError={null} handlers={h} meta={META} />);

    expect(screen.getByRole("region", { name: "Conversation" })).toBeTruthy();
    expect(screen.getByText("Why does F30001 trip?")).toBeTruthy();
    const parts = Array.from(document.querySelectorAll<HTMLElement>('[data-turn-id="row-1-a"] [data-part-type]')).map((el) => el.dataset.partType);
    expect(parts).toContain("source");
    expect(parts).toContain("evidence_basis");
    const safetyParts = Array.from(document.querySelectorAll<HTMLElement>('[data-turn-id="row-2-a"] [data-part-type]')).map((el) => el.dataset.partType);
    expect(safetyParts).toContain("safety_notice");
    expect(safetyParts).not.toContain("source");
    expect(safetyParts).not.toContain("evidence_basis");
    expect(screen.getByRole("alert").textContent).toMatch(/stop/i);
    expect(document.querySelector(".fl-conversation__bar")?.textContent).toContain("Siemens G120");
    expect(document.querySelector(".fl-shell")?.getAttribute("data-navigation-visible")).toBe("false");
  });

  it("sends through the screen's send path and opens citations in the screen's viewer", () => {
    const h = handlers();
    render(<UnifiedChat turns={[TURN]} liveTurns={[]} pending={null} busy={false} canStop={false} canRetry={false} chatError={null} handlers={h} meta={META} />);

    const box = screen.getByRole("textbox", { name: "Ask MIRA" }) as HTMLTextAreaElement;
    fireEvent.input(box, { target: { value: "What about braking?" } });
    fireEvent.submit(screen.getByRole("form", { name: "Composer" }));
    expect(h.onSend).toHaveBeenCalledWith("What about braking?");
    expect(box.value).toBe("");

    fireEvent.click(document.querySelector('button[data-part-type="source"]') as HTMLButtonElement);
    expect(h.onCitation).toHaveBeenCalledWith(expect.objectContaining({ citationId: "c1", sourceTitle: "G120 Operating Instructions", page: 418 }));
    expect(screen.queryByRole("dialog", { name: "Source viewer" })).toBeNull();
  });

  it("routes attach controls to the existing flows and exposes Stop while busy", () => {
    const h = handlers();
    const { rerender } = render(<UnifiedChat turns={[TURN]} liveTurns={[]} pending={null} busy={false} canStop={false} canRetry={false} chatError={null} handlers={h} meta={META} />);
    fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
    fireEvent.click(screen.getByRole("button", { name: "Photo" }));
    // The SHELL picks natively now. The host's upload-and-ask handler is
    // deliberately not called: it would send before the technician typed,
    // which is exactly the preview this refactor exists to provide.
    expect(nativePick.pickPhoto).toHaveBeenCalledTimes(1);
    expect(h.onAttachPhoto).not.toHaveBeenCalled();

    rerender(<UnifiedChat turns={[TURN]} liveTurns={[]} pending={{ q: "next", a: { answer: "", citations: [], status: "streaming" } }} busy={true} canStop={true} canRetry={false} chatError={null} handlers={h} meta={META} />);
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(h.onStop).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll("[data-turn-id]").length).toBe(4);
  });

  it("registers an open shell layer with the app's BACK stack and closes it on BACK", () => {
    const h = handlers();
    render(<UnifiedChat turns={[TURN]} liveTurns={[]} pending={null} busy={false} canStop={false} canRetry={false} chatError={null} handlers={h} meta={META} />);
    expect(closeTopTransientLayer()).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(document.querySelector(".fl-shell")?.getAttribute("data-navigation-visible")).toBe("true");
    act(() => {
      expect(closeTopTransientLayer()).toBe(true);
    });
    expect(document.querySelector(".fl-shell")?.getAttribute("data-navigation-visible")).toBe("false");
    expect(closeTopTransientLayer()).toBe(false);
  });

  it("shows and clears honest screen-owned failure copy", () => {
    const h = handlers();
    const { rerender } = render(
      <UnifiedChat turns={[]} liveTurns={[]} pending={null} busy={false} canStop={false} canRetry={false} chatError="The photo didn't upload — try again." handlers={h} meta={META} />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/photo didn't upload/i);
    rerender(
      <UnifiedChat turns={[]} liveTurns={[]} pending={null} busy={false} canStop={false} canRetry={false} chatError={null} handlers={h} meta={META} />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("restores the host's failed question after the pending turn has been cleared", async () => {
    const h = handlers();
    const { rerender } = render(
      <UnifiedChat turns={[]} liveTurns={[]} pending={null} busy={false} canStop={false} canRetry={false} chatError={null} handlers={h} meta={META} />,
    );

    rerender(
      <UnifiedChat
        turns={[]}
        liveTurns={[]}
        pending={null}
        busy={false}
        canStop={false}
        canRetry={true}
        chatError="Couldn't reach MIRA."
        failedQuestion="what is P06.01"
        handlers={h}
        meta={META}
      />,
    );

    await waitFor(() => expect((screen.getByRole("textbox", { name: "Ask MIRA" }) as HTMLTextAreaElement).value).toBe("what is P06.01"));
  });

  // An upload that fails must SAY so. The host-error mirror effect depends on
  // `state.draft`, so an unconditional `chatError ?? null` dispatch re-ran on
  // the very draft the attachment-failure path restores and erased the local
  // error — the technician saw the question reappear with no explanation.
  it("keeps an attachment failure visible while the host reports no error", async () => {
    nativePick.pickPhoto.mockResolvedValue(new File(["x"], "bearing.jpg", { type: "image/jpeg" }));
    resources.lookAtPhoto.mockRejectedValue(new Error("Network request failed"));
    const h = handlers();
    render(
      <UnifiedChat turns={[]} liveTurns={[]} pending={null} busy={false} canStop={false} canRetry={false}
        chatError={null} handlers={h} meta={META} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Photo" })); });

    const box = screen.getByRole("textbox", { name: "Ask MIRA" }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "what is this" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });

    // The question comes back AND the reason stays on screen.
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/upload|network/i));
    expect(box.value).toBe("what is this");
    // Still there after the effect re-runs on the restored draft.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("alert")).not.toBeNull();
  });

  // HOME stashes the bytes and creates the thread; the queued question then has
  // to COMPOSE them, or the very turn the technician attached the photo to is
  // answered without it (no /look/ upload, no visualEvidence rider).
  it("uploads a HOME-stashed attachment for the question that thread was created with", async () => {
    nativePick.pickPhoto.mockResolvedValue(new File(["x"], "bearing.jpg", { type: "image/jpeg" }));
    resources.lookAtPhoto.mockResolvedValue({ fileId: "file-home-9", observation: { capturedAt: "2026-09-16T00:00:00Z" } });

    // Stash exactly as the HOME shell does before it opens the new notebook.
    const home = renderHook(() => useUnifiedAttachments(null));
    let picked: Attachment | null = null;
    await act(async () => { picked = await home.result.current.attachPhoto(); });
    act(() => { home.result.current.stashForHandoff([picked as Attachment]); });
    home.unmount();

    const h = handlers();
    render(
      <UnifiedChat turns={[]} liveTurns={[]} pending={null} busy={false} canStop={false} canRetry={false}
        chatError={null} handlers={h} meta={META} initialQuestion="what is this" />,
    );

    await waitFor(() => expect(resources.lookAtPhoto).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(h.onSend).toHaveBeenCalledWith(
      "what is this",
      expect.objectContaining({ visualEvidence: expect.objectContaining({ fileId: "file-home-9" }) }),
    ));
  });

  // #4014 review (mira-f1): a PDF attached on HOME rides the thread it creates.
  // The queued question calls onSend(text, []) with an EMPTY pending list, so
  // only the hasCarried() clause keeps it from taking the plain text path, and
  // with it the upload and the scope re-read. Simplifying that guard would
  // silently re-open the ungrounded-manual defect, which only a device walk
  // would otherwise catch.
  it("grounds the question a HOME-carried manual was attached to", async () => {
    nativePick.pickDocument.mockResolvedValue(new File(["%PDF"], "gs10.pdf", { type: "application/pdf" }));
    resources.getNotebookDetail.mockResolvedValue({
      notebook: { id: "nb-1", nodeId: "node-1" },
      sources: [{ docId: "doc-carried", enabledByDefault: true, matchState: "user_confirmed" }],
    });
    resources.uploadSourceToNotebook.mockResolvedValue({ attached: true, duplicate: false, warning: null });

    const home = renderHook(() => useUnifiedAttachments(null));
    let picked: Attachment | null = null;
    await act(async () => { picked = await home.result.current.attachFile(); });
    act(() => { home.result.current.stashForHandoff([picked as Attachment]); });
    home.unmount();

    const h = handlers();
    render(
      <UnifiedChat turns={[]} liveTurns={[]} pending={null} busy={false} canStop={false} canRetry={false}
        chatError={null} handlers={h} meta={META} initialQuestion="what is the carrier limit" />,
    );

    await waitFor(() => expect(resources.uploadSourceToNotebook).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(h.onSend).toHaveBeenCalledWith("what is the carrier limit", undefined, ["doc-carried"]));
  });

  it("routes the shared shell Scan machine action to the host scanner", async () => {
    const h = { ...handlers(), onScanMachine: vi.fn(async () => null) };
    render(<UnifiedChat turns={[]} liveTurns={[]} pending={null} busy={false} canStop={false} canRetry={false} chatError={null} handlers={h} meta={META} />);

    fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
    fireEvent.click(screen.getByRole("button", { name: "Scan machine" }));

    await waitFor(() => expect(h.onScanMachine).toHaveBeenCalledTimes(1));
  });

  // The device FAIL (Pixel 9a, criterion 7): after a failed photo upload the
  // banner's "Try again" went through the HOST retry, which re-sends the
  // rendered turn as plain text — POST /chat/ with no visualEvidence and no
  // /look/ — and the answer rendered as an ordinary grounded answer. That is
  // exactly the outcome `compose` refuses on the first attempt. The host retry
  // is right for a text turn; it must not claim a turn whose bytes are still held.
  it("retries a failed attachment through the composed path, not the host's text retry", async () => {
    nativePick.pickPhoto.mockResolvedValue(new File(["x"], "bearing.jpg", { type: "image/jpeg" }));
    resources.lookAtPhoto
      .mockRejectedValueOnce(new Error("Network request failed"))
      .mockResolvedValue({ fileId: "file-retry-1", observation: { capturedAt: "2026-09-17T00:00:00Z" } });
    const h = handlers();
    // A prior turn exists, so the shell supplies a turnId and SendError prefers
    // the host retry — the same condition the phone was in.
    render(
      <UnifiedChat turns={[TURN]} liveTurns={[]} pending={null} busy={false} canStop={false} canRetry={true}
        chatError={null} handlers={h} meta={META} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Photo" })); });
    const box = screen.getByRole("textbox", { name: "Ask MIRA" }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "what is this" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
    await waitFor(() => expect(screen.getByRole("alert", { name: "Send error" })).toBeTruthy());

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });

    // The photo rides the retry, and the plain-text host path never claims it.
    expect(h.onRetry).not.toHaveBeenCalled();
    await waitFor(() => expect(resources.lookAtPhoto).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      const last = h.onSend.mock.calls.at(-1);
      expect(last?.[1]).toMatchObject({ visualEvidence: { fileId: "file-retry-1" } });
    });
  });

  // #3863: the bytes a failed upload keeps for Try again must never ride a
  // send the technician did not attach them to. Dismiss closes the error and
  // releases the chip; the next question is a plain text send — no upload, no
  // rider, no invisible photo.
  it("does not attach a dismissed failed photo to the next unrelated send (#3863)", async () => {
    nativePick.pickPhoto.mockResolvedValue(new File(["x"], "bearing.jpg", { type: "image/jpeg" }));
    resources.lookAtPhoto.mockRejectedValueOnce(new Error("Network request failed"));
    const h = handlers();
    render(
      <UnifiedChat turns={[TURN]} liveTurns={[]} pending={null} busy={false} canStop={false} canRetry={true}
        chatError={null} handlers={h} meta={META} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Photo" })); });
    const box = screen.getByRole("textbox", { name: "Ask MIRA" }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "what is this" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
    await waitFor(() => expect(screen.getByRole("alert", { name: "Send error" })).toBeTruthy());
    expect(resources.lookAtPhoto).toHaveBeenCalledTimes(1);
    expect(h.onSend).not.toHaveBeenCalled();

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Dismiss" })); });
    expect(screen.queryByRole("alert", { name: "Send error" })).toBeNull();

    fireEvent.change(box, { target: { value: "what is P06.01" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });

    // Plain text send: the host gets the question alone, and no upload ran.
    await waitFor(() => expect(h.onSend).toHaveBeenCalledTimes(1));
    expect(h.onSend.mock.calls[0]).toEqual(["what is P06.01"]);
    expect(resources.lookAtPhoto).toHaveBeenCalledTimes(1);
  });

});
