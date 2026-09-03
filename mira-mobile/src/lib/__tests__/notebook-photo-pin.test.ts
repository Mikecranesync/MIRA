// Pointing at a photograph — the pure half.
//
// The hub deleted its phrasing heuristic: the notebook photo re-read now fires
// if and only if the client NAMES one attached photograph
// (`body.photoRead.docId`) that is already one of this turn's in-scope photo
// sources. That makes three client-side properties part of the contract rather
// than cosmetics, and each is pinned here:
//
//   1. eligibility MIRRORS the server's `isPhotoSource` UNION — the button
//      must not appear on a different set of rows than the server honours;
//   2. a pin is re-derived against LIVE sources + scope, so unchecking or
//      detaching the pinned source drops it (the server would silently ignore
//      the pointer, and the hub has no frame that says so);
//   3. the rider is additive — a turn with NO pin sends a byte-identical body.
//
// Run: cd mira-mobile && bunx vitest run src/lib/__tests__/notebook-photo-pin

import { describe, it, expect, vi, beforeEach } from "vitest";

const { requestStream } = vi.hoisted(() => ({ requestStream: vi.fn() }));
vi.mock("../../api/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../api/client")>();
  return { ...real, requestStream };
});

import {
  askNotebook,
  canPinPhoto,
  isPhotoSource,
  resolvePhotoPin,
  toNotebookSource,
  type NotebookSource,
  type PhotoPin,
} from "../../api/resources";
import type { PendingSend } from "../composer";

const source = (over: Record<string, unknown> = {}): NotebookSource =>
  toNotebookSource({
    docId: "d-photo",
    filename: "IMG_2231.jpg",
    status: "indexed",
    enabledByDefault: true,
    matchState: "user_confirmed",
    fileId: "f-doc",
    originFileId: "f-photo",
    sourceRole: "photo",
    ...over,
  });

// Block body on purpose: `mockReset()` RETURNS the mock, and vitest treats a
// value returned from beforeEach as a teardown callback — an arrow with an
// expression body would hand vitest the mock itself and get it invoked with
// zero arguments after every test.
beforeEach(() => {
  requestStream.mockReset();
});

describe("isPhotoSource mirrors the server's UNION, not the row's either/or", () => {
  it("is TRUE for sourceRole 'photo' alone, originFileId alone, and both", () => {
    expect(isPhotoSource({ sourceRole: "photo", originFileId: null })).toBe(true);
    expect(isPhotoSource({ sourceRole: "manual", originFileId: "f-photo" })).toBe(true);
    expect(isPhotoSource({ sourceRole: "photo", originFileId: "f-photo" })).toBe(true);
  });

  it("is FALSE for an ordinary document row, however it is spelled", () => {
    expect(isPhotoSource({ sourceRole: "manual", originFileId: null })).toBe(false);
    expect(isPhotoSource({ sourceRole: null, originFileId: null })).toBe(false);
    // `!= null` on purpose: an absent field is not an origin file.
    expect(isPhotoSource({})).toBe(false);
    expect(isPhotoSource({ sourceRole: undefined, originFileId: undefined })).toBe(false);
  });
});

describe("canPinPhoto — only a photo the server would actually read", () => {
  it("needs BOTH: a photo source AND membership of this turn's scope", () => {
    const photo = source();
    expect(canPinPhoto(photo, ["d-photo"])).toBe(true);
    // Unchecked: its docId never reaches sourceDocIds, so the server
    // intersects the pointer away and answers as if it were never sent.
    expect(canPinPhoto(photo, [])).toBe(false);
    expect(canPinPhoto(photo, ["d-manual"])).toBe(false);
  });

  it("a MANUAL in scope is not pinnable — pointing at it reads nothing", () => {
    const manual = source({ docId: "d-manual", sourceRole: "manual", originFileId: null });
    expect(canPinPhoto(manual, ["d-manual"])).toBe(false);
  });

  it("an unconfirmed photo candidate is not pinnable, because it is never in scope", () => {
    // canBeChatSource gates scope, so a candidate cannot reach `scope` at all;
    // this pins the consequence rather than re-testing canBeChatSource.
    const candidate = source({ docId: "d-cand", matchState: "candidate" });
    expect(canPinPhoto(candidate, [])).toBe(false);
  });
});

describe("resolvePhotoPin — a pin never outlives the row it names", () => {
  const pin: PhotoPin = { docId: "d-photo", filename: "IMG_2231.jpg", fileId: "f-photo" };

  it("survives while the row is still an in-scope photo (same object, not a copy)", () => {
    expect(resolvePhotoPin(pin, [source()], ["d-photo"])).toBe(pin);
  });

  it("no pin in, no pin out", () => {
    expect(resolvePhotoPin(null, [source()], ["d-photo"])).toBeNull();
  });

  it("DROPS when the technician unchecks the pinned source", () => {
    expect(resolvePhotoPin(pin, [source({ enabledByDefault: false })], [])).toBeNull();
  });

  it("DROPS when the pinned source is detached (the row is gone)", () => {
    expect(resolvePhotoPin(pin, [], [])).toBeNull();
    expect(resolvePhotoPin(pin, [source({ docId: "d-other" })], ["d-other"])).toBeNull();
  });

  it("DROPS when a refresh turns the row into something that is not a photo", () => {
    const rewritten = source({ sourceRole: "manual", originFileId: null });
    expect(resolvePhotoPin(pin, [rewritten], ["d-photo"])).toBeNull();
  });
});

describe("askNotebook body.photoRead — additive only", () => {
  const sse =
    'data: {"kind":"content","content":"ok"}\n\ndata: {"kind":"status","status":"answered"}\n\n';
  const stream = () =>
    requestStream.mockImplementation(async (_p: string, o: { onChunk: (c: string) => void }) => {
      o.onChunk(sse);
      return { status: 200, data: null, text: sse };
    });

  it("sends {docId} when pointed, and the identifier ONLY — never the filename", async () => {
    stream();
    await askNotebook("nb-1", "read the wire numbers", ["d-photo"], {
      photoRead: { docId: "d-photo" },
    });
    expect(requestStream.mock.calls[0][1].json).toEqual({
      message: "read the wire numbers",
      sourceDocIds: ["d-photo"],
      photoRead: { docId: "d-photo" },
    });
    // The filename is the server's to name in an honest decline; it is never
    // ours to send, and it never reaches a provider.
    expect(JSON.stringify(requestStream.mock.calls[0][1].json)).not.toContain("IMG_");
  });

  it("an UNPINNED turn is byte-identical to one sent before this feature existed", async () => {
    stream();
    await askNotebook("nb-1", "what is P06.01", ["d-manual"]);
    expect(JSON.stringify(requestStream.mock.calls[0][1].json)).toBe(
      JSON.stringify({ message: "what is P06.01", sourceDocIds: ["d-manual"] }),
    );
    // Not even an explicit undefined: the conditional spread must omit the key.
    expect("photoRead" in (requestStream.mock.calls[0][1].json as object)).toBe(false);
  });

  it("rides alongside the other riders without displacing them", async () => {
    stream();
    const visual = { fileId: "f-park", capturedAt: "2026-08-28T02:14:21.000Z" };
    await askNotebook("nb-1", "what is lit?", ["d-photo"], {
      visualEvidence: visual,
      photoRead: { docId: "d-photo" },
    });
    expect(requestStream.mock.calls[0][1].json).toEqual({
      message: "what is lit?",
      sourceDocIds: ["d-photo"],
      visualEvidence: visual,
      photoRead: { docId: "d-photo" },
    });
  });
});

describe("PendingSend carries the pointer so a Retry is byte-identical", () => {
  it("a replayed body re-sends the SAME docId, never a recomputed one", async () => {
    const sse = 'data: {"kind":"status","status":"answered"}\n\n';
    requestStream.mockImplementation(async (_p: string, o: { onChunk: (c: string) => void }) => {
      o.onChunk(sse);
      return { status: 200, data: null, text: sse };
    });
    const body: PendingSend = {
      question: "read the wire numbers",
      scope: ["d-photo"],
      mode: undefined,
      history: [],
      photoRead: { docId: "d-photo" },
    };
    // The screen's retry path: replay the stored body verbatim.
    await askNotebook("nb-1", body.question, body.scope, {
      mode: body.mode,
      history: body.history,
      photoRead: body.photoRead,
    });
    expect(requestStream.mock.calls[0][1].json.photoRead).toEqual({ docId: "d-photo" });
  });
});
