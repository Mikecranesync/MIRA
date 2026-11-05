import { describe, expect, it } from "vitest";

import { buildConnectionPacket } from "../drawing-packet";
import { mergeDrawingPhotos, renderDrawingSourceText, type DrawingSheetPhoto, type DrawingTranscription } from "../drawing";
import { verifyPacket } from "../verify";
import type { DocText, Identity, WorkOrderInput } from "../types";
import { PHOTOS } from "./fixtures/drawing-example";

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

/** Builds the `DocText` a photo's kept notebook source would be: the canonical LINE text of its
 *  transcription, exactly as `photo-source.ts` would materialize it. */
function docFor(photo: DrawingSheetPhoto): DocText {
  return {
    docId: photo.docId,
    fileId: photo.fileId,
    filename: photo.reviewed ? `Technician-reviewed photo reading (${photo.docId}).txt` : `Unconfirmed photo reading (${photo.docId}).txt`,
    via: "file",
    pages: [{ page: 1, text: renderDrawingSourceText(photo.t) }],
  };
}

const DRAWING_PHOTOS: DrawingSheetPhoto[] = PHOTOS.map((p) => ({ docId: p.docId, fileId: p.fileId, reviewed: p.reviewed, t: p.t }));
const DOCS: DocText[] = DRAWING_PHOTOS.map(docFor);
const SHEETS = mergeDrawingPhotos(DRAWING_PHOTOS);

describe("buildConnectionPacket", () => {
  it("drafts a clean packet for C3 that verifyPacket accepts outright", () => {
    const result = buildConnectionPacket({
      notebookId: "nb-1",
      packetId: "pk-c3",
      now: "2026-11-04T00:00:00Z",
      identity: IDENTITY,
      workOrder: WORK_ORDER,
      sheets: SHEETS,
      connectionRef: "C3",
      docs: DOCS,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { packet } = result;

    expect(result.warnings).toEqual([]);
    expect(verifyPacket(packet)).toEqual([]);

    expect(packet.scope).toHaveLength(1);
    expect(packet.scope[0]).toMatchObject({ value: "Loose torque stripe at C3: replace hardware and re-torque", label: "proposed" });

    expect(packet.parts).toHaveLength(3);
    const bolt = packet.parts[0];
    expect(bolt.partNumber).toMatchObject({ value: "700101", label: "verified" });
    expect(bolt.description).toMatchObject({ value: "Bolt M12 x 60 10.9", label: "verified" });
    expect(bolt.qty).toMatchObject({ value: "2", label: "verified" });
    expect(bolt.item).toBe(5); // BOM pos for Art. No. 700101 (pos_offset vs the drawing's printed pos 7)
    expect(packet.parts[1].item).toBe(6);
    expect(packet.parts[2].item).toBe(13);

    expect(packet.measurements).toHaveLength(1);
    expect(packet.measurements[0].name).toMatchObject({ value: "C3-B1 tightening torque", label: "verified" });
    expect(packet.measurements[0].value).toMatchObject({ value: null, label: "unknown" });
    expect(packet.measurements[0].steps).toEqual([4]);

    // 7 fixed steps: make-safe, check fasteners, replace hardware, apply locker (C3 has a note),
    // tighten, torque-stripe, record.
    expect(packet.steps).toHaveLength(7);
    expect(packet.steps.every((s) => s.text.label === "proposed")).toBe(true);
    expect(packet.steps[3].text.value).toContain("Secure with Demo-Lock 2");
    expect(packet.steps[4].text.value).toBe("Tighten to the torque below.");

    // blockers: revision_conflict + 3×pos_offset + unreadable + torque_conflict + revision_touches_torque
    expect(packet.blockers).toHaveLength(7);
    expect(packet.blockers!.every((b) => b.label === "unknown")).toBe(true);

    expect(packet.safety.siteIsolation).toMatchObject({ label: "unknown", value: null });
    expect(packet.tools).toHaveLength(1);
    expect(packet.tools[0].label).toBe("unknown");
  });

  it("keeps an Ma*-marked torque's printed value but forces it unknown, and has no locker step for C4", () => {
    const result = buildConnectionPacket({
      notebookId: "nb-1",
      packetId: "pk-c4",
      now: "2026-11-04T00:00:00Z",
      identity: IDENTITY,
      workOrder: WORK_ORDER,
      sheets: SHEETS,
      connectionRef: "C4",
      docs: DOCS,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { packet } = result;

    expect(verifyPacket(packet)).toEqual([]);
    expect(packet.measurements).toHaveLength(1);
    expect(packet.measurements[0].value.label).toBe("unknown");
    expect(packet.measurements[0].value.value).toBe("6 Nm");
    expect(packet.measurements[0].value.basis).toContain("asterisk");

    // No callout note on C4-B1 → no "apply the thread locker" step → 6 fixed steps, not 7.
    expect(packet.steps).toHaveLength(6);
    expect(packet.steps.some((s) => (s.text.value ?? "").toLowerCase().includes("thread locker"))).toBe(false);

    // blockers: revision_conflict + pos_placeholder(C4) + torque_marked(C4) + revision_touches_torque
    // + not_cross_checked(C4: Art. No. 700404 is not in the BOM rows read)
    expect(packet.blockers).toHaveLength(5);
    expect((packet.blockers ?? []).some((b) => (b.basis ?? "").includes("700404"))).toBe(true);
  });

  it("refuses when the requested connection is on no sheet", () => {
    const result = buildConnectionPacket({
      notebookId: "nb-1",
      packetId: "pk-missing",
      now: "2026-11-04T00:00:00Z",
      identity: IDENTITY,
      workOrder: WORK_ORDER,
      sheets: SHEETS,
      connectionRef: "C99",
      docs: DOCS,
    });
    expect(result).toMatchObject({ ok: false, reason: "model_not_in_documents" });
  });

  it("refuses when no sheet carries a drawing", () => {
    const result = buildConnectionPacket({
      notebookId: "nb-1",
      packetId: "pk-empty",
      now: "2026-11-04T00:00:00Z",
      identity: IDENTITY,
      workOrder: WORK_ORDER,
      sheets: [],
      connectionRef: "C3",
      docs: [],
    });
    expect(result).toMatchObject({ ok: false, reason: "no_documents" });
  });

  it("labels a clean torque from an UNREVIEWED photo 'proposed' with a citable source, not 'unknown'", () => {
    const t: DrawingTranscription = {
      kind: "drawing",
      drawing: {
        documentNo: "77777-00001-",
        revision: "A",
        filenameShown: "9999_7777700001A1.PDF",
        title: "Minimal fixture",
        titleEnglish: "Minimal fixture",
        ride: "Demo Coaster",
        application: "Test",
        sheet: "1",
        views: [],
        revisionHistory: [],
        connections: [
          { id: "C9", classText: null, rows: [{ name: "B1", type: "Bolt", pos: "1", qty: "1", spec: "M8 x 20", strength: "8.8", artNo: "900001" }] },
        ],
        callouts: [{ ref: "C9-B1", torque: "Ma=45 Nm", notes: [] }],
        notes: [],
        bom: [{ pos: "1", qty: "1", drawingNo: "77777-00001-", artNo: "900001", description: "Hex bolt", material: "Steel", standard: null }],
      },
      otherText: [],
      unreadable: [],
    };
    const photo: DrawingSheetPhoto = { docId: "photo-x", fileId: "file-x", reviewed: false, t };
    const sheets = mergeDrawingPhotos([photo]);
    const docs: DocText[] = [docFor(photo)];

    const result = buildConnectionPacket({
      notebookId: "nb-2",
      packetId: "pk-c9",
      now: "2026-11-04T00:00:00Z",
      identity: IDENTITY,
      workOrder: WORK_ORDER,
      sheets,
      connectionRef: "C9",
      docs,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(verifyPacket(result.packet)).toEqual([]);
    expect(result.packet.measurements).toHaveLength(1);
    const value = result.packet.measurements[0].value;
    expect(value.label).toBe("proposed");
    expect(value.value).toBe("45 Nm");
    expect(value.source).not.toBeNull();
  });

  it("a null qty cell (not in the photo) yields an unknown part qty with the 'not in this photo' basis", () => {
    const t: DrawingTranscription = {
      kind: "drawing",
      drawing: {
        documentNo: "55555-00002-",
        revision: "A",
        filenameShown: null,
        title: null,
        titleEnglish: null,
        ride: "Demo Coaster",
        application: "Test",
        sheet: null,
        views: [],
        revisionHistory: [],
        connections: [
          { id: "C6", classText: null, rows: [{ name: "B1", type: "Bolt", pos: "1", qty: null, spec: "M8 x 16", strength: "8.8", artNo: "550001" }] },
        ],
        callouts: [],
        notes: [],
        bom: [],
      },
      otherText: [],
      unreadable: [],
    };
    const photo: DrawingSheetPhoto = { docId: "photo-y", fileId: "file-y", reviewed: false, t };
    const sheets = mergeDrawingPhotos([photo]);
    const docs: DocText[] = [docFor(photo)];

    const result = buildConnectionPacket({
      notebookId: "nb-3",
      packetId: "pk-c6",
      now: "2026-11-04T00:00:00Z",
      identity: IDENTITY,
      workOrder: WORK_ORDER,
      sheets,
      connectionRef: "C6",
      docs,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.parts).toHaveLength(1);
    expect(result.packet.parts[0].qty).toMatchObject({ value: null, label: "unknown" });
    expect(result.packet.parts[0].qty.basis).toBe("not in this photo");
  });

  it("flags document_unidentified and blocks the packet when a table-only photo carries no documentNo or filename", () => {
    const t: DrawingTranscription = {
      kind: "drawing",
      drawing: {
        documentNo: null,
        revision: null,
        filenameShown: null,
        title: null,
        titleEnglish: null,
        ride: null,
        application: null,
        sheet: null,
        views: [],
        revisionHistory: [],
        connections: [
          { id: "C10", classText: null, rows: [{ name: "B1", type: "Bolt", pos: "1", qty: "1", spec: "M8 x 20", strength: "8.8", artNo: "990001" }] },
        ],
        callouts: [],
        notes: [],
        bom: [],
      },
      otherText: [],
      unreadable: [],
    };
    const photo: DrawingSheetPhoto = { docId: "photo-nodoc", fileId: "file-nodoc", reviewed: true, t };
    const sheets = mergeDrawingPhotos([photo]);
    expect(sheets).toHaveLength(1);
    expect(sheets[0].documentKey).toBeNull();

    const docs: DocText[] = [docFor(photo)];
    const result = buildConnectionPacket({
      notebookId: "nb-4",
      packetId: "pk-c10",
      now: "2026-11-04T00:00:00Z",
      identity: IDENTITY,
      workOrder: WORK_ORDER,
      sheets,
      connectionRef: "C10",
      docs,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.blockers!.some((b) => b.basis.includes("does not show which drawing number or revision"))).toBe(true);
    expect(result.packet.documents).toHaveLength(1);
    expect(result.packet.documents[0].revision.label).not.toBe("verified");
    expect(result.packet.documents[0].revision.value).toBeNull();
  });
});
