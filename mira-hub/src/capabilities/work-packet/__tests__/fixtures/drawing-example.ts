/**
 * Drawing connection packet (#4982 follow-on) — shared FICTIONAL fixture for `drawing.test.ts` and
 * `drawing-packet.test.ts`. The repo is PUBLIC: every name, number and photo line below is invented
 * for this fixture and must never be replaced with anything from a real manual.
 *
 * Shape: a fictional ride builder "Example Rides GmbH", ride "Demo Coaster", one drawing document
 * (`90001-10000-` rev `C`, filename `9100_9000110000C1.PDF`) photographed three times —
 *   Photo A (reviewed):   connections C3 and C4, their callouts.
 *   Photo B (unreviewed): the bill of materials and a revision-history row that touches torque.
 *   Photo C (unreviewed): the same document shown under a filename naming revision B (→
 *                         revision_conflict), and a second, differently-printed C3-B1 torque with an
 *                         unreadable digit (→ torque_conflict / unreadable).
 * Plus one non-drawing photo (kind "equipment") that `mergeDrawingPhotos` must ignore.
 */

import type { DrawingTranscription } from "../../drawing";

export const DOCUMENT_NO = "90001-10000-";
export const DOCUMENT_REV = "C";
export const FILENAME_REV_C = "9100_9000110000C1.PDF";
export const FILENAME_REV_B = "9100_9000110000B1.PDF";

export const PHOTO_A: DrawingTranscription = {
  kind: "drawing",
  drawing: {
    documentNo: DOCUMENT_NO,
    revision: DOCUMENT_REV,
    filenameShown: FILENAME_REV_C,
    title: "Demo Coaster launch connection",
    titleEnglish: "Demo Coaster launch connection",
    ride: "Demo Coaster",
    application: "Launch mechanism",
    sheet: "1",
    views: ["Front", "Section A-A"],
    revisionHistory: [],
    connections: [
      {
        id: "C3",
        classText: "MVK 2",
        rows: [
          { name: "B1", type: "Bolt", pos: "7", qty: "2", spec: "M12 x 60", strength: "10.9", artNo: "700101" },
          { name: "", type: "Washer", pos: "8", qty: "4", spec: "12", strength: "ZL", artNo: "700202" },
          { name: "", type: "Nut", pos: "15", qty: "2", spec: "M12", strength: "10", artNo: "700303" },
        ],
      },
      {
        id: "C4",
        classText: "MVK 0",
        rows: [{ name: "B1", type: "Bolt", pos: "-999", qty: "4", spec: "M6 x 20", strength: "A2-70", artNo: "700404" }],
      },
    ],
    callouts: [
      { ref: "C3-B1", torque: "Ma=95 Nm", notes: ["Secure with Demo-Lock 2"] },
      { ref: "C4-B1", torque: "Ma*=6 Nm", notes: [] },
    ],
    notes: [],
    bom: [],
  },
  otherText: [],
  unreadable: [],
};

export const PHOTO_B: DrawingTranscription = {
  kind: "drawing",
  drawing: {
    documentNo: DOCUMENT_NO,
    revision: DOCUMENT_REV,
    filenameShown: FILENAME_REV_C,
    title: "Demo Coaster launch connection",
    titleEnglish: "Demo Coaster launch connection",
    ride: "Demo Coaster",
    application: "Launch mechanism",
    sheet: "1",
    views: [],
    revisionHistory: [{ rev: "B", text: "tightening torque reduced", date: null }],
    connections: [],
    callouts: [],
    notes: [],
    bom: [
      { pos: "5", qty: "2", drawingNo: DOCUMENT_NO, artNo: "700101", description: "Hex bolt M12x60 10.9", material: "Steel", standard: "ISO 4017" },
      { pos: "6", qty: "4", drawingNo: DOCUMENT_NO, artNo: "700202", description: "Washer 12 ZL", material: "Steel", standard: "ISO 7089" },
      { pos: "13", qty: "2", drawingNo: DOCUMENT_NO, artNo: "700303", description: "Hex nut M12 10", material: "Steel", standard: "ISO 4032" },
    ],
  },
  otherText: [],
  unreadable: [],
};

export const PHOTO_C: DrawingTranscription = {
  kind: "drawing",
  drawing: {
    documentNo: DOCUMENT_NO,
    revision: DOCUMENT_REV,
    filenameShown: FILENAME_REV_B,
    title: "Demo Coaster launch connection",
    titleEnglish: "Demo Coaster launch connection",
    ride: "Demo Coaster",
    application: "Launch mechanism",
    sheet: "1",
    views: [],
    revisionHistory: [],
    connections: [],
    callouts: [{ ref: "C3-B1", torque: "Ma=9[?] Nm", notes: [] }],
    notes: [],
    bom: [],
  },
  otherText: [],
  unreadable: [],
};

export const PHOTO_EQUIPMENT: DrawingTranscription = {
  kind: "equipment",
  drawing: null,
  otherText: ["Nameplate: Demo Coaster launch drive unit"],
  unreadable: [],
};

export interface FixturePhoto {
  docId: string;
  fileId: string | null;
  reviewed: boolean;
  t: DrawingTranscription;
}

export const PHOTOS: FixturePhoto[] = [
  { docId: "photo-a", fileId: "file-a", reviewed: true, t: PHOTO_A },
  { docId: "photo-b", fileId: "file-b", reviewed: false, t: PHOTO_B },
  { docId: "photo-c", fileId: "file-c", reviewed: false, t: PHOTO_C },
  { docId: "photo-d", fileId: "file-d", reviewed: false, t: PHOTO_EQUIPMENT },
];
