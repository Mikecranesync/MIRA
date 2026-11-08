/**
 * Codex adversarial review r3 on #5204 — one test group per finding. FICTIONAL fixtures only.
 */
import { describe, expect, it } from "vitest";

import { buildConnectionPacket } from "../drawing-packet";
import {
  mergeDrawingPhotos,
  renderDrawingSourceText,
  type DrawingCallout,
  type DrawingConnectionRow,
  type DrawingSheetPhoto,
  type DrawingTranscription,
} from "../drawing";
import { verifyPacket } from "../verify";
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

function build(photos: DrawingSheetPhoto[]) {
  const r = buildConnectionPacket({
    notebookId: "nb-1",
    packetId: "pk-1",
    now: "2026-11-05T00:00:00Z",
    identity: IDENTITY,
    workOrder: WORK_ORDER,
    sheets: mergeDrawingPhotos(photos),
    connectionRef: "C3",
    docs: photos.map(docFor),
  });
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}: ${r.message}`);
  return r.packet;
}

const reviewed = (docId: string, t: DrawingTranscription): DrawingSheetPhoto => ({ docId, fileId: `f-${docId}`, reviewed: true, t });

/** PHOTO_A with extra C3 rows appended and the callouts / drawing notes replaced. */
function variant(opts: { extraRows?: DrawingConnectionRow[]; callouts?: DrawingCallout[]; notes?: string[] } = {}): DrawingTranscription {
  const d = PHOTO_A.drawing!;
  return {
    ...PHOTO_A,
    drawing: {
      ...d,
      connections: d.connections.map((c) => (c.id === "C3" ? { ...c, rows: [...c.rows, ...(opts.extraRows ?? [])] } : c)),
      callouts: opts.callouts ?? d.callouts,
      notes: opts.notes ?? d.notes,
    },
  };
}

const B2_SAME_ART: DrawingConnectionRow = { name: "B2", type: "Bolt", pos: "7", qty: "2", spec: "M12 x 60", strength: "10.9", artNo: "700101" };
const B2_M6: DrawingConnectionRow = { name: "B2", type: "Bolt", pos: "9", qty: "2", spec: "M6 x 20", strength: "8.8", artNo: "700909" };
const BOTH_TORQUES: DrawingCallout[] = [
  { ref: "C3-B1", torque: "Ma=95 Nm", notes: [] },
  { ref: "C3-B2", torque: "Ma=95 Nm", notes: [] },
];

describe("r3 F1 — two rows printed together on one photo are never merged", () => {
  it("B1 and B2 sharing an article number stay two parts, with or without a second identical photo", () => {
    const t = variant({ extraRows: [B2_SAME_ART], callouts: BOTH_TORQUES });
    for (const photos of [[reviewed("p1", t)], [reviewed("p1", t), reviewed("p2", t)]]) {
      const bolts = build(photos).parts.filter((p) => p.partNumber.value === "700101");
      expect(bolts).toHaveLength(2);
      expect(bolts.map((b) => b.qty.value)).toEqual(["2", "2"]);
    }
  });
});

describe("r3 F2 — every named fastener row needs a torque", () => {
  it("B2 with no callout is an unknown measurement and a blocker, and the step does not point at 'the torque below'", () => {
    const packet = build([reviewed("p1", variant({ extraRows: [B2_M6], callouts: [{ ref: "C3-B1", torque: "Ma=95 Nm", notes: [] }] }))]);
    const b2 = packet.measurements.find((m) => m.name.value === "C3-B2 tightening torque");
    expect(b2?.value).toMatchObject({ value: null, label: "unknown" });
    expect((packet.blockers ?? []).some((b) => /C3-B2/.test(b.basis ?? ""))).toBe(true);
    expect(packet.steps.map((s) => s.text.value)).not.toContain("Tighten to the torque below.");
  });

  it("control: a callout for each named row states both torques", () => {
    const packet = build([reviewed("p1", variant({ extraRows: [B2_M6], callouts: BOTH_TORQUES }))]);
    expect(packet.measurements.map((m) => [m.name.value, m.value.value])).toEqual([
      ["C3-B1 tightening torque", "95 Nm"],
      ["C3-B2 tightening torque", "95 Nm"],
    ]);
    expect(packet.steps.map((s) => s.text.value)).toContain("Tighten to the torque below.");
  });
});

describe("r3 F3 — a partly unreadable note is never a Verified instruction", () => {
  it("keeps the raw wording visible, unresolved, with a blocker", () => {
    const packet = build([reviewed("p1", variant({ notes: ["Do not remove [?] before supporting assembly"] }))]);
    const note = packet.safety.cautions.find((c) => (c.basis ?? "").includes("Do not remove [?] before supporting assembly"));
    expect(note).toMatchObject({ value: null, label: "unknown" });
    expect(packet.safety.cautions.some((c) => c.label === "verified" && (c.value ?? "").includes("[?]"))).toBe(false);
    expect((packet.blockers ?? []).some((b) => /partly unreadable/.test(b.basis ?? ""))).toBe(true);
  });
});

describe("r3 F4 — a connection-wide torque is cited to its own callout line", () => {
  it("'C3 Ma=95 Nm' survives verification, Verified and cited to the CALLOUT line", () => {
    const packet = build([reviewed("p1", variant({ callouts: [{ ref: "C3", torque: "Ma=95 Nm", notes: [] }] }))]);
    expect(verifyPacket(packet)).toEqual([]);
    expect(packet.measurements).toHaveLength(1);
    expect(packet.measurements[0].value).toMatchObject({ value: "95 Nm", label: "verified" });
    expect(packet.measurements[0].value.source?.line.startsWith("CALLOUT | C3 |")).toBe(true);
    expect(packet.steps.map((s) => s.text.value)).toContain("Tighten to the torque below.");
  });
});
