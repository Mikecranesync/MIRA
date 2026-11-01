import { describe, expect, it } from "vitest";
import { createObservationRequestIds, factLine, observationSaveMessage } from "./machine-observations-logic";
import type { ObservationPreview } from "./machine-observations-logic";

const preview: ObservationPreview = {
  rawReport: "seal leaking, observed at 09:10",
  factKey: "seal_leak",
  factValue: "present",
  observedAt: "2026-11-01T14:10:00.000Z",
  needs: [],
};

function counter() {
  let n = 0;
  return () => `id-${++n}`;
}

describe("observation request ids (retry safety)", () => {
  it("a retry of the same confirmed content reuses the request id", () => {
    const ids = createObservationRequestIds(counter());
    expect(ids.idFor(preview)).toBe("id-1");
    expect(ids.idFor({ ...preview })).toBe("id-1");
  });

  it("a corrected field is a new observation with a new id", () => {
    const ids = createObservationRequestIds(counter());
    ids.idFor(preview);
    expect(ids.idFor({ ...preview, observedAt: "2026-11-01T14:20:00.000Z" })).toBe("id-2");
    expect(ids.idFor({ ...preview, factValue: "absent" })).toBe("id-3");
  });

  it("after settle the same content gets a fresh id (a deliberate second report)", () => {
    const ids = createObservationRequestIds(counter());
    ids.idFor(preview);
    ids.settle(preview);
    expect(ids.idFor(preview)).toBe("id-2");
  });
});

describe("panel copy", () => {
  const entry = {
    observationId: "o1", factValue: "present" as const, source: "technician" as const, author: "tech-a",
    observedAt: preview.observedAt!, recordedAt: preview.observedAt!, verificationMethod: "self_reported", uncertainty: "unverified",
  };

  it("names the fact and its reported status, never a health or cause claim", () => {
    const line = factLine({ factKey: "seal_leak", state: "leak_reported", contested: false, current: entry, conflicting: [] });
    expect(line).toBe("Seal leak — reported");
    expect(line).not.toMatch(/healthy|fixed|safe|cause/i);
  });

  it("a repair report reads as reported, not as healthy", () => {
    const line = factLine({ factKey: "seal_leak", state: "repair_reported", contested: false, current: { ...entry, factValue: "repaired" }, conflicting: [] });
    expect(line).toBe("Seal leak — repair reported");
  });

  it("a contested fact says the reports disagree", () => {
    const line = factLine({ factKey: "seal_leak", state: "contested", contested: true, current: entry, conflicting: [entry, { ...entry, observationId: "o2", factValue: "absent" }] });
    expect(line).toMatch(/contested/);
  });

  it("the server's own message wins; known codes get plain copy; unknown is retry-safe", () => {
    expect(observationSaveMessage("asset_not_confirmed", "Server says so.")).toBe("Server says so.");
    expect(observationSaveMessage("observed_at_in_future", undefined)).toMatch(/future/);
    expect(observationSaveMessage(undefined, undefined)).toMatch(/not create a duplicate/);
  });
});
