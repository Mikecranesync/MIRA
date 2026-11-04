/**
 * Codex adversarial review round 1 on PR #5173 @ 97c0516bf (2026-11-04), findings F1 and F3.
 * F1: a removal block the reader could not read in order must count as not read when the job needs
 *     it, and must not let the packet claim the whole job was read.
 * F3: when the packet takes off two parts, each one needs its own put-back steps; one found
 *     reinstall must not hide that the other is missing.
 * Fixture is invented (85-frame manual).
 */
import { describe, expect, it } from "vitest";
import { FIXTURES, fixturePages } from "./fixtures";
import { buildDraftPacket } from "../draft";
import { collectFields, verifyPacket } from "../verify";
import type { WorkPacket } from "../types";

function run(text: string): WorkPacket {
  const r = buildDraftPacket({
    notebookId: "11111111-1111-4111-8111-111111111111",
    packetId: "pk-r1",
    now: "2026-11-04T12:00:00Z",
    identity: { manufacturer: "CAT Pumps", model: "8520", catalogNumber: null, serialNumber: null, status: "user_confirmed", confidence: 0.9 },
    workOrder: { id: "WO-R1", title: "Reseal", description: "Pump leaking at the shaft — reseal it per the manufacturer's procedure.", assetTag: null, site: null, synthetic: true },
    docs: [{ docId: "sm", fileId: null, filename: "manual.pdf", pages: fixturePages(text), via: "file" }],
    hazardFlags: [],
  });
  if (!r.ok) throw new Error(r.message);
  return r.packet;
}

const BASE = FIXTURES["manual-85v2.txt"];
const verifiedSteps = (p: WorkPacket) =>
  collectFields(p).filter((l) => l.field.label === "verified" && l.path.startsWith("steps")).map((l) => l.path);

describe("F1 — an unreadable removal block the job needs is not read", () => {
  const garbled = BASE.replace(
    "1. Remove the eight (8) head screws.\n2. Tap the Outlet Head with a soft mallet and work it off the pump.",
    "2. Tap the Outlet Head with a soft mallet and work it off the pump.\n1. Remove the eight (8) head screws.",
  );

  it("precondition: the garble is in the fixture", () => {
    expect(garbled).not.toBe(BASE);
  });

  it("does not claim the whole job was read", () => {
    const p = run(garbled);
    expect(p.coverage!.complete).toBe(false);
    const s = p.coverage!.sections.find((x) => x.heading === "REMOVING THE OUTLET HEAD");
    expect(s?.status).toBe("not_read");
    expect(verifyPacket(p).some((x) => x.startsWith("coverage:"))).toBe(true);
    expect(verifiedSteps(p)).toEqual([]);
  });

  it("control: the readable manual is still complete", () => {
    const p = run(BASE);
    expect(p.coverage!.complete).toBe(true);
  });
});

describe("F3 — every removed part needs its own put-back steps", () => {
  // Step 7 no longer names the Outlet Head; the numbering stays whole so the block is still read.
  const noOutletBack = BASE.replace("7. Slide the Outlet Head over the Spacers.", "7. Check the Spacers for wear.");
  const outletBlocker = (p: WorkPacket) => JSON.stringify(p).includes("takes off the Outlet Head");

  it("precondition: the outlet reinstall line is gone", () => {
    expect(noOutletBack).not.toBe(BASE);
  });

  it("names the part whose put-back steps are missing, and still puts the other one back", () => {
    const p = run(noOutletBack);
    expect(outletBlocker(p)).toBe(true);
    expect(JSON.stringify(p).includes("takes off the Inlet Head")).toBe(false);
    expect(p.steps.some((s) => s.phase === "reinstall" && /Inlet Head back/.test(s.text.value ?? ""))).toBe(true);
  });

  it("control: with both put-back steps present, no missing-reinstall blocker", () => {
    const p = run(BASE);
    expect(outletBlocker(p)).toBe(false);
    expect(JSON.stringify(p).includes("takes off the Inlet Head")).toBe(false);
  });
});

describe("F2 — an all-caps instruction inside a standalone WARNING is kept", () => {
  const capsTail = BASE.replace(
    "Without them the pump or the hose can burst.",
    "DO NOT RUN THE PUMP WITHOUT A RELIEF DEVICE.",
  );
  const wrapped = BASE.replace(
    "Without them the pump or the hose can burst.",
    "DO NOT RUN THE PUMP WITHOUT A\nRELIEF DEVICE ON THE OUTLET.",
  );
  const warning = (p: WorkPacket) =>
    p.safety.cautions.find((c) => (c.value ?? "").startsWith("Every system needs a pressure-limiting device"));

  it("precondition: the instruction line is in the fixture", () => {
    expect(capsTail).not.toBe(BASE);
    expect(wrapped).not.toBe(BASE);
  });

  it("keeps a one-line all-caps instruction in the warning", () => {
    const w = warning(run(capsTail));
    expect(w).toBeDefined();
    expect(w!.value).toContain("DO NOT RUN THE PUMP WITHOUT A RELIEF DEVICE.");
  });

  it("keeps an all-caps instruction that wraps onto a second line", () => {
    const w = warning(run(wrapped));
    expect(w).toBeDefined();
    expect(w!.value).toContain("DO NOT RUN THE PUMP WITHOUT A RELIEF DEVICE ON THE OUTLET.");
  });

  it("control: the address block under the warning is still not part of it", () => {
    const w = warning(run(BASE));
    expect(w!.value).not.toMatch(/PUMPS EUROPE|Harbour Road/);
    expect(w!.label).toBe("proposed"); // round 3: an uncertain end is never Verified
  });
});
