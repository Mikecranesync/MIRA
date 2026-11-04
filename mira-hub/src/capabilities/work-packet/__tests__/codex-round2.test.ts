/**
 * Codex adversarial review round 2 on PR #5173 @ 17629e67f (2026-11-04): findings F1, F2, F3, F9.
 * F1: a removal block the job needs, kept but tied to models the tool cannot make out, is not read.
 * F2: an all-caps hazard statement under a standalone WARNING is kept when the run ends a sentence.
 * F3: a put-back instruction for another model does not count as putting this pump's part back.
 * F9: a NOTE printed under a section heading, before its first sub-heading, is not silently lost.
 * Fixture is invented (85-frame manual).
 */
import { describe, expect, it } from "vitest";
import { FIXTURES, fixturePages } from "./fixtures";
import { buildDraftPacket } from "../draft";
import { collectFields } from "../verify";
import type { WorkPacket } from "../types";

function run(text: string): WorkPacket {
  const r = buildDraftPacket({
    notebookId: "11111111-1111-4111-8111-111111111111",
    packetId: "pk-r2",
    now: "2026-11-04T13:00:00Z",
    identity: { manufacturer: "CAT Pumps", model: "8520", catalogNumber: null, serialNumber: null, status: "user_confirmed", confidence: 0.9 },
    workOrder: { id: "WO-R2", title: "Reseal", description: "Pump leaking at the shaft — reseal it per the manufacturer's procedure.", assetTag: null, site: null, synthetic: true },
    docs: [{ docId: "sm", fileId: null, filename: "manual.pdf", pages: fixturePages(text), via: "file" }],
    hazardFlags: [],
  });
  if (!r.ok) throw new Error(r.message);
  return r.packet;
}

const BASE = FIXTURES["manual-85v2.txt"];
const verifiedSteps = (p: WorkPacket) =>
  collectFields(p).filter((l) => l.field.label === "verified" && l.path.startsWith("steps")).map((l) => l.path);

describe("F1 (round 2) — a needed removal block tied to unreadable models is not read", () => {
  const unresolved = BASE.replace("REMOVING THE OUTLET HEAD\n", "REMOVING THE OUTLET HEAD\nDisassembly (special head style)\n");
  it("precondition: the sub-heading is in the fixture", () => expect(unresolved).not.toBe(BASE));
  it("does not claim the whole job was read, names the removal, shows nothing Verified", () => {
    const p = run(unresolved);
    expect(p.coverage!.complete).toBe(false);
    expect(p.coverage!.sections.find((s) => s.heading === "REMOVING THE OUTLET HEAD")?.status).not.toBe("read");
    expect(verifiedSteps(p)).toEqual([]);
  });
  it("control: the base manual is complete", () => expect(run(BASE).coverage!.complete).toBe(true));
});

describe("F2 (round 2) — a wrapped all-caps hazard statement stays in the warning", () => {
  const caps = BASE.replace("Without them the pump or the hose can burst.", "HIGH PRESSURE FLUID CAN PENETRATE\nTHE SKIN AND CAUSE SERIOUS INJURY.");
  const warning = (p: WorkPacket) => p.safety.cautions.find((c) => (c.value ?? "").startsWith("Every system needs a pressure-limiting device"));
  it("precondition: the statement is in the fixture", () => expect(caps).not.toBe(BASE));
  it("keeps the whole statement", () => {
    expect(warning(run(caps))!.value).toContain("HIGH PRESSURE FLUID CAN PENETRATE THE SKIN AND CAUSE SERIOUS INJURY.");
  });
  it("control: the address block is still not part of the warning", () => {
    expect(warning(run(BASE))!.value).not.toMatch(/PUMPS EUROPE|Harbour Road/);
  });
});

describe("F3 (round 2) — another model's put-back line does not put this pump's part back", () => {
  const other = BASE.replace("5. Slide the Inlet Head back over the Plungers.", "5. On Model 8545 slide the Inlet Head back over the Plungers.");
  it("precondition: the inlet put-back line is limited to another model", () => expect(other).not.toBe(BASE));
  it("names the missing inlet-head put-back steps", () => {
    expect(JSON.stringify(run(other))).toContain("takes off the Inlet Head");
  });
  it("control: the base manual has no missing put-back blocker", () => {
    expect(JSON.stringify(run(BASE))).not.toContain("takes off the Inlet Head");
  });
});

describe("F9 — a NOTE before a section's first sub-heading is kept", () => {
  const TEXT = "Do not reuse the Packings after removal.";
  const lead = BASE.replace("SERVICING THE SEALS\nDisassembly of the Packings\n", `SERVICING THE SEALS\nNOTE: ${TEXT}\nDisassembly of the Packings\n`);
  it("precondition: the note is in the fixture", () => expect(lead).not.toBe(BASE));
  it("puts it before the first seal step", () => {
    const p = run(lead);
    const step = p.steps.find((s) => (s.notes ?? []).some((n) => n.text.value === TEXT));
    expect(step).toBeDefined();
    expect(step!.section).toBe("SERVICING THE SEALS");
    expect(step!.notes!.find((n) => n.text.value === TEXT)!.placement).toBe("before");
  });
  it("control: without it no such note appears", () => {
    expect(JSON.stringify(run(BASE))).not.toContain(TEXT);
  });
});

describe("Round 3 — F2: a WARNING whose end cannot be told apart is never shown Verified", () => {
  const warning = (p: WorkPacket) => p.safety.cautions.find((c) => (c.value ?? "").startsWith("Every system needs a pressure-limiting device"));
  const unpunct = BASE.replace("Without them the pump or the hose can burst.", "HIGH PRESSURE FLUID CAN PENETRATE\nTHE SKIN AND CAUSE SERIOUS INJURY");
  const mixed = BASE.replace("Without them the pump or the hose can burst.", "HIGH PRESSURE FLUID CAN PENETRATE\nthe skin and cause serious injury.");
  it("precondition: both variants are in the fixture", () => {
    expect(unpunct).not.toBe(BASE);
    expect(mixed).not.toBe(BASE);
  });
  it("an unpunctuated capitals hazard: the warning is shown but not Verified, with the reason", () => {
    const w = warning(run(unpunct))!;
    expect(w.label).not.toBe("verified");
    expect(w.basis).toMatch(/HIGH PRESSURE FLUID CAN PENETRATE.*may be part of it/);
  });
  it("a capitals opening that runs on in lower case is kept whole", () => {
    expect(warning(run(mixed))!.value).toContain("HIGH PRESSURE FLUID CAN PENETRATE the skin and cause serious injury.");
  });
  it("a company line ending in a suffix ('… LTD.') is not read as a capitals sentence: the warning is kept", () => {
    const ltd = BASE.replace("85V PUMPS EUROPE BV", "85V PUMPS (U.K.) LTD.");
    expect(ltd).not.toBe(BASE);
    const w = warning(run(ltd));
    expect(w).toBeDefined();
    expect(w!.value).toContain("Without them the pump or the hose can burst.");
    expect(w!.value).not.toMatch(/LTD|Harbour Road/);
    expect(w!.label).toBe("proposed");
  });
  it("control: a warning that ends at the page break stays Verified", () => {
    const plain = BASE.replace("85V PUMPS EUROPE BV\nHarbour Road 12, Rotterdam\n", "");
    expect(plain).not.toBe(BASE);
    expect(warning(run(plain))!.label).toBe("verified");
  });
});

describe("Round 3 — F10: a block that starts above step 1 is not read whole", () => {
  const noFirst = BASE.replace("REMOVING THE OUTLET HEAD\n1. Remove the eight (8) head screws.\n", "REMOVING THE OUTLET HEAD\n");
  it("precondition: step 1 of the outlet removal is gone", () => expect(noFirst).not.toBe(BASE));
  it("reports incomplete coverage, names the block, and shows nothing Verified", () => {
    const p = run(noFirst);
    expect(p.coverage!.complete).toBe(false);
    expect(p.coverage!.sections.find((s) => s.heading === "REMOVING THE OUTLET HEAD")?.status).not.toBe("read");
    expect(verifiedSteps(p)).toEqual([]);
  });
  it("control: the base manual is complete", () => expect(run(BASE).coverage!.complete).toBe(true));
});

describe("Round 4 — F12: a heading whose steps were all lost is not read", () => {
  const empty = BASE.replace(
    "REMOVING THE OUTLET HEAD\n1. Remove the eight (8) head screws.\n2. Tap the Outlet Head with a soft mallet and work it off the pump.\n",
    "REMOVING THE OUTLET HEAD\n",
  );
  it("precondition: the heading stays and both of its steps are gone", () => {
    expect(empty).not.toBe(BASE);
    expect(empty).toContain("REMOVING THE OUTLET HEAD\nREMOVING THE INLET HEAD");
  });
  it("reports incomplete coverage, names the empty block, and shows nothing Verified", () => {
    const p = run(empty);
    expect(p.coverage!.complete).toBe(false);
    expect(p.coverage!.sections.find((s) => s.heading === "REMOVING THE OUTLET HEAD")?.status).toBe("not_read");
    expect(verifiedSteps(p)).toEqual([]);
  });
  it("control: a heading whose steps sit under its sub-headings is still read whole", () => {
    expect(run(BASE).coverage!.complete).toBe(true);
  });
});

describe("Round 5 — F12: an empty model block next to a sibling model block is not read", () => {
  const ZQ = FIXTURES["manual-7zq-notes.txt"];
  const run7 = (text: string, model: string) => {
    const r = buildDraftPacket({
      notebookId: "11111111-1111-4111-8111-111111111111",
      packetId: "pk-r5",
      now: "2026-11-04T13:00:00Z",
      identity: { manufacturer: "CAT Pumps", model, catalogNumber: null, serialNumber: null, status: "user_confirmed", confidence: 0.9 },
      workOrder: { id: "WO-R5", title: "Reseal", description: "Pump leaking at the shaft — reseal it per the manufacturer's procedure.", assetTag: null, site: null, synthetic: true },
      docs: [{ docId: "zq", fileId: null, filename: "7zq.pdf", pages: fixturePages(text), via: "file" }],
      hazardFlags: [],
    });
    if (!r.ok) throw new Error(r.message);
    return r.packet;
  };
  const empty = ZQ.replace(
    "Models 7ZQ10, 7ZQ20\n1. Press the Lip Seal into the Inlet Adapter, spring up.\n2. Press the Inlet Adapter into the head bore.\n",
    "Models 7ZQ10, 7ZQ20\n",
  );
  it("precondition: the model heading stays, its steps are gone, the sibling block follows", () => {
    expect(empty).not.toBe(ZQ);
    expect(empty).toContain("Models 7ZQ10, 7ZQ20\nModels 7ZQ30");
  });
  it("reports incomplete coverage, names the empty model block, and shows nothing Verified", () => {
    const p = run7(empty, "7ZQ10");
    expect(p.coverage!.complete).toBe(false);
    const seals = p.coverage!.sections.find((s) => s.heading === "SERVICING THE SEALS")!;
    expect(seals.status).not.toBe("read");
    expect(seals.reasons.join(" ")).toContain("Models 7ZQ10, 7ZQ20");
    expect(verifiedSteps(p)).toEqual([]);
  });
  it("control: the parent headings over model blocks are still frames, so the base manual is complete", () => {
    expect(run7(ZQ, "7ZQ10").coverage!.complete).toBe(true);
    expect(run7(ZQ, "7ZQ30").coverage!.complete).toBe(true);
  });
});
