// @vitest-environment jsdom
// Sensor v0 S2 — LOOK in the notebook (contract §4.1, §2.3):
//   • picking a photo posts it to /look/ and renders an evidence card
//     (thumbnail of the parked file + observation)
//   • "Ask MIRA about this" closes the sheet and sends the prefixed question
//     through the notebook's ONE send path (askNotebook, same route)
//   • an intake failure shows the server's reason, not "nothing seen"
//
// Run: cd mira-mobile && bunx vitest run src/screens/__tests__/sensor-look

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false, convertFileSrc: (p: string) => p },
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

const { askNotebook, getNotebookDetail, lookAtPhoto } = vi.hoisted(() => ({
  askNotebook: vi.fn(),
  getNotebookDetail: vi.fn(),
  lookAtPhoto: vi.fn(),
}));

vi.mock("../../api/resources", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../api/resources")>();
  return { ...real, askNotebook, getNotebookDetail, lookAtPhoto };
});
// SourceThumb fetches bytes over the session; stub it to a marker so the card
// test asserts the thumbnail is wired to the PARKED file id.
vi.mock("../FilePreview", () => ({
  SourceThumb: ({ fileId }: { fileId: string }) => <span data-testid="thumb">{fileId}</span>,
  FilePreview: () => null,
}));

import { NotebookScreen } from "../NotebookScreen";
import { ApiError } from "../../api/client";

const detail = () => ({
  notebook: { id: "nb1", displayName: "CV-101", manufacturer: null, model: null, asset: null },
  sources: [],
  turns: [],
});

function mount() {
  const backRef = { current: null as (() => boolean) | null };
  return render(<NotebookScreen id="nb1" backRef={backRef} onExit={() => {}} />);
}

async function openLook() {
  fireEvent.click(await screen.findByRole("button", { name: "Open Sensor" }));
  fireEvent.click(await screen.findByRole("button", { name: "LOOK" }));
  const input = screen.getByLabelText("LOOK photo") as HTMLInputElement;
  const file = new File([new Uint8Array([0xff, 0xd8])], "panel.jpg", { type: "image/jpeg" });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

beforeEach(() => {
  askNotebook.mockReset();
  getNotebookDetail.mockReset();
  lookAtPhoto.mockReset();
  getNotebookDetail.mockResolvedValue(detail());
  Element.prototype.scrollTo = vi.fn();
});
afterEach(cleanup);

describe("Sensor LOOK (S2)", () => {
  it("renders the evidence card from the parked file + observation", async () => {
    lookAtPhoto.mockResolvedValue({
      fileId: "f-park",
      attachment: { linkId: "l1", notebookId: "nb1" },
      observation: { text: "Amber LED on the drive, DC bus indicator lit.", capturedAt: "2026-08-28T02:14:21", provenance: "phone_photo" },
      quality: null,
    });
    mount();
    const file = await openLook();
    await screen.findByTestId("look-card");
    // Request shape through the screen: notebook id, the exact File, one key.
    expect(lookAtPhoto).toHaveBeenCalledTimes(1);
    expect(lookAtPhoto.mock.calls[0][0]).toBe("nb1");
    expect(lookAtPhoto.mock.calls[0][1]).toBe(file);
    expect(typeof lookAtPhoto.mock.calls[0][2]).toBe("string");
    expect(screen.getByTestId("thumb").textContent).toBe("f-park");
    expect(screen.getByText("Amber LED on the drive, DC bus indicator lit.")).toBeTruthy();
    expect(screen.getByText(/Visual observation · Photo captured · 02:14:21/)).toBeTruthy();
    // S5 D1: LOOK links the file (workspace_file_links, role photo) — it is
    // NOT an equipment_notebook_sources row, so the card must not say "sources".
    expect(screen.getByText("Phone photo — saved to this notebook's files.")).toBeTruthy();
    expect(screen.queryByText(/notebook's sources/)).toBeNull();
    // The sources list is re-read: the photo is a linked source now.
    expect(getNotebookDetail.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("Ask MIRA about this closes the sheet and sends the prefixed question via askNotebook", async () => {
    lookAtPhoto.mockResolvedValue({
      fileId: "f-park",
      attachment: null,
      observation: { text: "Contactor K1 pulled in.", capturedAt: "2026-08-28T02:14:21", provenance: "phone_photo" },
      quality: null,
    });
    askNotebook.mockResolvedValue({
      answer: "ok",
      citations: [],
      status: "answered",
      // The server re-derived the entry from body.visualEvidence and echoed it
      // on the evidence frame; the live turn renders the card from that.
      visualEvidence: [{ kind: "visual_observation", fileId: "f-park", capturedAt: "2026-08-28T02:14:21", provenance: "phone_photo" }],
    });
    mount();
    await openLook();
    await screen.findByTestId("look-card");
    fireEvent.change(screen.getByLabelText("Question about this photo"), {
      target: { value: "Is that normal at idle?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask MIRA about this" }));
    await waitFor(() => expect(askNotebook).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog", { name: "Sensor" })).toBeNull();
    const [nbId, question, scope, opts] = askNotebook.mock.calls[0];
    expect(nbId).toBe("nb1");
    expect(scope).toEqual([]);
    expect(question).toBe(
      "Visual observation (02:14:21, phone photo): Contactor K1 pulled in.\n\nIs that normal at idle?",
    );
    // S5 D3: the parked photo rides as identifiers only — the server verifies
    // the link and re-derives the evidence entry.
    expect(opts.visualEvidence).toEqual({ fileId: "f-park", capturedAt: "2026-08-28T02:14:21" });
    expect(opts.machineEvidence).toBeUndefined();
    // The question posts in the conversation like any other turn.
    await screen.findByText("ok");
    // …and the live turn renders the Visual observation card with the thumb.
    const card = screen.getByTestId("visual-observation-card");
    expect(card.querySelector(".title")?.textContent).toBe("Visual observation · Photo captured · 02:14:21");
    expect(card.querySelector('[data-testid="thumb"]')?.textContent).toBe("f-park");
    expect(screen.queryByRole("button", { name: /f-park/ })).toBeNull();
  });

  it("S5 D3: a failed send keeps visualEvidence on the pending body so Retry is byte-identical", async () => {
    lookAtPhoto.mockResolvedValue({
      fileId: "f-park",
      attachment: null,
      observation: { text: "Contactor K1 pulled in.", capturedAt: "2026-08-28T02:14:21", provenance: "phone_photo" },
      quality: null,
    });
    askNotebook
      .mockRejectedValueOnce(new ApiError("server", 500, "HTTP 500"))
      .mockResolvedValueOnce({ answer: "ok", citations: [], status: "answered" });
    mount();
    await openLook();
    await screen.findByTestId("look-card");
    fireEvent.click(screen.getByRole("button", { name: "Ask MIRA about this" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(askNotebook).toHaveBeenCalledTimes(2));
    const [, q1, s1, o1] = askNotebook.mock.calls[0];
    const [, q2, s2, o2] = askNotebook.mock.calls[1];
    expect(q2).toBe(q1);
    expect(s2).toEqual(s1);
    expect(o2.visualEvidence).toEqual({ fileId: "f-park", capturedAt: "2026-08-28T02:14:21" });
    expect(o2.visualEvidence).toEqual(o1.visualEvidence);
    expect(o2.history).toEqual(o1.history);
  });

  it("S5 D3: a persisted turn renders the Visual observation card from evidence[] — no chip, no basis change", async () => {
    getNotebookDetail.mockResolvedValue({
      ...detail(),
      turns: [
        {
          id: "t1",
          question: "Visual observation (02:14:21, phone photo): Contactor K1 pulled in.\n\nIs that normal?",
          answerStatus: "answered",
          answerText: "Yes at idle [1].",
          basis: "oem_documentation",
          evidence: [
            { citationId: "1", sourceTitle: "gs10.pdf", page: 12, docId: "d1" },
            { kind: "visual_observation", fileId: "f-park", capturedAt: "2026-08-28T02:14:21", provenance: "phone_photo" },
          ],
        },
      ],
    });
    mount();
    const card = await screen.findByTestId("visual-observation-card");
    expect(card.querySelector(".title")?.textContent).toBe("Visual observation · Photo captured · 02:14:21");
    expect(card.querySelector('[data-testid="thumb"]')?.textContent).toBe("f-park");
    expect(card.textContent).toContain("saved to this notebook's files");
    // Exactly one citation chip — the document one; the photo is not a chip.
    expect(screen.getAllByRole("button", { name: /gs10\.pdf/ })).toHaveLength(1);
    expect(screen.queryByText(/General guidance/)).toBeNull();
    expect(screen.queryByTestId("machine-replay-card")).toBeNull();
  });

  it("§4.1: provider failure with the parked file renders the evidence card (no description) + Ask MIRA", async () => {
    lookAtPhoto.mockResolvedValue({
      fileId: "f-park",
      attachment: { linkId: "l1", notebookId: "nb1" },
      observation: null,
      quality: null,
      reason: "provider_error",
      message: "Could not describe the photo. The photo has been saved to this notebook.",
    });
    askNotebook.mockResolvedValue({ answer: "ok", citations: [], status: "answered" });
    mount();
    await openLook();
    await screen.findByTestId("look-card");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("thumb").textContent).toBe("f-park");
    const note = screen.getByTestId("look-no-observation").textContent ?? "";
    expect(note).toContain("Could not describe the photo. The photo has been saved to this notebook.");
    expect(note).toMatch(/still ask MIRA/);
    fireEvent.click(screen.getByRole("button", { name: "Ask MIRA about this" }));
    await waitFor(() => expect(askNotebook).toHaveBeenCalledTimes(1));
    expect(askNotebook.mock.calls[0][1]).toContain("(no description available)");
  });

  it("an intake failure shows the server's reason (415), not an invented one", async () => {
    lookAtPhoto.mockRejectedValue(new ApiError("client", 415, "unsupported_image_type"));
    mount();
    await openLook();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/format isn't supported/);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  // S5 D1 (mobile half): the Hub returns linked LOOK photographs in `photos[]`.
  // The client used to drop that array, so "saved to this notebook's files"
  // was copy with no surface behind it — the technician could not find, open,
  // or verify the photo they had just taken.
  it("S5 D1: linked photos render as their own group under Sources and open in the EXISTING viewer", async () => {
    getNotebookDetail.mockResolvedValue({
      ...detail(),
      photos: [
        {
          fileId: "f-1",
          filename: "panel.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 40123,
          createdAt: "2026-08-28T02:14:21",
          linkedAt: null,
        },
      ],
    });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Sources \(0\)/ }));
    const group = await screen.findByTestId("notebook-photos");
    expect(group.textContent).toContain("Photos (1)");
    expect(group.textContent).toContain("panel.jpg");
    expect(group.textContent).toContain("Photo captured · 02:14:21");
    // A linked photo is a FILE, not a source: it can never be chat scope, so
    // there is no include-in-chat checkbox to imply otherwise.
    expect(group.querySelector('input[type="checkbox"]')).toBeNull();
    expect(within(group).getByTestId("thumb").textContent).toBe("f-1");
    // Tap → the same FilePreview door a source uses. No second viewer.
    fireEvent.click(within(group).getByRole("button", { name: "Open" }));
    expect(await screen.findByRole("dialog", { name: "panel.jpg" })).toBeTruthy();
  });

  it("no linked photos → no Photos group at all (never an empty 'Photos (0)')", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Sources \(0\)/ }));
    expect(await screen.findByRole("button", { name: "+ Add sources" })).toBeTruthy();
    expect(screen.queryByTestId("notebook-photos")).toBeNull();
  });

  // MAJOR-3 mitigation: the observation TEXT is session state (no Sensor store
  // in v0), but closing the sheet to check something must not destroy it.
  it("reopening Sensor → LOOK restores this session's last observation, still askable", async () => {
    lookAtPhoto.mockResolvedValue({
      fileId: "f-park",
      attachment: null,
      observation: { text: "Contactor K1 pulled in.", capturedAt: "2026-08-28T02:14:21", provenance: "phone_photo" },
      quality: null,
    });
    askNotebook.mockResolvedValue({ answer: "ok", citations: [], status: "answered" });
    mount();
    await openLook();
    await screen.findByTestId("look-card");
    // Leave WITHOUT asking — the case that used to lose the observation.
    fireEvent.click(screen.getByRole("button", { name: "← Modes" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "Sensor" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open Sensor" }));
    fireEvent.click(await screen.findByRole("button", { name: "LOOK" }));
    const card = await screen.findByTestId("look-card");
    // Labelled as the one already taken, not as a fresh capture — and no
    // second upload happened.
    expect(card.querySelector(".title")?.textContent).toBe("Last observation · 02:14:21");
    expect(card.textContent).toContain("Contactor K1 pulled in.");
    expect(lookAtPhoto).toHaveBeenCalledTimes(1);
    // The restored card is fully live: asking sends the SAME parked photo.
    fireEvent.click(screen.getByRole("button", { name: "Ask MIRA about this" }));
    await waitFor(() => expect(askNotebook).toHaveBeenCalledTimes(1));
    expect(askNotebook.mock.calls[0][3].visualEvidence).toEqual({
      fileId: "f-park",
      capturedAt: "2026-08-28T02:14:21",
    });
  });
});
