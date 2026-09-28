// @vitest-environment jsdom
// Staging walk 2026-09-26 (emulator, APK dbd786a96): a manual attached in the
// unified composer uploaded and attached as a confirmed source, yet the turn it
// was attached to — and every later turn — went out with `sourceDocIds: []`
// and `mode: "general"`, because NotebookScreen's scope was computed before the
// upload and nothing refreshed it. The packet showed `oem_corpus_bm25`; the
// technician's own manual was never searched.
//
// Run: cd mira-mobile && bunx vitest run tests/unified-upload-scope
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  getNotebookDetail: vi.fn(),
  uploadSourceToNotebook: vi.fn(),
  askNotebook: vi.fn(),
}));
const pick = vi.hoisted(() => ({ pickDocument: vi.fn() }));

vi.mock("../src/api/resources", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/api/resources")>();
  return { ...real, ...api };
});
vi.mock("../src/lib/native-pick", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/native-pick")>();
  return { ...real, ...pick };
});

// jsdom ships no ResizeObserver or Element.scrollTo (same shim as unified-chat.test).
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

import { NotebookScreen } from "../src/screens/NotebookScreen";
import { clearAttachments } from "../src/unified/attachment-handoff";

const NOTEBOOK = {
  id: "nb-1",
  displayName: "GS10 Drive Line 1",
  manufacturer: "AutomationDirect",
  model: "GS10",
  equipmentType: null,
  identityStatus: "user_confirmed",
  nodeId: "node-1",
  sourceCount: 0,
  createdAt: null,
  asset: null,
};
const MANUAL = {
  docId: "doc-manual",
  filename: "gs10usermanual_part1.pdf",
  status: "parsed",
  enabledByDefault: true,
  matchState: "user_confirmed",
  pages: null,
  fileId: "file-manual",
  originFileId: null,
  sourceRole: "manual",
  matchEvidence: null,
};
const detail = (sources: unknown[]) => ({ notebook: NOTEBOOK, sources, turns: [], threads: [], photos: [] });
const ANSWER = { answer: "Not above 6 kHz [1].", citations: [], status: "answered" };
const HOST = { projects: [], machines: [], onOpenItem: () => {} };

afterEach(() => {
  cleanup();
  clearAttachments();
  vi.clearAllMocks();
});

async function attachManualAndSend() {
  render(<NotebookScreen id="nb-1" chromeless unifiedShell={HOST} backRef={{ current: null }} onExit={() => {}} />);
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Ask MIRA" })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "File" })); });
  fireEvent.change(screen.getByRole("textbox", { name: "Ask MIRA" }), {
    target: { value: "what carrier frequency should a drive larger than 20hp not exceed" },
  });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
  await waitFor(() => expect(api.askNotebook).toHaveBeenCalledTimes(1));
  return api.askNotebook.mock.calls[0];
}

describe("a manual attached in the unified composer grounds the turn it rides", () => {
  it("sends the freshly uploaded manual as scope, not an empty general turn", async () => {
    pick.pickDocument.mockResolvedValue(new File(["%PDF"], "gs10usermanual_part1.pdf", { type: "application/pdf" }));
    // Before the upload the notebook has no sources; the server's view after it does.
    api.getNotebookDetail
      .mockResolvedValueOnce(detail([]))
      .mockResolvedValue(detail([MANUAL]));
    api.uploadSourceToNotebook.mockResolvedValue({ attached: true, duplicate: false, warning: null });
    api.askNotebook.mockResolvedValue(ANSWER);

    const [notebookId, , scope, opts] = await attachManualAndSend();

    expect(api.uploadSourceToNotebook).toHaveBeenCalledTimes(1);
    expect(notebookId).toBe("nb-1");
    expect(scope).toEqual(["doc-manual"]);
    // Scoped means grounded: the turn must NOT be sent as an explicit general ask.
    expect(opts.mode).toBeUndefined();
  });

  it("keeps an unconfirmed or disabled source out of the re-read scope (fail-closed)", async () => {
    pick.pickDocument.mockResolvedValue(new File(["%PDF"], "x.pdf", { type: "application/pdf" }));
    api.getNotebookDetail
      .mockResolvedValueOnce(detail([]))
      .mockResolvedValue(detail([
        MANUAL,
        { ...MANUAL, docId: "doc-candidate", matchState: "candidate" },
        { ...MANUAL, docId: "doc-off", enabledByDefault: false },
      ]));
    api.uploadSourceToNotebook.mockResolvedValue({ attached: true, duplicate: false, warning: null });
    api.askNotebook.mockResolvedValue(ANSWER);

    const [, , scope] = await attachManualAndSend();

    expect(scope).toEqual(["doc-manual"]);
  });

  it("falls back to the host's scope when the post-upload re-read fails", async () => {
    pick.pickDocument.mockResolvedValue(new File(["%PDF"], "x.pdf", { type: "application/pdf" }));
    api.getNotebookDetail
      .mockResolvedValueOnce(detail([]))          // screen load
      .mockResolvedValueOnce(detail([]))          // compose: node lookup before upload
      .mockRejectedValueOnce(new Error("offline")) // compose: re-read after upload
      .mockResolvedValue(detail([]));
    api.uploadSourceToNotebook.mockResolvedValue({ attached: true, duplicate: false, warning: null });
    api.askNotebook.mockResolvedValue(ANSWER);

    const [, , scope, opts] = await attachManualAndSend();

    // The upload is not failed by a read; the turn goes out exactly as before this fix.
    expect(scope).toEqual([]);
    expect(opts.mode).toBe("general");
  });
});
