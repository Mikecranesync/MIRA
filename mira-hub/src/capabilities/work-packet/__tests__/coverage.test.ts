/**
 * coverage.test.ts — finding N1 (2026-11-03): on a two-column manual the builder kept 4 of ~20 seal
 * steps, marked every one Verified, and its self-check passed. A packet must say how much of the
 * manual's procedure for this model it could read, and a packet built from part of it must stop
 * itself: a plain blocker first, a failing self-check, and nothing shown as Verified.
 * Fixtures are invented (9YP two-column manual, 85-frame manual).
 */
import { describe, expect, it } from "vitest";
import { FIXTURES, fixturePages } from "./fixtures";
import { buildDraftPacket } from "../draft";
import { collectFields, verifyPacket } from "../verify";
import type { DraftResult, WorkPacket } from "../types";

function run(text: string, model: string): DraftResult & { ok: true } {
  const r = buildDraftPacket({
    notebookId: "11111111-1111-4111-8111-111111111111",
    packetId: "pk-cov",
    now: "2026-11-03T12:00:00Z",
    identity: { manufacturer: "CAT Pumps", model, catalogNumber: null, serialNumber: null, status: "user_confirmed", confidence: 0.9 },
    workOrder: { id: "WO-COV", title: "Reseal", description: "Pump leaking at the shaft — reseal it per the manufacturer's procedure.", assetTag: null, site: null, synthetic: true },
    docs: [{ docId: "sm", fileId: null, filename: "manual.pdf", pages: fixturePages(text), via: "file" }],
    hazardFlags: [],
  });
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(r.message);
  return r;
}

const verifiedPaths = (p: WorkPacket) => collectFields(p).filter((l) => l.field.label === "verified").map((l) => l.path);

describe("N1 — a packet built from part of the manual stops itself", () => {
  const { packet: p, warnings } = run(FIXTURES["manual-9yp-twocol.txt"], "9YP100");

  it("reports per procedure section what was read, partly read or not read", () => {
    expect(p.coverage).toBeDefined();
    const byHeading = new Map(p.coverage!.sections.map((s) => [s.heading, s]));
    expect(byHeading.get("SERVICING THE SEALS")?.status).toBe("partly");
    // the seal steps point back to it, but none of its steps are in the packet
    expect(byHeading.get("SERVICING THE PUMPING SECTION")?.status).toBe("not_read");
    expect(p.coverage!.complete).toBe(false);
  });

  it("counts the steps it read against the steps the manual prints (a lower bound when text was unreadable)", () => {
    expect(p.steps).toHaveLength(3);
    expect(p.coverage!.stepsRead).toBe(3);
    expect(p.coverage!.stepsTotal).toBe(15);
    expect(p.coverage!.totalIsLowerBound).toBe(true);
    expect(p.coverage!.summary).toBe("Only 3 of at least 15 steps could be read (3 more may apply to this pump); this is not the whole job.");
  });

  it("does not count steps limited to other models in the 'at least' total — it names them apart", () => {
    // The Hi-Pressure block is limited to models the reader could not make out: it may or may not be
    // this pump's, so counting it as "at least" would overstate the job when it is not.
    const byHeading = new Map(p.coverage!.sections.map((s) => [s.heading, s]));
    const seals = byHeading.get("SERVICING THE SEALS")!;
    expect(seals.stepsMayApply).toBe(3);
    expect(seals.stepsNotRead).toBe(4); // incl. the "Models 9YP100, 9YP200," block: its only instruction is not a numbered step (round 5 F12)
    expect(p.coverage!.stepsMayApply).toBe(3);
    // control: a section with no model limit keeps every unread step in the definite count
    const pumping = byHeading.get("SERVICING THE PUMPING SECTION")!;
    expect(pumping.stepsMayApply).toBe(0);
    expect(pumping.stepsNotRead).toBe(8);
  });

  it("puts the plain blocker first", () => {
    expect(p.blockers?.[0]?.label).toBe("unknown");
    expect(p.blockers?.[0]?.basis).toContain("Only 3 of at least 15 steps could be read (3 more may apply to this pump); this is not the whole job.");
  });

  it("fails its own self-check", () => {
    expect(verifyPacket(p).some((x) => x.startsWith("coverage:"))).toBe(true);
    expect(warnings.some((x) => x.startsWith("coverage:"))).toBe(true);
  });

  it("shows nothing as Verified", () => {
    expect(verifiedPaths(p)).toEqual([]);
    expect(p.steps.every((s) => s.text.label === "proposed")).toBe(true);
    expect(p.steps[0].text.basis).toMatch(/not the whole job/);
  });
});

describe("N1 — a packet built from the whole procedure is unchanged", () => {
  const { packet: p } = run(FIXTURES["manual-85v2.txt"], "8520");

  it("reports complete coverage and passes its self-check", () => {
    expect(p.coverage?.complete).toBe(true);
    expect(p.coverage!.stepsRead).toBe(p.steps.length);
    expect(p.coverage!.summary).toMatch(/^All \d+ steps the manual prints for this job could be read\.$/);
    expect(verifyPacket(p).filter((x) => x.startsWith("coverage:"))).toEqual([]);
  });

  it("keeps the manual's own lines Verified", () => {
    expect(verifiedPaths(p).length).toBeGreaterThan(0);
    expect(p.blockers?.some((b) => /not the whole job/.test(b.basis))).toBe(false);
  });
});
