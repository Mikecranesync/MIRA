import { describe, expect, it } from "vitest";
import { collectFields, verifyPacket } from "../verify";
import type { Field, WorkPacket } from "../types";

function verified(value: string, line: string): Field {
  return { value, label: "verified", source: { docId: "d1", fileId: null, filename: "f.pdf", page: 6, line }, basis: "torque chart" };
}

function unknown(): Field {
  return { value: null, label: "unknown", source: null, basis: "not in the documents" };
}

function basePacket(overrides: Partial<WorkPacket> = {}): WorkPacket {
  return {
    version: 1,
    packetId: "pk-1",
    generatedAt: "2026-10-30T00:00:00Z",
    notebookId: "nb-1",
    disclaimer: "DRAFT",
    equipment: {
      manufacturer: verified("CAT Pumps", "CAT Pumps 3520"),
      model: verified("3520", "Model: 3520"),
      serial: unknown(),
      identityStatus: "user_confirmed",
    },
    workOrder: { id: "WO-1", title: "Reseal", description: "Reseal the pump", assetTag: null, site: null, synthetic: true },
    documents: [],
    scope: [{ value: "seals", label: "proposed", source: null, basis: "work order mentions: reseal" }],
    safety: {
      cautions: [verified("Disconnect power before servicing.", "CAUTION: Disconnect power before servicing.")],
      siteIsolation: unknown(),
      hazardFlags: [],
    },
    parts: [{ kit: "seal", item: 1, partNumber: verified("33628", "1 33628 Seal retainer 1"), description: verified("Seal retainer", "1 33628 Seal retainer 1"), qty: verified("1", "1 33628 Seal retainer 1") }],
    tools: [{ value: "Torque wrench", label: "proposed", source: null, basis: "torque values specified" }],
    steps: [{ section: "SERVICING THE SEALS", topic: "seals", text: verified("Remove the manifold.", "1. Remove the manifold.") }],
    measurements: [{ name: verified("Manifold bolts", "Manifold bolts M21 Hex 870 72.5 98"), value: verified("870 in-lbs / 72.5 ft-lbs / 98 Nm", "Manifold bolts M21 Hex 870 72.5 98"), tool: verified("M21 Hex", "Manifold bolts M21 Hex 870 72.5 98") }],
    unknowns: [unknown()],
    approval: { technicianReview: { state: "draft", entries: [] }, supervisor: { state: "pending", by: null, at: null } },
    ...overrides,
  };
}

describe("collectFields", () => {
  it("visits every field with the same path grammar applyEdit accepts", () => {
    const locs = collectFields(basePacket());
    const paths = locs.map((l) => l.path);
    expect(paths).toContain("equipment.model");
    expect(paths).toContain("parts[0].partNumber");
    expect(paths).toContain("measurements[0].value");
    expect(paths).toContain("steps[0].text");
    expect(paths).toContain("safety.siteIsolation");
    expect(paths).toContain("unknowns[0]");
  });
});

describe("verifyPacket — clean packet", () => {
  it("returns no problems for a well-formed packet", () => {
    expect(verifyPacket(basePacket())).toEqual([]);
  });
});

describe("verifyPacket — verified without source", () => {
  it("flags a verified field whose source is null", () => {
    const bad = basePacket();
    bad.measurements[0].value.source = null;
    const problems = verifyPacket(bad);
    expect(problems.some((p) => p.startsWith("measurements[0].value:") && p.includes("without a source"))).toBe(true);
  });
});

describe("verifyPacket — numbers not on the source line", () => {
  it("flags a verified part number whose digits don't appear on its source line", () => {
    const bad = basePacket();
    bad.parts[0].partNumber.value = "99999";
    const problems = verifyPacket(bad);
    expect(problems.some((p) => p.startsWith("parts[0].partNumber:") && p.includes("not verbatim"))).toBe(true);
  });

  it("does not flag a verified field whose value is a plain word (no digits to check)", () => {
    const ok = basePacket();
    ok.parts[0].description.value = "Retainer, seal";
    ok.parts[0].description.source!.line = "a completely different line with no mention of it";
    expect(verifyPacket(ok)).toEqual([]);
  });
});

describe("verifyPacket — siteIsolation", () => {
  it("flags siteIsolation when it is not unknown", () => {
    const bad = basePacket();
    bad.safety.siteIsolation = { value: "confirmed", label: "proposed", source: null, basis: "oops" };
    const problems = verifyPacket(bad);
    expect(problems.some((p) => p.startsWith("safety.siteIsolation:"))).toBe(true);
  });
});

describe("verifyPacket — measurement value sourcing", () => {
  it("flags a measurement value with no source even if mislabeled as proposed", () => {
    const bad = basePacket();
    bad.measurements[0].value = { value: "870 in-lbs", label: "proposed", source: null, basis: "edited" };
    const problems = verifyPacket(bad);
    expect(problems.some((p) => p.startsWith("measurements[0].value:") && p.includes("not sourced to one line"))).toBe(true);
  });

  it("flags a measurement value whose numbers mismatch its source line", () => {
    const bad = basePacket();
    bad.measurements[0].value.value = "870 in-lbs / 72.5 ft-lbs / 999 Nm";
    const problems = verifyPacket(bad);
    expect(problems.some((p) => p.startsWith("measurements[0].value:") && p.includes("999"))).toBe(true);
  });

  it("does not flag a measurement value marked unknown with no source", () => {
    const ok = basePacket();
    ok.measurements[0].value = { value: null, label: "unknown", source: null, basis: "not from one line" };
    expect(verifyPacket(ok)).toEqual([]);
  });
});
