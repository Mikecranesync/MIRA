// @vitest-environment jsdom
// Phone ↔ /v3 parity in the mounted unified shell (2026-10-07 Pixel
// acceptance on staging 5da41825a): row 2 (reloaded caption provenance),
// row 4 (the sent photo as a picture), R7 (Try again leaves the composer empty).
// Run: cd mira-mobile && npx vitest run tests/unified-reload-parity
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sources = vi.hoisted(() => ({ fetchNotebookSources: vi.fn() }));
vi.mock("../src/api/notebook-sources", () => sources);
const client = vi.hoisted(() => ({ requestBinary: vi.fn() }));
vi.mock("../src/api/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/api/client")>();
  return { ...real, ...client };
});
vi.mock("../src/api/manual-search-status", () => ({ fetchManualSearchStatus: vi.fn(async () => null) }));
vi.mock("@capacitor/share", () => ({ Share: { share: vi.fn(async () => ({})) } }));

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { UnifiedChat } from "../src/screens/UnifiedChat";
import type { NotebookServerTurn } from "../src/api/resources";
import { _resetTransientLayersForTest } from "../src/lib/transient-layer";
import { clearAttachments } from "../src/unified/attachment-handoff";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
if (!("scrollTo" in Element.prototype)) {
  Object.defineProperty(Element.prototype, "scrollTo", { value: () => {}, writable: true });
}

const META = { notebookId: "nb-1", title: "PF525 acceptance", asset: null, identityConfirmed: false };

function handlers(overrides: Partial<Record<string, unknown>> = {}) {
  return { onSend: vi.fn(), onStop: vi.fn(), onCitation: vi.fn(), onRetry: vi.fn(), ...overrides };
}

const CITED: NotebookServerTurn = {
  id: "row-1",
  question: "What does F004 mean?",
  answerStatus: "answered",
  answerText: "F004 is UnderVoltage [1].",
  evidence: [{ citationId: "1", sourceTitle: "PowerFlex 525 User Manual", page: 21, quote: "F004 UnderVoltage", docId: "doc-own", fileId: "file-own" }],
  basis: "oem_documentation",
};

const PHOTO: NotebookServerTurn = {
  id: "row-2",
  question: "What does this nameplate say?",
  answerStatus: "answered",
  answerText: "It reads 480 V.",
  evidence: [{ kind: "visual_observation", fileId: "photo-1", capturedAt: "2026-10-07T17:00:00Z", provenance: "phone_photo" }],
  basis: "workspace_evidence",
};

const createObjectURL = vi.fn((blob: Blob) => `blob:https://localhost/${blob.size}`);
const revokeObjectURL = vi.fn();

beforeEach(() => {
  sources.fetchNotebookSources.mockResolvedValue([]);
  client.requestBinary.mockRejectedValue(new Error("no bytes in this test"));
  Object.assign(URL, { createObjectURL, revokeObjectURL });
});

afterEach(() => {
  cleanup();
  _resetTransientLayersForTest();
  clearAttachments();
  vi.clearAllMocks();
});

function basisText(turnId: string): string {
  return document.querySelector(`[data-turn-id="${turnId}"] [data-part-type="evidence_basis"]`)?.textContent ?? "";
}

describe("row 2 — the reloaded caption names the notebook only when provable", () => {
  it("names the notebook once its sources are known to include every cited doc", async () => {
    sources.fetchNotebookSources.mockResolvedValue([{ docId: "doc-own", matchState: "user_confirmed" }]);
    render(<UnifiedChat turns={[CITED]} liveTurns={[]} pending={null} busy={false} canStop={false} canRetry={false} chatError={null} handlers={handlers()} meta={META} />);
    await waitFor(() => expect(basisText("row-1-a")).toContain("Grounded in this notebook's sources."));
    expect(sources.fetchNotebookSources).toHaveBeenCalledWith("nb-1");
  });

  it("stays neutral when the cited doc is not one of the notebook's sources", async () => {
    sources.fetchNotebookSources.mockResolvedValue([{ docId: "doc-else", matchState: "user_confirmed" }]);
    render(<UnifiedChat turns={[CITED]} liveTurns={[]} pending={null} busy={false} canStop={false} canRetry={false} chatError={null} handlers={handlers()} meta={META} />);
    await waitFor(() => expect(sources.fetchNotebookSources).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(basisText("row-1-a")).toContain("Grounded in the cited documentation.");
  });

  it("stays neutral when the sources cannot be read", async () => {
    sources.fetchNotebookSources.mockRejectedValue(new Error("offline"));
    render(<UnifiedChat turns={[CITED]} liveTurns={[]} pending={null} busy={false} canStop={false} canRetry={false} chatError={null} handlers={handlers()} meta={META} />);
    await waitFor(() => expect(sources.fetchNotebookSources).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(basisText("row-1-a")).toContain("Grounded in the cited documentation.");
  });
});

describe("row 4 — the sent photo shows as a picture", () => {
  it("shows the photo on the question and on the observation card, and revokes it on unmount", async () => {
    client.requestBinary.mockResolvedValue({ status: 200, bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" });
    const view = render(<UnifiedChat turns={[PHOTO]} liveTurns={[]} pending={null} busy={false} canStop={false} canRetry={false} chatError={null} handlers={handlers()} meta={META} />);
    await waitFor(() => expect(document.querySelector('[data-turn-id="row-2-a"] [data-part-type="visual_observation"] img')).not.toBeNull());
    expect(client.requestBinary).toHaveBeenCalledWith("/api/namespace/files/photo-1/");
    const cardImg = document.querySelector<HTMLImageElement>('[data-turn-id="row-2-a"] [data-part-type="visual_observation"] img')!;
    expect(cardImg.getAttribute("src")).toBe("blob:https://localhost/3");
    expect(document.querySelector('[data-turn-id="row-2-a"] [data-part-type="visual_observation"]')?.textContent).not.toContain("photo-1");
    const questionImg = document.querySelector<HTMLImageElement>('[data-turn-id="row-2-q"] [data-part-type="attachment"] img');
    expect(questionImg?.getAttribute("src")).toBe("blob:https://localhost/3");
    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:https://localhost/3");
  });

  it("keeps the file row when the bytes are not an image", async () => {
    client.requestBinary.mockResolvedValue({ status: 200, bytes: new Uint8Array([1]), contentType: "text/html" });
    render(<UnifiedChat turns={[PHOTO]} liveTurns={[]} pending={null} busy={false} canStop={false} canRetry={false} chatError={null} handlers={handlers()} meta={META} />);
    await waitFor(() => expect(client.requestBinary).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector('[data-turn-id="row-2-a"] [data-part-type="visual_observation"] img')).toBeNull();
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});

const ERROR = "Your question wasn't sent — try again.";

/** The classic host's retry contract (NotebookScreen `sendQuestion`): the
 *  retry clears the host error synchronously, then reports the outcome. */
function Host({ outcome, onRetried }: { outcome: () => "ok" | "fail" | "fail-batched"; onRetried: () => void }) {
  const [chatError, setChatError] = useState<string | null>(ERROR);
  const [failedQuestion, setFailedQuestion] = useState<string | null>("Why F004?");
  const retry = () => {
    onRetried();
    const result = outcome();
    if (result === "fail-batched") {
      // Cleared and re-failed before React renders: the error text never changes.
      setChatError(null);
      setChatError(ERROR);
      return;
    }
    setFailedQuestion(null);
    setChatError(null);
    if (result === "fail") {
      setTimeout(() => {
        setFailedQuestion("Why F004?");
        setChatError(ERROR);
      }, 0);
    }
  };
  return (
    <UnifiedChat
      turns={[CITED]}
      liveTurns={[]}
      pending={null}
      busy={false}
      canStop={false}
      canRetry={failedQuestion !== null}
      chatError={chatError}
      failedQuestion={failedQuestion}
      handlers={handlers({ onRetry: retry })}
      meta={META}
    />
  );
}

function composer(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: "Ask MIRA" }) as HTMLTextAreaElement;
}

describe("R7 — Try again sends the question, so it leaves the composer", () => {
  it("empties the composer the failure had refilled", async () => {
    const onRetried = vi.fn();
    render(<Host outcome={() => "ok"} onRetried={onRetried} />);
    await waitFor(() => expect(composer().value).toBe("Why F004?"));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetried).toHaveBeenCalledTimes(1);
    await act(async () => { await Promise.resolve(); });
    expect(composer().value).toBe("");
  });

  it("puts the question back when the retry fails again", async () => {
    render(<Host outcome={() => "fail"} onRetried={() => {}} />);
    await waitFor(() => expect(composer().value).toBe("Why F004?"));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("alert", { name: "Send error" })).toBeTruthy());
    await waitFor(() => expect(composer().value).toBe("Why F004?"));
  });

  it("puts the question back when the retry fails with the same error before a render", async () => {
    render(<Host outcome={() => "fail-batched"} onRetried={() => {}} />);
    await waitFor(() => expect(composer().value).toBe("Why F004?"));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await act(async () => { await Promise.resolve(); });
    expect(composer().value).toBe("Why F004?");
    expect(screen.getByRole("alert", { name: "Send error" })).toBeTruthy();
  });

  it("leaves a draft the technician has since edited alone", async () => {
    render(<Host outcome={() => "ok"} onRetried={() => {}} />);
    await waitFor(() => expect(composer().value).toBe("Why F004?"));
    fireEvent.input(composer(), { target: { value: "Something else" } });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await act(async () => { await Promise.resolve(); });
    expect(composer().value).toBe("Something else");
  });
});
