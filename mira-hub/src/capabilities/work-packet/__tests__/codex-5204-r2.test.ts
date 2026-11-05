/**
 * Codex adversarial review r2 on #5204 — one test group per finding. FICTIONAL fixtures only.
 */
import { describe, expect, it } from "vitest";

import { buildConnectionPacket } from "../drawing-packet";
import { mergeDrawingPhotos, renderDrawingSourceText, type DrawingSheetPhoto, type DrawingTranscription } from "../drawing";
import type { DocText, Identity, WorkOrderInput } from "../types";
import { PHOTO_A } from "./fixtures/drawing-example";

const IDENTITY: Identity = {
  manufacturer: "Example Rides GmbH",
  model: "Demo Coaster",
  catalogNumber: null,
  serialNumber: null,
  status: "user_confirmed",
  confidence: null,
};
const WORK_ORDER: WorkOrderInput = {
  id: "WO-1",
  title: "Loose torque stripe at C3",
  description: "Technician found a loose torque stripe during a walk-down.",
  assetTag: null,
  site: null,
  synthetic: true,
};

function docFor(photo: DrawingSheetPhoto): DocText {
  return { docId: photo.docId, fileId: photo.fileId, filename: `${photo.docId}.txt`, via: "file", pages: [{ page: 1, text: renderDrawingSourceText(photo.t) }] };
}

function build(photos: DrawingSheetPhoto[], extra: { connectionRef?: string; drawing?: string | null } = {}) {
  return buildConnectionPacket({
    notebookId: "nb-1",
    packetId: "pk-1",
    now: "2026-11-05T00:00:00Z",
    identity: IDENTITY,
    workOrder: WORK_ORDER,
    sheets: mergeDrawingPhotos(photos),
    connectionRef: extra.connectionRef ?? "C3",
    docs: photos.map(docFor),
    drawing: extra.drawing,
  });
}

const reviewed = (docId: string, t: DrawingTranscription): DrawingSheetPhoto => ({ docId, fileId: `f-${docId}`, reviewed: true, t });

/** PHOTO_A with C3's first (bolt) row patched, and the drawing patched. */
function variant(row: Record<string, string | null> = {}, drawing: Record<string, unknown> = {}): DrawingTranscription {
  const d = PHOTO_A.drawing!;
  return {
    ...PHOTO_A,
    drawing: {
      ...d,
      ...drawing,
      connections: d.connections.map((c) =>
        c.id === "C3" ? { ...c, rows: c.rows.map((r, i) => (i === 0 ? { ...r, ...row } : r)) } : c,
      ),
    },
  };
}

const ok = (r: ReturnType<typeof build>) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}: ${r.message}`);
  return r.packet;
};

describe("r2 F1 — a row is matched across photos by any shared identity, not by position alone", () => {
  it("same bolt (name + article) printed at different positions and quantities is one unresolved row", () => {
    const packet = ok(build([reviewed("p1", variant({ pos: "1", qty: "2" })), reviewed("p2", variant({ pos: "2", qty: "4" }))]));
    expect(packet.parts).toHaveLength(3); // bolt, washer, nut — never a duplicated bolt
    const bolt = packet.parts.find((p) => p.partNumber.value === "700101")!;
    expect(bolt.qty).toMatchObject({ value: null, label: "unknown" });
    expect(packet.parts.filter((p) => p.qty.label === "verified" && p.partNumber.value === "700101")).toHaveLength(0);
    expect((packet.blockers ?? []).some((b) => /qty/.test(b.basis ?? "") && /'2'/.test(b.basis ?? "") && /'4'/.test(b.basis ?? ""))).toBe(true);
  });

  it("a missing position on one photo still matches the row by name", () => {
    const packet = ok(build([reviewed("p1", variant({ pos: "7", qty: "2" })), reviewed("p2", variant({ pos: null, qty: "4" }))]));
    expect(packet.parts).toHaveLength(3);
    expect(packet.parts.find((p) => p.partNumber.value === "700101")!.qty.label).toBe("unknown");
  });

  it("control: agreeing photos still give one Verified bolt", () => {
    const packet = ok(build([reviewed("p1", variant()), reviewed("p2", variant())]));
    expect(packet.parts).toHaveLength(3);
    expect(packet.parts.find((p) => p.partNumber.value === "700101")!.qty).toMatchObject({ value: "2", label: "verified" });
  });
});

describe("r2 F2 — drawing numbers keep their letters", () => {
  // ABC-100 carries connection C3 and no torque; DEF-100 carries only a C3-B1 torque callout.
  const abc = variant({}, { documentNo: "ABC-100", filenameShown: null, callouts: [] });
  const def: DrawingTranscription = {
    ...PHOTO_A,
    drawing: { ...PHOTO_A.drawing!, documentNo: "DEF-100", filenameShown: null, connections: [], callouts: [{ ref: "C3-B1", torque: "Ma=180 Nm", notes: [] }] },
  };

  it("never applies DEF-100's torque to ABC-100's connection", () => {
    const packet = ok(build([reviewed("pa", abc), reviewed("pd", def)]));
    expect(packet.measurements.some((m) => m.value.value === "180 Nm")).toBe(false);
    expect(packet.measurements.every((m) => m.value.label === "unknown")).toBe(true);
  });

  it("the drawing selector matches letters too", () => {
    const abc2 = variant({}, { documentNo: "ABC-100", filenameShown: null });
    const def2 = variant({ spec: "M16 x 80" }, { documentNo: "DEF-100", filenameShown: null });
    expect(build([reviewed("pa", abc2), reviewed("pd", def2)]).ok).toBe(false); // both carry C3
    const picked = ok(build([reviewed("pa", abc2), reviewed("pd", def2)], { drawing: "DEF-100" }));
    expect(picked.parts[0].description.value).toContain("M16 x 80");
  });
});

describe("r2 F3 — the replacement step never repeats a disputed article number", () => {
  it("names no article number, whatever the photo order", () => {
    const photos = [reviewed("p1", variant({ artNo: "700101" })), reviewed("p2", variant({ artNo: "700999" }))];
    for (const order of [photos, [...photos].reverse()]) {
      const packet = ok(build(order));
      const text = packet.steps.map((s) => s.text.value ?? "").join("\n");
      expect(text).not.toContain("700101");
      expect(text).not.toContain("700999");
      expect(packet.parts[0].partNumber.value).toBeNull();
    }
  });
});

describe("r2 F4 — drawing notes and warnings are kept word for word, never reworded", () => {
  const noted = variant(
    {},
    {
      notes: ["WARNING: support suspended assembly before loosening"],
      callouts: [{ ref: "C3-B1", torque: "Ma=95 Nm", notes: ["Do not lubricate", "Use new fasteners only"] }],
    },
  );

  it("keeps every note and the drawing warning under Cautions, cited", () => {
    const packet = ok(build([reviewed("p1", noted)]));
    expect(packet.safety.cautions.map((c) => c.value)).toEqual([
      "Do not lubricate",
      "Use new fasteners only",
      "WARNING: support suspended assembly before loosening",
    ]);
    expect(packet.safety.cautions.every((c) => c.label === "verified" && c.source !== null)).toBe(true);
  });

  it("never invents an instruction to apply lubricant or thread locker", () => {
    const packet = ok(build([reviewed("p1", noted)]));
    const text = packet.steps.map((s) => s.text.value ?? "").join("\n").toLowerCase();
    expect(text).not.toContain("lubricant");
    expect(text).not.toContain("thread locker");
  });
});

describe("r2 F5 — a torque the packet cannot state is an open question, never an empty table", () => {
  const withCallouts = (callouts: { ref: string; torque: string | null; notes: string[] }[]) => variant({}, { callouts });

  it.each([
    ["a bare-unit torque", [{ ref: "C3-B1", torque: "95 Nm", notes: [] }], /95 Nm/],
    ["a callout without a torque", [{ ref: "C3-B1", torque: null, notes: [] }], /prints no torque/],
    ["no callout at all", [], /No torque callout for connection C3/],
  ])("%s", (_label, callouts, blockerRe) => {
    const packet = ok(build([reviewed("p1", withCallouts(callouts))]));
    expect(packet.measurements.length).toBeGreaterThan(0);
    expect(packet.measurements.every((m) => m.value.value === null && m.value.label === "unknown")).toBe(true);
    expect((packet.blockers ?? []).some((b) => blockerRe.test(b.basis ?? ""))).toBe(true);
    expect(packet.steps.map((s) => s.text.value).join("\n")).not.toContain("Tighten to the torque below.");
  });

  it("control: a printed Ma= torque is stated and the step points at it", () => {
    const packet = ok(build([reviewed("p1", withCallouts([{ ref: "C3-B1", torque: "Ma=95 Nm", notes: [] }]))]));
    expect(packet.measurements[0].value).toMatchObject({ value: "95 Nm", label: "verified" });
    expect(packet.steps.map((s) => s.text.value)).toContain("Tighten to the torque below.");
  });
});
