/**
 * Codex adversarial review r4 (owner-authorized) on #5204 — one test group per finding. FICTIONAL fixtures only.
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

const B1: DrawingConnectionRow = { name: "B1", type: "Bolt", pos: "7", qty: "2", spec: "M12 x 60", strength: "10.9", artNo: "700101" };
const B2_SAME_ART: DrawingConnectionRow = { name: "B2", type: "Bolt", pos: "7", qty: "2", spec: "M12 x 60", strength: "10.9", artNo: "700101" };
const UNNAMED_M6_BOLT: DrawingConnectionRow = { name: "", type: "Bolt", pos: "9", qty: "2", spec: "M6 x 20", strength: "8.8", artNo: "700909" };
const BOTH_TORQUES: DrawingCallout[] = [
  { ref: "C3-B1", torque: "Ma=95 Nm", notes: [] },
  { ref: "C3-B2", torque: "Ma=95 Nm", notes: [] },
];

/** PHOTO_A with C3's rows REPLACED (not appended) and the callouts replaced. */
function withRows(rows: DrawingConnectionRow[], callouts: DrawingCallout[]): DrawingTranscription {
  const d = PHOTO_A.drawing!;
  return {
    ...PHOTO_A,
    drawing: { ...d, connections: d.connections.map((c) => (c.id === "C3" ? { ...c, rows } : c)), callouts, notes: [] },
  };
}

const boltParts = (p: ReturnType<typeof build>) => p.parts.filter((x) => /700101/.test(x.partNumber?.value ?? "") || /M12 x 60/.test(x.description?.value ?? ""));

describe("r4 F1 — rows with different printed names on complementary photos are never merged", () => {
  const pB1 = reviewed("pB1", withRows([B1], BOTH_TORQUES));
  const pB2 = reviewed("pB2", withRows([B2_SAME_ART], BOTH_TORQUES));
  it("precondition: each photo shows only its own bolt row", () => {
    expect(pB1.t.drawing!.connections.find((c) => c.id === "C3")!.rows.map((r) => r.name)).toEqual(["B1"]);
    expect(pB2.t.drawing!.connections.find((c) => c.id === "C3")!.rows.map((r) => r.name)).toEqual(["B2"]);
  });
  it("B1 and B2 sharing article + position stay two parts and no bolt quantity is Verified", () => {
    const p = build([pB1, pB2]);
    const bolts = boltParts(p);
    expect(bolts.length).toBe(2);
    expect(bolts.some((b) => b.qty.label === "verified")).toBe(false);
  });
  it("is the same in either photo order", () => {
    const p = build([pB2, pB1]);
    expect(boltParts(p).length).toBe(2);
    expect(boltParts(p).some((b) => b.qty.label === "verified")).toBe(false);
  });
  it("control: the same B1 row on two photos is one part with a Verified quantity", () => {
    const p = build([pB1, reviewed("pB1b", withRows([B1], BOTH_TORQUES))]);
    const bolts = boltParts(p);
    expect(bolts.length).toBe(1);
    expect(bolts[0].qty).toMatchObject({ value: "2", label: "verified" });
  });
});

describe("r4 F2 — an unnamed bolt row needs a torque too", () => {
  it("an unnamed M6 bolt with only a C3-B1 callout raises a blocker and no 'tighten to the torque below'", () => {
    const p = build([reviewed("pU", withRows([B1, UNNAMED_M6_BOLT], [{ ref: "C3-B1", torque: "Ma=95 Nm", notes: [] }]))]);
    expect((p.blockers ?? []).some((b) => /no readable name/i.test(b.basis))).toBe(true);
    expect(p.steps.map((s) => s.text.value)).not.toContain("Tighten to the torque below.");
  });
  it("control: unnamed washer and nut rows (PHOTO_A) need no torque of their own", () => {
    const p = build([reviewed("pA", PHOTO_A)]);
    expect((p.blockers ?? []).some((b) => /no readable name/i.test(b.basis))).toBe(false);
    expect(p.steps.map((s) => s.text.value)).toContain("Tighten to the torque below.");
  });
  it("control: a connection-wide C3 callout covers the unnamed bolt", () => {
    const p = build([reviewed("pW", withRows([B1, UNNAMED_M6_BOLT], [{ ref: "C3", torque: "Ma=95 Nm", notes: [] }]))]);
    expect((p.blockers ?? []).some((b) => /no readable name/i.test(b.basis))).toBe(false);
  });
});

describe("r4 F3 — a row shares its article number with another row: each cites its own line", () => {
  const B2_QTY3: DrawingConnectionRow = { ...B2_SAME_ART, qty: "3" };
  it("B2's quantity 3 stays Verified and cites B2's line", () => {
    const p = build([reviewed("pS", withRows([B1, B2_QTY3], BOTH_TORQUES))]);
    const b2 = p.parts.find((x) => x.qty.value === "3");
    expect(b2?.qty.label).toBe("verified");
    expect(b2?.qty.source?.line).toContain("| B2 |");
    expect(verifyPacket(p).filter((w) => /qty/.test(w))).toEqual([]);
  });
  it("control: B1 cites B1's line", () => {
    const p = build([reviewed("pS", withRows([B1, B2_QTY3], BOTH_TORQUES))]);
    const b1 = p.parts.find((x) => x.qty.value === "2");
    expect(b1?.qty.source?.line).toContain("| B1 |");
  });
});
