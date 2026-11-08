/**
 * Codex adversarial review r5 (owner-authorized) on #5204 — one test group per finding. FICTIONAL fixtures only.
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
const UNNAMED_M6_BOLT: DrawingConnectionRow = { name: "", type: "Bolt", pos: "9", qty: "2", spec: "M6 x 20", strength: "8.8", artNo: "700909" };

/** PHOTO_A with C3's rows REPLACED (not appended) and the callouts replaced. */
function withRows(rows: DrawingConnectionRow[], callouts: DrawingCallout[]): DrawingTranscription {
  const d = PHOTO_A.drawing!;
  return {
    ...PHOTO_A,
    drawing: { ...d, connections: d.connections.map((c) => (c.id === "C3" ? { ...c, rows } : c)), callouts, notes: [] },
  };
}

const C3_B1_ONLY: DrawingCallout[] = [{ ref: "C3-B1", torque: "Ma=95 Nm", notes: [] }];
const WASHER: DrawingConnectionRow = { name: "", type: "Washer", pos: "8", qty: "4", spec: "12", strength: "ZL", artNo: "700202" };
const noTighten = (p: ReturnType<typeof build>) => !p.steps.map((s) => s.text.value).includes("Tighten to the torque below.");

describe("r5 F1 — a fastener type the packet does not recognise is treated as needing torque", () => {
  it("an unnamed 'Schraube' row with only a C3-B1 callout raises a blocker", () => {
    const p = build([reviewed("pS", withRows([B1, { ...UNNAMED_M6_BOLT, type: "Schraube" }], C3_B1_ONLY))]);
    expect((p.blockers ?? []).some((b) => /no readable name/i.test(b.basis))).toBe(true);
    expect(noTighten(p)).toBe(true);
  });
  it("control: an unnamed washer and nut ('Scheibe', 'Mutter' included) need no torque of their own", () => {
    const rows = [B1, WASHER, { ...WASHER, type: "Scheibe", pos: "10", artNo: "700210" }, { ...WASHER, type: "Mutter", pos: "11", artNo: "700211" }];
    const p = build([reviewed("pW", withRows(rows, C3_B1_ONLY))]);
    expect((p.blockers ?? []).filter((b) => /torque|no readable name/i.test(b.basis))).toEqual([]);
    expect(noTighten(p)).toBe(false);
  });
});

describe("r5 F2 — a named washer is not a torque target", () => {
  it("washer W1 next to bolt B1 with a C3-B1 torque: no C3-W1 gap, packet says tighten", () => {
    const p = build([reviewed("pN", withRows([B1, { ...WASHER, name: "W1" }], C3_B1_ONLY))]);
    expect((p.blockers ?? []).some((b) => /C3-W1/.test(b.basis))).toBe(false);
    expect(noTighten(p)).toBe(false);
  });
  it("control: a named bolt B2 without a callout is still a gap", () => {
    const p = build([reviewed("pB", withRows([B1, { ...B1, name: "B2", pos: "9", artNo: "700909" }], C3_B1_ONLY))]);
    expect((p.blockers ?? []).some((b) => /C3-B2/.test(b.basis))).toBe(true);
  });
});

describe("r5 F3 — an unreadable drawing revision is never Verified", () => {
  const unreadableRev = (): DrawingTranscription => ({
    ...PHOTO_A,
    drawing: { ...PHOTO_A.drawing!, revision: "[?]", filenameShown: null },
  });
  it("precondition: the fixture revision is '[?]' with no filename to read it from", () => {
    expect(unreadableRev().drawing!.revision).toBe("[?]");
    expect(unreadableRev().drawing!.filenameShown).toBeNull();
  });
  it("revision '[?]' is unknown and raises a blocker", () => {
    const p = build([reviewed("pR", unreadableRev())]);
    expect(p.documents[0].revision?.label).toBe("unknown");
    expect((p.blockers ?? []).some((b) => /revision/i.test(b.basis))).toBe(true);
  });
  it("control: a readable revision stays Verified with no revision blocker", () => {
    const p = build([reviewed("pA", PHOTO_A)]);
    expect(p.documents[0].revision?.label).toBe("verified");
    expect((p.blockers ?? []).some((b) => /revision cannot be read/i.test(b.basis))).toBe(false);
  });
});
