/**
 * pdf-layout-e2e.test.ts — a real PDF, read by the real unpdf/pdf.js loader, through the real
 * parser and builder (Codex #5062 F15, round 10). The invented 85-frame fixture manual is laid out
 * like the real CAT manuals: body text 10pt; each "@fig" run is a photo (an actual image) with its
 * caption rows 12pt and 23pt below it in 9.5pt/8.5pt. A line can only be skipped as a caption when
 * the layout places it under a photo; safety text in a smaller font right below a caption, or a
 * smaller-font CAUTION below a large empty gap, must never vanish behind a Verified fragment.
 */
import { describe, expect, it } from "vitest";
import { FIXTURES } from "./fixtures";
import { buildPdf, type PdfPage, type PdfText } from "./fixtures/pdf";
import { pdfDocPages } from "../document-text";
import { buildDraftPacket } from "../draft";
import type { DocText, DraftInput, WorkPacket } from "../types";

const M35 = FIXTURES["manual-35style.txt"];

/** Lay a fixture dump out as PDF pages. `sizes` overrides the type size of exact lines; `gapBefore`
 *  adds empty space (pt) above exact lines. */
function layout(raw: string, sizes: Record<string, number> = {}, gapBefore: Record<string, number> = {}): PdfPage[] {
  return raw
    .split(/^===== PAGE \d+ =====\n/m)
    .filter((p) => p.length > 0)
    .map((pageText) => {
      const texts: PdfText[] = [];
      const images: PdfPage["images"] = [];
      let y = 760;
      let caption = 0;
      for (const line of pageText.split("\n").filter((l) => l.length > 0)) {
        if (line.startsWith("@fig ")) {
          if (caption === 0) {
            images.push({ x: 18, y: y - 120, w: 171, h: 120 });
            y -= 120;
          }
          texts.push({ text: line.slice(5), x: 18, y: y - (caption === 0 ? 12 : 11), size: caption === 0 ? 9.5 : 8.5 });
          y -= caption === 0 ? 12 : 11;
          caption++;
          continue;
        }
        y -= (caption > 0 ? 11 : 12) + (gapBefore[line] ?? 0);
        caption = 0;
        texts.push({ text: line, x: 18, y, size: sizes[line] ?? 10 });
      }
      return { texts, images };
    });
}

async function packetFrom(pages: PdfPage[]): Promise<{ packet: WorkPacket; doc: DocText }> {
  const doc: DocText = { docId: "sm", fileId: null, filename: "manual-35style.pdf", pages: await pdfDocPages(buildPdf(pages)), via: "file" };
  const input: DraftInput = {
    notebookId: "11111111-1111-4111-8111-111111111111",
    packetId: "pk-1",
    now: "2026-11-01T12:00:00Z",
    identity: { manufacturer: "CAT Pumps", model: "8520", catalogNumber: null, serialNumber: null, status: "user_confirmed", confidence: 0.9 },
    workOrder: { id: "WO-1", title: "Service", description: "valve service", assetTag: null, site: null, synthetic: true },
    docs: [doc],
    hazardFlags: [],
  };
  const result = buildDraftPacket(input);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("refused");
  return { packet: result.packet, doc };
}

const edit = (pairs: [string, string][]) =>
  pairs.reduce((text, [from, to]) => {
    expect(text).toContain(from);
    return text.replace(from, to);
  }, M35);
const stepTexts = (p: WorkPacket) => p.steps.map((s) => s.text.value ?? "");
const placeGaps = (p: WorkPacket) => p.unknowns.filter((u) => /could not be placed/.test(u.basis));

// The fixture's caption sits after Reassembly step 2; move it to interrupt Disassembly step 2.
const CAPTION = "@fig All models except 8560\n@fig Removal of Discharge Valve Plug\n";
const STEP2 = "2. Remove the exposed Coil Spring from the top of the Spring Retainer.\n";
const CAUTION_TAIL = "shut off drive (electric motor, gas or diesel engine) and turn off water supply to\npump. Relieve all discharge line pressure by triggering gun or opening valve in discharge line.\n";

describe("real PDF → pdfDocPages → parser → builder", () => {
  it("control: the fixture manual's real caption under its photo is skipped, and nothing is left unplaced", async () => {
    const { packet, doc } = await packetFrom(layout(M35));
    expect(doc.pages[1].figureLines).toEqual(["All models except 8560", "Removal of Discharge Valve Plug"]);
    expect(stepTexts(packet)).toContain("Remove the six (6) M41 Hex Valve Plugs.");
    expect(placeGaps(packet)).toEqual([]);
    expect(packet.safety.cautions.some((c) => c.label === "verified" && (c.value ?? "").includes("Relieve all discharge line pressure"))).toBe(true);
  });

  for (const size of [9.5, 8]) {
    it(`a ${size}pt safety continuation right below a caption: the step's section is a gap, not a Verified fragment`, async () => {
      const cont = "ONLY AFTER RELIEVING ALL SYSTEM PRESSURE (0 psi)";
      const raw = edit([[CAPTION, ""], [STEP2, `2. Remove the valve plug (M41)\n${CAPTION}${cont}\n`]]);
      const { packet, doc } = await packetFrom(layout(raw, { [cont]: size }));
      expect(doc.pages[1].figureLines).not.toContain(cont);
      expect(stepTexts(packet).some((t) => t.startsWith("Remove the valve plug"))).toBe(false);
      const gaps = placeGaps(packet).filter((u) => /Disassembly \(All models except 8560\)/.test(u.basis));
      expect(gaps).toHaveLength(1);
      expect(gaps[0].basis).toContain("text after step 2 (p.2)");
    });
  }

  it("an 8pt safety continuation of a CAUTION right below a caption: Unknown in Safety, not Verified", async () => {
    const cont = "AND RELIEVE ALL DISCHARGE PRESSURE (0 psi)";
    const raw = edit([[CAPTION, ""], [CAUTION_TAIL, `shut off drive (electric motor)\n${CAPTION}${cont}\n`]]);
    const { packet } = await packetFrom(layout(raw, { [cont]: 8 }));
    expect(packet.safety.cautions.some((c) => c.label === "verified" && (c.value ?? "").startsWith("Before commencing"))).toBe(false);
    expect(packet.safety.cautions.filter((c) => c.label === "unknown" && /could not be placed/.test(c.basis ?? ""))).toHaveLength(1);
  });

  // Codex r11: a ONE-line caption 12pt under the photo, then a small-print safety line 23pt under it —
  // inside the caption band and the photo's column, so layout alone cannot tell it from a caption.
  const ONE_LINE_CAPTION = "@fig Removal of Valve Plug\n";
  const SHORT = "ONLY AFTER RELIEVING ALL PRESSURE";

  it("Codex r11: a one-line caption then an 8pt safety line inside the band, after a step: a gap, no Verified fragment", async () => {
    const raw = edit([[CAPTION, ""], [STEP2, `2. Remove the valve plug (M41)\n${ONE_LINE_CAPTION}${SHORT}\n`]]);
    const { packet, doc } = await packetFrom(layout(raw, { [SHORT]: 8 }));
    expect(doc.pages[1].figureLines).toContain(SHORT); // the layout alone does take it for caption text
    expect(stepTexts(packet).some((t) => t.startsWith("Remove the valve plug"))).toBe(false);
    expect(placeGaps(packet).filter((u) => /Disassembly \(All models except 8560\)/.test(u.basis))).toHaveLength(1);
  });

  it("Codex r11: the same after a caution: Unknown in Safety, not Verified", async () => {
    const raw = edit([[CAPTION, ""], [CAUTION_TAIL, `shut off drive (electric motor)\n${ONE_LINE_CAPTION}${SHORT}\n`]]);
    const { packet } = await packetFrom(layout(raw, { [SHORT]: 8 }));
    expect(packet.safety.cautions.some((c) => c.label === "verified" && (c.value ?? "").startsWith("Before commencing"))).toBe(false);
    expect(packet.safety.cautions.filter((c) => c.label === "unknown" && /could not be placed/.test(c.basis ?? ""))).toHaveLength(1);
  });

  it("a two-line 9pt CAUTION below a large empty gap (no photo): its second line is never dropped", async () => {
    const first = "CAUTION: Before commencing with service, shut off drive (electric motor)";
    const second = "AND RELIEVE ALL DISCHARGE PRESSURE (0 psi)";
    const raw = edit([[CAPTION, ""], ["CAUTION: Before commencing with service, " + CAUTION_TAIL, `${first}\n${second}\n`]]);
    const { packet, doc } = await packetFrom(layout(raw, { [first]: 9, [second]: 9 }, { [first]: 244 }));
    expect(doc.pages[1].figureLines ?? []).toEqual([]);
    const verified = packet.safety.cautions.filter((c) => c.label === "verified" && (c.value ?? "").startsWith("Before commencing"));
    for (const c of verified) expect(c.value).toContain("RELIEVE ALL DISCHARGE PRESSURE");
  });
});
