// @vitest-environment jsdom
// The canonical attachment controller: hold on pick, upload ONLY on send, and
// compose the evidence rider so it rides the notebook's one existing send path.
//
// Run: cd mira-mobile && bunx vitest run ../mira-mobile/tests/unified-attachments
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

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

import { useUnifiedAttachments } from "../src/unified/attachments";
import { claimAttachments, clearAttachments } from "../src/unified/attachment-handoff";
import type { Attachment } from "@factorylm/interaction";

type Controller = ReturnType<typeof useUnifiedAttachments>;

/** Render the hook and hand its API back, since it is a hook not a function. */
function mount(notebookId: string | null): () => Controller {
  let current: Controller | null = null;
  function Probe() {
    current = useUnifiedAttachments(notebookId);
    return null;
  }
  render(<Probe />);
  return () => current as Controller;
}

afterEach(() => {
  cleanup();
  clearAttachments();
  vi.clearAllMocks();
});

describe("unified attachments controller", () => {
  it("holds the picked file and uploads NOTHING until send", async () => {
    pick.pickPhoto.mockResolvedValue(new File(["x"], "bearing.jpg", { type: "image/jpeg" }));
    const get = mount("nb-1");

    let attachment: Attachment | null = null;
    await act(async () => { attachment = await get().attachPhoto(); });

    expect(attachment).toMatchObject({ name: "bearing.jpg", kind: "photo", status: "ready" });
    // The whole point of a preview: the technician has not sent yet.
    expect(api.lookAtPhoto).not.toHaveBeenCalled();
    expect(api.uploadSourceToNotebook).not.toHaveBeenCalled();
  });

  it("uploads the photo through the LOOK door and returns the visual-evidence rider", async () => {
    pick.pickPhoto.mockResolvedValue(new File(["x"], "bearing.jpg", { type: "image/jpeg" }));
    api.lookAtPhoto.mockResolvedValue({
      fileId: "file-9",
      observation: {
        text: "A carton containing individually boxed ball bearings.",
        capturedAt: "2026-09-16T21:17:20",
      },
    });
    const get = mount("nb-1");

    let a: Attachment | null = null;
    await act(async () => { a = await get().attachPhoto(); });
    let composed;
    await act(async () => { composed = await get().compose("why is it leaking", [a as Attachment]); });

    expect(api.lookAtPhoto).toHaveBeenCalledTimes(1);
    expect(composed).toEqual({
      question: "Visual observation (21:17:20, phone photo): A carton containing individually boxed ball bearings.\n\nwhy is it leaking",
      rider: { visualEvidence: { fileId: "file-9", capturedAt: "2026-09-16T21:17:20" } },
      warning: undefined,
    });
  });

  it("fails closed when the photo was saved but LOOK returned no observation", async () => {
    pick.pickPhoto.mockResolvedValue(new File(["x"], "bearing.jpg", { type: "image/jpeg" }));
    api.lookAtPhoto.mockResolvedValue({
      fileId: "file-9",
      observation: null,
      reason: "provider_error",
      message: "Could not describe the photo. The photo has been saved to this notebook.",
    });
    const get = mount("nb-1");

    let a: Attachment | null = null;
    await act(async () => { a = await get().attachPhoto(); });
    let composed;
    await act(async () => { composed = await get().compose("what is in this box", [a as Attachment]); });

    expect(composed).toMatchObject({
      question: "what is in this box",
      failure: expect.stringMatching(/photo was saved, but MIRA couldn't analyze it/i),
    });
    expect(composed).not.toHaveProperty("rider.visualEvidence");
    expect(get().hasCarried()).toBe(true);
  });

  it("refuses to send a photo question when the photo did not upload", async () => {
    pick.pickPhoto.mockResolvedValue(new File(["x"], "bearing.jpg", { type: "image/jpeg" }));
    api.lookAtPhoto.mockResolvedValue({ fileId: null });
    const get = mount("nb-1");

    let a: Attachment | null = null;
    await act(async () => { a = await get().attachPhoto(); });
    let composed;
    await act(async () => { composed = await get().compose("what is this", [a as Attachment]); });

    // Answering "what is this" with no picture would look grounded and not be.
    expect(composed).toMatchObject({ failure: expect.stringContaining("didn't upload") });
    expect(composed).not.toHaveProperty("rider.visualEvidence");
  });

  it("sends a general document through the source-upload door and reports an indexing failure honestly", async () => {
    pick.pickDocument.mockResolvedValue(new File(["x"], "notes.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }));
    api.getNotebookDetail.mockResolvedValue({ notebook: { id: "nb-1", nodeId: "node-1" } });
    api.uploadSourceToNotebook.mockResolvedValue({ attached: false, duplicate: false, warning: "unsupported" });
    const get = mount("nb-1");

    let a: Attachment | null = null;
    await act(async () => { a = await get().attachFile(); });
    expect(a).toMatchObject({ name: "notes.docx", kind: "file" });

    let composed;
    await act(async () => { composed = await get().compose("", [a as Attachment]); });

    expect(api.uploadSourceToNotebook).toHaveBeenCalledTimes(1);
    // Uploaded but not searchable must reach the technician, not be swallowed.
    expect(composed?.warning).toBeTruthy();
    expect(composed?.question).toBe("What is in this document?");
  });

  it("stashes on HOME and the notebook's controller claims it on the first send", async () => {
    pick.pickPhoto.mockResolvedValue(new File(["x"], "bearing.jpg", { type: "image/jpeg" }));
    const home = mount(null); // HOME: no notebook exists yet

    let a: Attachment | null = null;
    await act(async () => { a = await home().attachPhoto(); });
    act(() => { home().stashForHandoff([a as Attachment]); });
    cleanup();

    api.lookAtPhoto.mockResolvedValue({
      fileId: "file-9",
      observation: { text: "A leaking pump seal.", capturedAt: "2026-09-16T00:00:00Z" },
    });
    const notebook = mount("nb-1"); // the thread the send created
    let composed;
    await act(async () => { composed = await notebook().compose("what is leaking", []); });

    // Carried in with NO chip in this composer, so the shell cannot name it —
    // the controller has to merge it or the photo silently disappears.
    expect(api.lookAtPhoto).toHaveBeenCalledTimes(1);
    expect(composed?.rider?.visualEvidence.fileId).toBe("file-9");
    expect(claimAttachments()).toEqual([]); // claiming empties the handoff
  });

  // A failed upload must not silently disarm the next send. `held` still has the
  // bytes (they are dropped only on success), but `carried` was cleared before
  // the upload ran and the composer already released its chip — so without
  // retaining the items here the retry composes NOTHING and the photo question
  // goes out with no photo, which is the one thing this module refuses to do.
  it("retains a failed attachment so the next compose re-uploads it", async () => {
    pick.pickPhoto.mockResolvedValue(new File(["x"], "bearing.jpg", { type: "image/jpeg" }));
    api.lookAtPhoto.mockResolvedValueOnce({ fileId: null })
      .mockResolvedValue({
        fileId: "file-retry",
        observation: { text: "A bearing box.", capturedAt: "2026-09-17T00:00:00Z" },
      });
    const get = mount("nb-1");

    let a: Attachment | null = null;
    await act(async () => { a = await get().attachPhoto(); });
    let first;
    await act(async () => { first = await get().compose("what is this", [a as Attachment]); });
    expect(first).toMatchObject({ failure: expect.stringContaining("didn't upload") });

    // The controller still owns the bytes, so the retry can re-upload them.
    expect(get().hasCarried()).toBe(true);

    let second;
    await act(async () => { second = await get().compose("what is this", []); });
    expect(api.lookAtPhoto).toHaveBeenCalledTimes(2);
    expect(second).toMatchObject({ rider: { visualEvidence: { fileId: "file-retry" } } });
  });

  // Same guarantee when the upload THROWS rather than returning no fileId.
  it("retains a thrown attachment failure for the next compose", async () => {
    pick.pickPhoto.mockResolvedValue(new File(["x"], "bearing.jpg", { type: "image/jpeg" }));
    api.lookAtPhoto.mockRejectedValueOnce(new Error("Network request failed"))
      .mockResolvedValue({
        fileId: "file-thrown",
        observation: { text: "A bearing box.", capturedAt: "2026-09-17T00:00:00Z" },
      });
    const get = mount("nb-1");

    let a: Attachment | null = null;
    await act(async () => { a = await get().attachPhoto(); });
    await act(async () => {
      await get().compose("what is this", [a as Attachment]).catch(() => undefined);
    });

    expect(get().hasCarried()).toBe(true);
    let second;
    await act(async () => { second = await get().compose("what is this", []); });
    expect(second).toMatchObject({ rider: { visualEvidence: { fileId: "file-thrown" } } });
  });

});
