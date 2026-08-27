// The nameplate/PDF picker seam.
//
// The old path was a hidden <input type="file" capture="environment">. On
// Android the WebView decides what that means, and it landed on a chooser
// rather than the phone's own picker (#3353). This seam hands the job to the
// platform's native picker and returns a plain File either way, so callers do
// not branch.
//
// Run: cd mira-mobile && npx vitest run src/lib/__tests__/native-pick

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock factories are hoisted above every const, so the shared handles have
// to be hoisted too.
const { state, pickImages, pickFiles } = vi.hoisted(() => ({
  state: { native: true },
  pickImages: vi.fn(),
  pickFiles: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => state.native,
    convertFileSrc: (p: string) => `capacitor-file://localhost/_capacitor_file_${p}`,
  },
}));
vi.mock("@capawesome/capacitor-file-picker", () => ({
  FilePicker: { pickImages, pickFiles },
}));

import { pickNameplatePhoto, pickPdf, PDF_MIME } from "../native-pick";

beforeEach(() => {
  vi.resetAllMocks();
  state.native = true;
  vi.unstubAllGlobals();
});

/** A picked result as the native plugin returns it: a path, no blob. */
function nativeResult(over: Record<string, unknown> = {}) {
  return {
    files: [{ name: "nameplate.jpg", mimeType: "image/jpeg", size: 4, path: "/storage/emulated/0/DCIM/x.jpg", ...over }],
  };
}

describe("pickNameplatePhoto — native", () => {
  it("asks the PHONE for the image, never the WebView input", async () => {
    pickImages.mockResolvedValue(nativeResult());
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]))));

    const f = await pickNameplatePhoto();

    expect(pickImages).toHaveBeenCalledTimes(1);
    // One image, and the bytes are read back so the caller gets a real File.
    expect(pickImages.mock.calls[0][0]).toMatchObject({ limit: 1 });
    expect(f).toBeInstanceOf(File);
    expect(f?.name).toBe("nameplate.jpg");
    expect(f?.type).toBe("image/jpeg");
  });

  it("reads the bytes through the native path, not a base64 round trip", async () => {
    pickImages.mockResolvedValue(nativeResult());
    const fetchMock = vi.fn(async (_url: unknown) => new Response(new Uint8Array([9, 9])));
    vi.stubGlobal("fetch", fetchMock);

    await pickNameplatePhoto();

    // convertFileSrc is what makes a device path readable by the WebView.
    expect(String(fetchMock.mock.calls[0][0])).toContain("_capacitor_file_");
    expect(String(fetchMock.mock.calls[0][0])).toContain("/storage/emulated/0/DCIM/x.jpg");
  });

  it("returns null when the user backs out instead of throwing", async () => {
    pickImages.mockResolvedValue({ files: [] });
    expect(await pickNameplatePhoto()).toBeNull();
  });

  it("returns null when the plugin rejects (cancel is a rejection on some hosts)", async () => {
    pickImages.mockRejectedValue(new Error("canceled"));
    expect(await pickNameplatePhoto()).toBeNull();
  });

  it("prefers a blob the plugin already gave us over re-reading the path", async () => {
    pickImages.mockResolvedValue(nativeResult({ blob: new Blob([new Uint8Array([7])]) }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const f = await pickNameplatePhoto();

    expect(f).toBeInstanceOf(File);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to base64 data when there is neither blob nor readable path", async () => {
    pickImages.mockResolvedValue({
      files: [{ name: "n.jpg", mimeType: "image/jpeg", size: 3, data: btoa("abc") }],
    });
    const f = await pickNameplatePhoto();
    expect(f).toBeInstanceOf(File);
    expect(await f!.text()).toBe("abc");
  });

  it("names the file even when the picker returns no name", async () => {
    pickImages.mockResolvedValue(nativeResult({ name: undefined }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1]))));
    const f = await pickNameplatePhoto();
    expect(f?.name).toBeTruthy();
  });
});

describe("pickPdf — native", () => {
  it("asks the phone for a PDF specifically", async () => {
    pickFiles.mockResolvedValue({
      files: [{ name: "manual.pdf", mimeType: PDF_MIME, size: 2, path: "/storage/x.pdf" }],
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2]))));

    const f = await pickPdf();

    expect(pickFiles).toHaveBeenCalledTimes(1);
    expect(pickFiles.mock.calls[0][0]).toMatchObject({ types: [PDF_MIME], limit: 1 });
    expect(f?.type).toBe(PDF_MIME);
  });

  it("forces the pdf mime when the picker reports a vague one", async () => {
    pickFiles.mockResolvedValue({
      files: [{ name: "manual.pdf", mimeType: "application/octet-stream", size: 1, path: "/x.pdf" }],
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1]))));
    const f = await pickPdf();
    expect(f?.type).toBe(PDF_MIME);
  });
});

describe("web", () => {
  it("does NOT call the native plugin off-device", async () => {
    state.native = false;
    // No DOM picker is opened here either — the caller keeps its <input> for web.
    const f = await pickNameplatePhoto();
    expect(pickImages).not.toHaveBeenCalled();
    expect(f).toBeNull();
  });

  it("reports that it cannot serve the pick, so the caller can fall back", async () => {
    state.native = false;
    const { canPickNatively } = await import("../native-pick");
    expect(canPickNatively()).toBe(false);
  });

  it("reports it CAN serve the pick on device", async () => {
    state.native = true;
    const { canPickNatively } = await import("../native-pick");
    expect(canPickNatively()).toBe(true);
  });
});

describe("image MIME truth (EVID-1) — the picker's label is a claim, not a fact", () => {
  // Android's picker returns undefined or octet-stream for gallery images
  // often enough that trusting it sent real JPEGs to the recognizer as
  // octet-stream → 415. `data` variant avoids the fetch stub.
  const bytes = { data: btoa("abc"), path: undefined };

  it("derives image/jpeg from the extension when the picker returns no mime", async () => {
    pickImages.mockResolvedValue({ files: [{ name: "IMG_2041.JPG", ...bytes }] });
    const f = await pickNameplatePhoto();
    expect(f?.type).toBe("image/jpeg");
  });

  it("derives image/png when the picker declares octet-stream for a .png", async () => {
    pickImages.mockResolvedValue({
      files: [{ name: "shot.png", mimeType: "application/octet-stream", ...bytes }],
    });
    const f = await pickNameplatePhoto();
    expect(f?.type).toBe("image/png");
  });

  it("keeps a truthful declared image mime as-is", async () => {
    pickImages.mockResolvedValue({
      files: [{ name: "x.bin", mimeType: "image/webp", ...bytes }],
    });
    const f = await pickNameplatePhoto();
    expect(f?.type).toBe("image/webp");
  });

  it("falls back to image/jpeg — NEVER octet-stream — with no name and no mime", async () => {
    pickImages.mockResolvedValue({ files: [{ ...bytes }] });
    const f = await pickNameplatePhoto();
    expect(f?.type).toBe("image/jpeg");
    expect(f?.name).toBe("nameplate.jpg");
  });
});
