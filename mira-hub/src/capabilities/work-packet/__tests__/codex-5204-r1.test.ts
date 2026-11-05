/**
 * Codex adversarial review r1 on #5204 — one red-then-green test per pure-logic finding.
 * F3 (atomic review publication) and F7 (recall before recompute) are route-level and live in
 * `src/capabilities/__tests__/drawing-photos-{review-,}route.test.ts`. FICTIONAL fixtures only.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildConnectionPacket } from "../drawing-packet";
import {
  mergeDrawingPhotos,
  parseDrawingSourceText,
  renderDrawingSourceText,
  type DrawingSheetPhoto,
  type DrawingTranscription,
} from "../drawing";
import { withoutDrawingCandidates } from "../document-text";
import { DRAWING_TRANSCRIPTION_PRODUCER, DRAWING_TRANSCRIPTION_PROMPT } from "../drawing-prompt";
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

function build(photos: DrawingSheetPhoto[], extra: { drawing?: string | null; hazardFlags?: string[] } = {}) {
  return buildConnectionPacket({
    notebookId: "nb-1",
    packetId: "pk-1",
    now: "2026-11-05T00:00:00Z",
    identity: IDENTITY,
    workOrder: WORK_ORDER,
    sheets: mergeDrawingPhotos(photos),
    connectionRef: "C3",
    docs: photos.map(docFor),
    ...extra,
  });
}

/** PHOTO_A with C3's bolt row quantity replaced. */
function withBoltQty(qty: string): DrawingTranscription {
  const d = PHOTO_A.drawing!;
  return {
    ...PHOTO_A,
    drawing: {
      ...d,
      connections: d.connections.map((c) =>
        c.id === "C3" ? { ...c, rows: c.rows.map((r, i) => (i === 0 ? { ...r, qty } : r)) } : c,
      ),
    },
  };
}

/** PHOTO_A re-numbered as another drawing that also has a C3. */
function otherDrawing(): DrawingTranscription {
  const d = PHOTO_A.drawing!;
  return {
    ...PHOTO_A,
    drawing: {
      ...d,
      documentNo: "80001-10000-",
      filenameShown: "9100_8000110000C1.PDF",
      connections: d.connections.map((c) =>
        c.id === "C3" ? { ...c, rows: c.rows.map((r, i) => (i === 0 ? { ...r, spec: "M16 x 80" } : r)) } : c,
      ),
    },
  };
}

describe("F1 — conflicting hardware readings across photos never stay Verified", () => {
  const two = withBoltQty("2");
  const four = withBoltQty("4");
  const photos: DrawingSheetPhoto[] = [
    { docId: "p-2", fileId: "f-2", reviewed: true, t: two },
    { docId: "p-4", fileId: "f-4", reviewed: true, t: four },
  ];

  it("blanks the conflicting cell and names both readings as a blocker", () => {
    const result = build(photos);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bolt = result.packet.parts[0];
    expect(bolt.qty.label).not.toBe("verified");
    expect(bolt.qty.value).toBeNull();
    const conflict = (result.packet.blockers ?? []).find((b) => /Qty|qty/.test(b.basis ?? "") && /'2'/.test(b.basis ?? "") && /'4'/.test(b.basis ?? ""));
    expect(conflict).toBeDefined();
  });

  it("gives the same answer whatever order the photos arrive in", () => {
    const a = build(photos);
    const b = build([...photos].reverse());
    if (!a.ok || !b.ok) throw new Error("expected ok packets");
    expect(b.packet.parts.map((p) => [p.qty.value, p.qty.label])).toEqual(a.packet.parts.map((p) => [p.qty.value, p.qty.label]));
    expect((b.packet.blockers ?? []).map((x) => x.basis).sort()).toEqual((a.packet.blockers ?? []).map((x) => x.basis).sort());
  });

  it("agreeing readings still produce a Verified quantity", () => {
    const result = build([
      { docId: "p-a", fileId: "f-a", reviewed: true, t: two },
      { docId: "p-b", fileId: "f-b", reviewed: true, t: withBoltQty("2") },
    ]);
    if (!result.ok) throw new Error("expected ok");
    expect(result.packet.parts[0].qty).toMatchObject({ value: "2", label: "verified" });
  });
});

describe("F2 — a connection id on two drawings must name the drawing", () => {
  const photos: DrawingSheetPhoto[] = [
    { docId: "p-9", fileId: "f-9", reviewed: true, t: PHOTO_A },
    { docId: "p-8", fileId: "f-8", reviewed: true, t: otherDrawing() },
  ];

  it("refuses an unqualified C3 with both drawing numbers", () => {
    const result = build(photos);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("connection_ambiguous");
    expect(result.message).toContain("90001");
    expect(result.message).toContain("80001");
  });

  it("selects the named drawing regardless of source order", () => {
    for (const order of [photos, [...photos].reverse()]) {
      const result = build(order, { drawing: "80001-10000-" });
      if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
      expect(result.packet.parts[0].description.value).toContain("M16 x 80");
    }
  });

  it("refuses a drawing that does not carry the connection", () => {
    const result = build(photos, { drawing: "70001-10000-" });
    expect(result.ok).toBe(false);
  });
});

describe("F4 — a pipe or newline inside a cell survives the LINE round trip", () => {
  it("round-trips cells containing pipes, backslashes and newlines unchanged", () => {
    const tricky = withBoltQty("2");
    const d = tricky.drawing!;
    tricky.drawing = {
      ...d,
      connections: d.connections.map((c) =>
        c.id === "C3" ? { ...c, rows: c.rows.map((r, i) => (i === 0 ? { ...r, spec: "M12 | x 60", artNo: "70\\0101\nX" } : r)) } : c,
      ),
    };
    const back = parseDrawingSourceText(renderDrawingSourceText(tricky));
    expect(back).not.toBeNull();
    const row = back!.drawing!.connections.find((c) => c.id === "C3")!.rows[0];
    expect(row.spec).toBe("M12 | x 60");
    expect(row.strength).toBe("10.9");
    expect(row.artNo).toBe("70\\0101\nX");
  });

  it("rejects a row with more cells than its tag allows instead of shifting columns", () => {
    expect(parseDrawingSourceText("KIND | drawing\nCONNECTION | C9 | A | extra")).toBeNull();
  });

  it("rejects a dangling or unknown escape", () => {
    expect(parseDrawingSourceText("KIND | drawing\nNOTE | bad \\q escape")).toBeNull();
  });
});

describe("F5 — classified work-order hazards reach the connection packet", () => {
  it("keeps the route's hazard flags in packet.safety", () => {
    const result = build([{ docId: "p-a", fileId: "f-a", reviewed: true, t: PHOTO_A }], {
      hazardFlags: ["Hazard named in the work order — confirm isolation per site procedure."],
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.packet.safety.hazardFlags).toEqual(["Hazard named in the work order — confirm isolation per site procedure."]);
  });
});

describe("F6 — unreviewed drawing candidates feed only the connection path, and only as Proposed", () => {
  it("an unreviewed candidate's values are never Verified", () => {
    const result = build([{ docId: "p-u", fileId: "f-u", reviewed: false, t: PHOTO_A }]);
    if (!result.ok) throw new Error("expected ok");
    for (const p of result.packet.parts) {
      expect(p.qty.label).not.toBe("verified");
      expect(p.partNumber.label).not.toBe("verified");
    }
  });

  it("a candidate that conflicts with a reviewed photo still raises the conflict", () => {
    const result = build([
      { docId: "p-r", fileId: "f-r", reviewed: true, t: withBoltQty("2") },
      { docId: "p-u", fileId: "f-u", reviewed: false, t: withBoltQty("4") },
    ]);
    if (!result.ok) throw new Error("expected ok");
    expect(result.packet.parts[0].qty.label).not.toBe("verified");
  });

  it("withoutDrawingCandidates drops only the admitted candidates", () => {
    const docs: DocText[] = [
      { docId: "kept", fileId: null, filename: null, via: "chunks", pages: [] },
      { docId: "cand", fileId: null, filename: null, via: "chunks", pages: [], drawingCandidate: true },
    ];
    expect(withoutDrawingCandidates(docs).map((d) => d.docId)).toEqual(["kept"]);
  });
});

describe("F7 — the recall key moves with the prompt", () => {
  it("pins the prompt digest to the producer version (edit the prompt → bump DRAWING_TRANSCRIPTION_PRODUCER and this digest)", () => {
    const digest = createHash("sha256").update(DRAWING_TRANSCRIPTION_PROMPT).digest("hex");
    expect({ producer: DRAWING_TRANSCRIPTION_PRODUCER, digest }).toEqual({
      producer: "drawing-transcription/v1",
      digest: "060db0d384751d677042af12043825b1aa2047559f4c7d390cd4adf3e3290bc7",
    });
  });
});
