import { describe, expect, it } from "vitest";
import { applyEdit } from "../edits";
import type { Field, WorkPacket } from "../types";

function field(value: string | null, label: Field["label"] = "verified"): Field {
  return {
    value,
    label,
    source: label === "verified" ? { docId: "d1", fileId: null, filename: "f.pdf", page: 6, line: `${value} in-lbs` } : null,
    basis: "torque chart",
  };
}

function packet(overrides: Partial<WorkPacket> = {}): WorkPacket {
  return {
    version: 1,
    packetId: "pk-1",
    generatedAt: "2026-10-30T00:00:00Z",
    notebookId: "nb-1",
    disclaimer: "DRAFT",
    equipment: {
      manufacturer: field("CAT Pumps"),
      model: field("3520"),
      serial: { value: null, label: "unknown", source: null, basis: "serial not provided" },
      identityStatus: "user_confirmed",
    },
    workOrder: { id: "WO-1", title: "Reseal", description: "Reseal the pump", assetTag: null, site: null, synthetic: true },
    documents: [],
    scope: [field("seals", "proposed")],
    safety: {
      cautions: [field("Disconnect power before servicing.")],
      siteIsolation: { value: null, label: "unknown", source: null, basis: "site-owned" },
      hazardFlags: [],
    },
    parts: [
      {
        kit: "seal",
        item: 1,
        partNumber: field("33628"),
        description: field("Seal retainer"),
        qty: field("1"),
      },
    ],
    tools: [field("Torque wrench", "proposed")],
    steps: [{ section: "SERVICING THE SEALS", topic: "seals", text: field("Remove the manifold.") }],
    measurements: [
      {
        name: field("Manifold bolts"),
        value: field("870 in-lbs"),
        tool: field("M21 Hex"),
      },
    ],
    unknowns: [{ value: null, label: "unknown", source: null, basis: "site isolation" }],
    approval: {
      technicianReview: { state: "draft", entries: [] },
      supervisor: { state: "pending", by: null, at: null },
    },
    ...overrides,
  };
}

describe("applyEdit — set", () => {
  it("downgrades a verified field to proposed and records the review", () => {
    const p = packet();
    const out = applyEdit(p, { path: "measurements[0].value", action: "set", value: "999 in-lbs" }, "Demo Technician", "2026-10-30T15:00:00Z");
    expect(out.measurements[0].value.value).toBe("999 in-lbs");
    expect(out.measurements[0].value.label).toBe("proposed");
    expect(out.measurements[0].value.review).toEqual({
      path: "measurements[0].value",
      action: "set",
      by: "Demo Technician",
      at: "2026-10-30T15:00:00Z",
      previous: "870 in-lbs",
      next: "999 in-lbs",
    });
    // the original is untouched — applyEdit is immutable
    expect(p.measurements[0].value.value).toBe("870 in-lbs");
    expect(p.measurements[0].value.label).toBe("verified");
  });

  it("sets a proposed field's value to proposed too (not re-labeled verified)", () => {
    const p = packet();
    const out = applyEdit(p, { path: "scope[0]", action: "set", value: "valves" }, "Tech", "2026-10-30T15:00:00Z");
    expect(out.scope[0].value).toBe("valves");
    expect(out.scope[0].label).toBe("proposed");
  });
});

describe("applyEdit — confirm", () => {
  it("records the review without changing the value or label", () => {
    const p = packet();
    const out = applyEdit(p, { path: "measurements[0].value", action: "confirm" }, "Demo Technician", "2026-10-30T14:01:00Z");
    expect(out.measurements[0].value.value).toBe("870 in-lbs");
    expect(out.measurements[0].value.label).toBe("verified");
    expect(out.measurements[0].value.review).toEqual({
      path: "measurements[0].value",
      action: "confirm",
      by: "Demo Technician",
      at: "2026-10-30T14:01:00Z",
      previous: "870 in-lbs",
      next: "870 in-lbs",
    });
  });
});

describe("applyEdit — strike", () => {
  it("marks the field struck without clearing its value", () => {
    const p = packet();
    const out = applyEdit(p, { path: "parts[0].partNumber", action: "strike" }, "Demo Technician", "2026-10-30T14:02:00Z");
    expect(out.parts[0].partNumber.struck).toBe(true);
    expect(out.parts[0].partNumber.value).toBe("33628");
    expect(out.parts[0].partNumber.label).toBe("verified");
  });
});

describe("applyEdit — mark_unknown", () => {
  it("nulls the value and sets the label to unknown", () => {
    const p = packet();
    const out = applyEdit(p, { path: "parts[0].partNumber", action: "mark_unknown" }, "Demo Technician", "2026-10-30T14:05:00Z");
    expect(out.parts[0].partNumber.value).toBeNull();
    expect(out.parts[0].partNumber.label).toBe("unknown");
    expect(out.parts[0].partNumber.review?.previous).toBe("33628");
    expect(out.parts[0].partNumber.review?.next).toBeNull();
  });
});

describe("applyEdit — approval reset (#4999: ANY edit, including a bare confirm)", () => {
  it("resets an approved supervisor approval to pending on confirm", () => {
    const approved = packet({ approval: { technicianReview: { state: "draft", entries: [] }, supervisor: { state: "approved", by: "Boss", at: "2026-10-29T00:00:00Z" } } });
    const out = applyEdit(approved, { path: "measurements[0].value", action: "confirm" }, "Tech", "2026-10-30T16:00:00Z");
    expect(out.approval.supervisor.state).toBe("pending");
    expect(out.approval.supervisor.by).toBeNull();
    expect(out.approval.supervisor.at).toBeNull();
  });

  it("sets technicianReview.state to reviewed and appends the entry", () => {
    const p = packet();
    const out = applyEdit(p, { path: "tools[0]", action: "strike" }, "Tech", "2026-10-30T16:05:00Z");
    expect(out.approval.technicianReview.state).toBe("reviewed");
    expect(out.approval.technicianReview.entries).toHaveLength(1);
    expect(out.approval.technicianReview.entries[0].action).toBe("strike");
  });
});

describe("applyEdit — rejects unknown paths and actions", () => {
  it("throws on a path that does not resolve to a field", () => {
    const p = packet();
    expect(() => applyEdit(p, { path: "measurements[9].value", action: "confirm" }, "Tech", "x")).toThrow();
    expect(() => applyEdit(p, { path: "nope.nothing", action: "confirm" }, "Tech", "x")).toThrow();
  });

  it("throws on a path that resolves to a real object that isn't a Field (no value/label/basis)", () => {
    const p = packet();
    // "equipment" resolves to a real, non-null object — but it's a container of Fields, not a
    // Field itself. Catching this (not just the undefined-walk case above) is what the trailing
    // `isFieldLike` check in `resolveField` is for.
    expect(() => applyEdit(p, { path: "equipment", action: "confirm" }, "Tech", "x")).toThrow();
  });

  it("throws on an unrecognized action", () => {
    const p = packet();
    expect(() => applyEdit(p, { path: "tools[0]", action: "approve" as never }, "Tech", "x")).toThrow();
  });
});
