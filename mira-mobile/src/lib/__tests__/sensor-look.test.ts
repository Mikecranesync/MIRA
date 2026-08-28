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
import {
  hhmmss,
  lookErrorCopy,
  lookQuestion,
  visualCardTitle,
  visualObservationEntries,
  LOOK_DEFAULT_QUESTION,
  LOOK_SAVED_COPY,
  SENSOR_MODES,
} from "../sensor";
import { machineEvidenceEntries } from "../replay";
import { normalizeCitations, parseChatSse } from "../sse";
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
    expect(uploadMultipart.mock.calls[0][2]).toEqual({ acceptStatuses: [502, 503] });
    expect(r).toEqual({
      fileId: "f-1",
      attachment: { linkId: "l-1", notebookId: "nb-1" },
      observation: { text: "Green LED lit, contactor coil energized.", capturedAt: "2026-08-28T14:21:09Z", provenance: "phone_photo" },
      quality: { blur: 0.1 },
      reason: null,
      message: null,
    });
  });

  it("§4.1: a provider failure (502) STILL returns the parked file — observation null, server reason kept", async () => {
    uploadMultipart.mockResolvedValue({
      status: 502,
      data: {
        error: "vision_failed",
        reason: "provider_error",
        message: "Could not describe the photo. The photo has been saved to this notebook.",
        fileId: "f-park",
        attachment: { linkId: "l-9", notebookId: "nb-1" },
        observation: null,
      },
    });
    const r = await lookAtPhoto("nb-1", new File(["x"], "a.jpg", { type: "image/jpeg" }), "k");
    expect(r.fileId).toBe("f-park");
    expect(r.attachment).toEqual({ linkId: "l-9", notebookId: "nb-1" });
    expect(r.observation).toBeNull();
    expect(r.reason).toBe("provider_error");
    expect(r.message).toMatch(/has been saved/);
  });

  it("a 503 recognizer_not_configured body with the parked file is likewise an answer", async () => {
    uploadMultipart.mockResolvedValue({
      status: 503,
      data: { error: "recognizer_not_configured", reason: "recognizer_not_configured", message: "Visual inspection is not available.", fileId: "f-3", observation: null },
    });
    const r = await lookAtPhoto("nb-1", new File(["x"], "a.jpg", { type: "image/jpeg" }), "k");
    expect(r.fileId).toBe("f-3");
    expect(r.reason).toBe("recognizer_not_configured");
  });

  it("an accepted 5xx WITHOUT a parked file is still a typed error (nothing to show)", async () => {
    uploadMultipart.mockResolvedValue({ status: 503, data: { error: "recognizer_not_configured" } });
    await expect(lookAtPhoto("nb-1", new File(["x"], "a.jpg", { type: "image/jpeg" }), "k")).rejects.toMatchObject({
      kind: "server",
      status: 503,
      detail: "recognizer_not_configured",
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

describe("S5 D1: the LOOK card names where the photo went", () => {
  it("says 'files' — LOOK links in workspace_file_links, not equipment_notebook_sources", () => {
    expect(LOOK_SAVED_COPY).toBe("Phone photo — saved to this notebook's files.");
    expect(LOOK_SAVED_COPY).not.toMatch(/sources/);
  });
});

describe("S5 D3: the persisted {kind:\"visual_observation\"} entry", () => {
  const CAPTURED = "2026-08-28T02:14:21.000Z";
  const visual = { kind: "visual_observation", fileId: "f-park", capturedAt: CAPTURED, provenance: "phone_photo" };
  const citation = { citationId: "1", sourceTitle: "gs10.pdf", page: 12, docId: "d1" };
  const machine = { kind: "machine_evidence", assetId: "a", anchorAt: CAPTURED, pre: 60, post: 10, rowCount: 2, freshness: "stale" };

  it("card title is exactly 'Visual observation · Photo captured · HH:MM:SS'", () => {
    expect(visualCardTitle(CAPTURED)).toBe(`Visual observation · Photo captured · ${hhmmss(CAPTURED)}`);
  });

  it("is read by visualObservationEntries only; citations and machine readers skip it", () => {
    const evidence = [citation, visual, machine, { kind: "visual_observation" }, "junk", null];
    expect(visualObservationEntries(evidence)).toEqual([visual]);
    // A visual entry without a fileId is nothing to render — dropped, never a blank card.
    expect(visualObservationEntries([{ kind: "visual_observation", capturedAt: CAPTURED }])).toEqual([]);
    expect(normalizeCitations(evidence).map((c) => c.citationId)).toEqual(["1"]);
    expect(machineEvidenceEntries(evidence)).toHaveLength(1);
    expect(visualObservationEntries(undefined)).toEqual([]);
  });

  it("the live evidence frame carries it additively (single object, like machineEvidence) — basis untouched", () => {
    const body =
      'data: {"kind":"content","content":"A"}\n\n' +
      `data: {"kind":"sources","citations":[${JSON.stringify(citation)}]}\n\n` +
      `data: {"kind":"evidence","basis":"oem_documentation","label":"x","visualEvidence":${JSON.stringify(visual)}}\n\n` +
      'data: {"kind":"status","status":"answered"}\n\n';
    const t = parseChatSse(body);
    expect(t.evidenceBasis).toBe("oem_documentation");
    expect(t.citations).toHaveLength(1);
    expect(t.visualEvidence).toEqual([visual]);
    expect("machineEvidence" in t).toBe(false);
  });

  it("a visual entry riding in the machine field or an echoed evidence[] is still found by kind", () => {
    const inMachineField = parseChatSse(
      `data: {"kind":"evidence","basis":"machine_history","label":"x","machineEvidence":[${JSON.stringify(machine)},${JSON.stringify(visual)}]}\n\n`,
    );
    expect(inMachineField.machineEvidence).toHaveLength(1);
    expect(inMachineField.visualEvidence).toEqual([visual]);
    const echoed = parseChatSse(
      `data: {"kind":"evidence","basis":"oem_documentation","label":"x","evidence":[${JSON.stringify(citation)},${JSON.stringify(visual)}]}\n\n`,
    );
    expect(echoed.visualEvidence).toEqual([visual]);
    // No entry → the field is absent, never an empty claim.
    const plain = parseChatSse('data: {"kind":"evidence","basis":"oem_documentation","label":"y"}\n\n');
    expect("visualEvidence" in plain).toBe(false);
  });
});
