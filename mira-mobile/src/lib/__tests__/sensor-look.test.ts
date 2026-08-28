// Sensor v0 S2 — LOOK, pure half (contract §4.1):
//   • request shape: multipart to /look/ with image + clientKey (+ question)
//   • the observation rides as a QUESTION PREFIX — conversation context, no
//     new store
//   • error copy reuses the nameplate lane's status→reason mapping
//
// Run: cd mira-mobile && bunx vitest run src/lib/__tests__/sensor-look

import { describe, it, expect, vi, beforeEach } from "vitest";

const { uploadMultipart } = vi.hoisted(() => ({ uploadMultipart: vi.fn() }));
vi.mock("../../api/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../api/client")>();
  return { ...real, uploadMultipart };
});

import { ApiError } from "../../api/client";
import { lookAtPhoto } from "../../api/resources";
import { hhmmss, lookErrorCopy, lookQuestion, LOOK_DEFAULT_QUESTION, SENSOR_MODES } from "../sensor";
import { nameplateErrorCopy } from "../nameplate-flow";

beforeEach(() => uploadMultipart.mockReset());

describe("SENSOR_MODES", () => {
  it("is exactly LOOK / READ / REPLAY, each with a description", () => {
    expect(SENSOR_MODES.map((m) => m.label)).toEqual(["LOOK", "READ", "REPLAY"]);
    for (const m of SENSOR_MODES) expect(m.description.length).toBeGreaterThan(10);
  });
});

describe("lookAtPhoto request shape", () => {
  it("posts multipart image + clientKey to the notebook's /look/ route", async () => {
    uploadMultipart.mockResolvedValue({
      status: 200,
      data: {
        fileId: "f-1",
        attachment: { linkId: "l-1", notebookId: "nb-1" },
        observation: { text: "Green LED lit, contactor coil energized.", capturedAt: "2026-08-28T14:21:09Z", provenance: "phone_photo" },
        quality: { blur: 0.1 },
      },
    });
    const file = new File([new Uint8Array([1, 2, 3])], "look.jpg", { type: "image/jpeg" });
    const r = await lookAtPhoto("nb-1", file, "key-1", "  read these LEDs ");
    expect(uploadMultipart).toHaveBeenCalledTimes(1);
    const [path, fd] = uploadMultipart.mock.calls[0] as [string, FormData];
    expect(path).toBe("/api/equipment-notebooks/nb-1/look/");
    expect(fd.get("image")).toBe(file);
    expect(fd.get("clientKey")).toBe("key-1");
    expect(fd.get("question")).toBe("read these LEDs");
    expect(r).toEqual({
      fileId: "f-1",
      attachment: { linkId: "l-1", notebookId: "nb-1" },
      observation: { text: "Green LED lit, contactor coil energized.", capturedAt: "2026-08-28T14:21:09Z", provenance: "phone_photo" },
      quality: { blur: 0.1 },
    });
  });

  it("omits an empty question and never invents an observation", async () => {
    uploadMultipart.mockResolvedValue({ status: 200, data: { fileId: "f-2", observation: null } });
    const r = await lookAtPhoto("nb-1", new File(["x"], "a.png", { type: "image/png" }), "k");
    const fd = uploadMultipart.mock.calls[0][1] as FormData;
    expect(fd.has("question")).toBe(false);
    expect(r.fileId).toBe("f-2");
    expect(r.observation).toBeNull();
    expect(r.attachment).toBeNull();
  });
});

describe("lookQuestion — the conversation-context prefix (§4.1)", () => {
  const at = new Date(2026, 7, 28, 2, 14, 21); // local 02:14:21

  it("prefixes the observation with time + provenance, blank line, then the question", () => {
    const q = lookQuestion("Two  LEDs lit,\n one amber.", at, "Which one is the fault?");
    expect(q).toBe(
      "Visual observation (02:14:21, phone photo): Two LEDs lit, one amber.\n\nWhich one is the fault?",
    );
  });

  it("falls back to the default question when the technician typed nothing", () => {
    const q = lookQuestion("Contactor A1 chattering.", at, "   ");
    expect(q.endsWith(`\n\n${LOOK_DEFAULT_QUESTION}`)).toBe(true);
    expect(q.startsWith("Visual observation (02:14:21, phone photo): ")).toBe(true);
  });

  it("hhmmss is the phone's local clock, zero-padded, honest on garbage", () => {
    expect(hhmmss(at)).toBe("02:14:21");
    expect(hhmmss("not a date")).toBe("--:--:--");
  });
});

describe("lookErrorCopy — same intake mapping as the nameplate lane", () => {
  it("415 / 413 / 502 reuse the nameplate sentences verbatim", () => {
    expect(lookErrorCopy(new ApiError("client", 415, "unsupported_image_type"))).toBe(
      nameplateErrorCopy("unsupported_image_type"),
    );
    expect(lookErrorCopy(new ApiError("client", 413, "image_too_large"))).toBe(
      nameplateErrorCopy("image_too_large"),
    );
    expect(lookErrorCopy(new ApiError("server", 502, "provider exploded"))).toBe(
      nameplateErrorCopy("provider_error"),
    );
  });

  it("503 and unknown failures get LOOK sentences that never mention a nameplate", () => {
    const s503 = lookErrorCopy(new ApiError("server", 503, "recognizer_not_configured"));
    const sNet = lookErrorCopy(new ApiError("network", null, "offline"));
    expect(s503).not.toMatch(/nameplate/i);
    expect(sNet).not.toMatch(/nameplate/i);
    expect(s503).not.toBe(sNet);
  });
});
