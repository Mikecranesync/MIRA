import { describe, expect, it } from "vitest";

import {
  docRevFromFilename,
  mergeDrawingPhotos,
  parseDrawingSourceText,
  parseDrawingTranscription,
  renderDrawingSourceText,
  type DrawingSheetPhoto,
  type DrawingTranscription,
} from "../drawing";
import {
  DOCUMENT_NO,
  FILENAME_REV_B,
  FILENAME_REV_C,
  PHOTO_A,
  PHOTO_B,
  PHOTO_C,
  PHOTO_EQUIPMENT,
  PHOTOS,
} from "./fixtures/drawing-example";

describe("parseDrawingTranscription", () => {
  it("parses a full drawing transcription", () => {
    const parsed = parseDrawingTranscription(JSON.parse(JSON.stringify(PHOTO_A)));
    expect(parsed).toEqual(PHOTO_A);
  });

  it("parses a non-drawing transcription (drawing: null)", () => {
    const parsed = parseDrawingTranscription(JSON.parse(JSON.stringify(PHOTO_EQUIPMENT)));
    expect(parsed).toEqual(PHOTO_EQUIPMENT);
  });

  it("is tolerant of extra keys at every level", () => {
    const raw = JSON.parse(JSON.stringify(PHOTO_A));
    raw.extraTopLevel = "ignore me";
    raw.drawing.extraDrawingLevel = 42;
    raw.drawing.connections[0].extraConnLevel = true;
    raw.drawing.connections[0].rows[0].extraRowLevel = null;
    const parsed = parseDrawingTranscription(raw);
    expect(parsed).toEqual(PHOTO_A);
  });

  it("rejects non-object input", () => {
    expect(parseDrawingTranscription(null)).toBeNull();
    expect(parseDrawingTranscription("drawing")).toBeNull();
    expect(parseDrawingTranscription(42)).toBeNull();
    expect(parseDrawingTranscription(["drawing"])).toBeNull();
  });

  it("rejects a missing or unknown kind", () => {
    expect(parseDrawingTranscription({ drawing: null, otherText: [], unreadable: [] })).toBeNull();
    expect(parseDrawingTranscription({ kind: "blueprint", drawing: null, otherText: [], unreadable: [] })).toBeNull();
  });

  it("rejects a drawing object with a wrong-typed required field", () => {
    const raw = JSON.parse(JSON.stringify(PHOTO_A));
    raw.drawing.documentNo = 90001; // number, not string
    expect(parseDrawingTranscription(raw)).toBeNull();
  });

  it("rejects a connection row missing a required key entirely", () => {
    const raw = JSON.parse(JSON.stringify(PHOTO_A));
    delete raw.drawing.connections[0].rows[0].artNo;
    expect(parseDrawingTranscription(raw)).toBeNull();
  });

  it("rejects a malformed otherText/unreadable array", () => {
    expect(parseDrawingTranscription({ kind: "drawing", drawing: null, otherText: "not an array", unreadable: [] })).toBeNull();
    expect(parseDrawingTranscription({ kind: "drawing", drawing: null, otherText: [], unreadable: [1, 2] })).toBeNull();
  });
});

describe("renderDrawingSourceText / parseDrawingSourceText round trip", () => {
  it.each([
    ["Photo A (reviewed drawing)", PHOTO_A],
    ["Photo B (BOM + revision history)", PHOTO_B],
    ["Photo C (filename/revision conflict)", PHOTO_C],
    ["Photo D (non-drawing)", PHOTO_EQUIPMENT],
  ])("round-trips %s exactly", (_label, t) => {
    const text = renderDrawingSourceText(t as DrawingTranscription);
    const parsed = parseDrawingSourceText(text);
    expect(parsed).toEqual(t);
  });

  it("returns null for an unrecognized tag", () => {
    expect(parseDrawingSourceText("KIND | drawing\nNOT_A_TAG | whatever")).toBeNull();
  });

  it("returns null for a ROW line with no preceding CONNECTION header", () => {
    expect(parseDrawingSourceText("KIND | drawing\nROW | B1 | Bolt | 7 | 2 | M12 x 60 | 10.9 | 700101")).toBeNull();
  });
});

describe("docRevFromFilename", () => {
  it("parses the reviewed-photo filename", () => {
    expect(docRevFromFilename(FILENAME_REV_C)).toEqual({ docNoDigits: "9000110000", rev: "C", sheet: "1" });
  });

  it("parses the conflicting-revision filename", () => {
    expect(docRevFromFilename(FILENAME_REV_B)).toEqual({ docNoDigits: "9000110000", rev: "B", sheet: "1" });
  });

  it("matches the fixture's documentNo digits (dashes removed)", () => {
    const { docNoDigits } = docRevFromFilename(FILENAME_REV_C)!;
    expect(docNoDigits).toBe(DOCUMENT_NO.replace(/[^0-9]/g, ""));
  });

  it("returns null for a filename that does not match the convention", () => {
    expect(docRevFromFilename("not-a-drawing-filename.pdf")).toBeNull();
    expect(docRevFromFilename("9100_9000110000.PDF")).toBeNull();
  });
});

describe("mergeDrawingPhotos", () => {
  const sheets = mergeDrawingPhotos(PHOTOS);

  it("groups the three drawing photos into one sheet and ignores the equipment photo", () => {
    expect(sheets).toHaveLength(1);
    expect(sheets[0].photos.map((p) => p.docId).sort()).toEqual(["photo-a", "photo-b", "photo-c"]);
  });

  it("finds revision_conflict (title-block C vs filename-implied B)", () => {
    const f = sheets[0].findings.filter((x) => x.kind === "revision_conflict");
    expect(f).toHaveLength(1);
    expect(f[0].photos.sort()).toEqual(["photo-a", "photo-b", "photo-c"]);
  });

  it("finds pos_offset for each of the three C3 rows (Art. No. vs BOM pos)", () => {
    const f = sheets[0].findings.filter((x) => x.kind === "pos_offset");
    expect(f).toHaveLength(3);
    for (const finding of f) expect(finding.connection).toBe("C3");
  });

  it("a row whose Art. No. is not in the bill of materials read so far is not cross-checked (per connection)", () => {
    const f = sheets[0].findings.filter((x) => x.kind === "not_cross_checked" && x.connection === "C4");
    expect(f).toHaveLength(1);
    expect(f[0].message).toContain("700404");
    expect(sheets[0].findings.filter((x) => x.kind === "not_cross_checked" && x.connection === "C3")).toHaveLength(0);
  });

  it("finds pos_placeholder for C4's placeholder pos -999", () => {
    const f = sheets[0].findings.filter((x) => x.kind === "pos_placeholder");
    expect(f).toHaveLength(1);
    expect(f[0].connection).toBe("C4");
    expect(f[0].photos).toEqual(["photo-a"]);
  });

  it("finds torque_marked for C4-B1's Ma* callout", () => {
    const f = sheets[0].findings.filter((x) => x.kind === "torque_marked");
    expect(f).toHaveLength(1);
    expect(f[0].connection).toBe("C4");
  });

  it("finds torque_conflict for C3-B1 (95 Nm vs 9[?] Nm across photos)", () => {
    const f = sheets[0].findings.filter((x) => x.kind === "torque_conflict");
    expect(f).toHaveLength(1);
    expect(f[0].connection).toBe("C3");
    expect(f[0].photos.sort()).toEqual(["photo-a", "photo-c"]);
  });

  it("finds unreadable for photo C's '[?]' torque cell", () => {
    const f = sheets[0].findings.filter((x) => x.kind === "unreadable");
    expect(f.length).toBeGreaterThan(0);
    expect(f.some((x) => x.connection === "C3" && x.photos.includes("photo-c"))).toBe(true);
  });

  it("finds revision_touches_torque for photo B's revision-history row", () => {
    const f = sheets[0].findings.filter((x) => x.kind === "revision_touches_torque");
    expect(f).toHaveLength(1);
    expect(f[0].photos).toEqual(["photo-b"]);
  });

  it("does NOT find the document-wide not_cross_checked on this fixture (a BOM is attached)", () => {
    expect(sheets[0].findings.some((x) => x.kind === "not_cross_checked" && x.connection === undefined)).toBe(false);
  });

  it("finds not_cross_checked when no photo of a document carries a BOM", () => {
    const noBomSheets = mergeDrawingPhotos([{ docId: "solo", fileId: "file-solo", reviewed: true, t: PHOTO_A }]);
    expect(noBomSheets).toHaveLength(1);
    expect(noBomSheets[0].findings.some((x) => x.kind === "not_cross_checked")).toBe(true);
  });

  it("ignores a photo whose transcription has no drawing", () => {
    const onlyEquipment = mergeDrawingPhotos([{ docId: "photo-d", fileId: "file-d", reviewed: false, t: PHOTO_EQUIPMENT }]);
    expect(onlyEquipment).toHaveLength(0);
  });

  it("groups a connection-table-only photo with a separate title-block photo sharing the same document number", () => {
    const documentNo = "66666-00003-";
    const tableOnly: DrawingTranscription = {
      kind: "drawing",
      drawing: {
        documentNo,
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
          { id: "C8", classText: null, rows: [{ name: "B1", type: "Bolt", pos: "2", qty: "1", spec: "M10 x 30", strength: "8.8", artNo: "660001" }] },
        ],
        callouts: [],
        notes: [],
        bom: [],
      },
      otherText: [],
      unreadable: [],
    };
    const titleBlockOnly: DrawingTranscription = {
      kind: "drawing",
      drawing: {
        documentNo,
        revision: "B",
        filenameShown: "6000_6666600003B1.PDF",
        title: "Example title block",
        titleEnglish: "Example title block",
        ride: "Demo Coaster",
        application: "Test",
        sheet: "1",
        views: [],
        revisionHistory: [],
        connections: [],
        callouts: [],
        notes: [],
        bom: [],
      },
      otherText: [],
      unreadable: [],
    };
    const photos: DrawingSheetPhoto[] = [
      { docId: "photo-table", fileId: "file-table", reviewed: false, t: tableOnly },
      { docId: "photo-title", fileId: "file-title", reviewed: true, t: titleBlockOnly },
    ];
    const sheets = mergeDrawingPhotos(photos);
    expect(sheets).toHaveLength(1);
    expect(sheets[0].photos.map((p) => p.docId).sort()).toEqual(["photo-table", "photo-title"]);
    expect(sheets[0].findings.some((f) => f.kind === "document_unidentified")).toBe(false);
  });

  it("flags document_unidentified for a photo with neither a documentNo nor a parseable filename", () => {
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
    const finding = sheets[0].findings.find((f) => f.kind === "document_unidentified");
    expect(finding).toBeDefined();
    expect(finding!.photos).toEqual(["photo-nodoc"]);
  });
});

describe("close-up photos with no title block (null scalars)", () => {
  const CLOSEUP_T: DrawingTranscription = {
    kind: "drawing",
    drawing: {
      documentNo: null,
      revision: null,
      filenameShown: null,
      title: null,
      titleEnglish: "Example close-up connection table",
      ride: null,
      application: null,
      sheet: null,
      views: [],
      revisionHistory: [],
      connections: [
        { id: "C5", classText: null, rows: [{ name: "B1", type: "Bolt", pos: "3", qty: "2", spec: "M10 x 40", strength: "8.8", artNo: "800101" }] },
      ],
      callouts: [],
      notes: [],
      bom: [],
    },
    otherText: [],
    unreadable: [],
  };

  it("parses a transcription whose title/filenameShown/ride/application/documentNo/revision are all null", () => {
    const parsed = parseDrawingTranscription(JSON.parse(JSON.stringify(CLOSEUP_T)));
    expect(parsed).not.toBeNull();
    expect(parsed).toEqual(CLOSEUP_T);
  });

  it("round-trips a transcription whose title/filenameShown/ride/application/documentNo/revision are all null", () => {
    const text = renderDrawingSourceText(CLOSEUP_T);
    const parsed = parseDrawingSourceText(text);
    expect(parsed).toEqual(CLOSEUP_T);
  });
});
