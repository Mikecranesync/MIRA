/**
 * TQ-05 / TQ-06 (2026-10-17 prod test): the PLC-5 manual's pages extract as a
 * fixed +29 cipher (",QDGGLWLRQ" is "Inaddition"). Detect it, decode it, and
 * never touch a page that is already English.
 */
import { describe, expect, it } from "vitest";
import {
  decodeShift29,
  detectGarble,
  encodeShift29,
  englishDensity,
  planChunkRepairs,
  repairExtractedPage,
} from "../garbled-text";

const PLC5_PAGE =
  "In addition, the PLC-5 processor stores the program in battery-backed RAM. " +
  "When the processor is in Program mode, the outputs are de-energized and the " +
  "program is not scanned. Install the battery before you connect power to the " +
  "chassis, and replace it when the BATT status indicator turns on. The fault " +
  "table lists the major fault code in word S:12 of the status file.";

const PARTS_TABLE =
  "1771-P7 120/220V AC 16A   1771-A1B 4-slot chassis   1785-L40E   1771-IBD 24V DC input module\n" +
  "1771-OBD 24V DC output module   1771-IAD 120V AC input   1771-OAD 120V AC output   1785-BCM\n" +
  "Cat. No. Description Qty   1771-CP1 cable 1 m   1771-CP2 cable 2 m   1785-ENET Ethernet module";

describe("the cipher itself", () => {
  it("the prod-test sample decodes: ,QDGGLWLRQ → Inaddition", () => {
    expect(decodeShift29(",QDGGLWLRQ")).toBe("Inaddition");
  });
  it("encode/decode round-trip a real sentence, spaces included", () => {
    expect(decodeShift29(encodeShift29(PLC5_PAGE))).toBe(PLC5_PAGE);
  });
  it("the shifted space (0x03) and shifted punctuation (0x0F = ',') come back as space and comma", () => {
    expect(decodeShift29(",Q\u0003DGGLWLRQ\u000f")).toBe("In addition,");
  });
  it("leaves layout whitespace, non-ASCII and already-lowercase letters alone (no double shift)", () => {
    expect(decodeShift29("line one\nline two")).toBe("line one\nline two");
    expect(decodeShift29("Ω ± ¼ zyx")).toBe("Ω ± ¼ zyx");
  });
});

describe("englishDensity", () => {
  it("is near zero for the cipher and well above the floor for prose", () => {
    expect(englishDensity(encodeShift29(PLC5_PAGE))).toBeLessThan(1);
    expect(englishDensity(PLC5_PAGE)).toBeGreaterThanOrEqual(6);
  });
  it("is zero for a short string (never decides on a header)", () => {
    expect(englishDensity("WKH SURFHVVRU")).toBe(0);
  });
});

describe("detectGarble", () => {
  it("flags the shifted PLC-5 page as shift29 and returns the decoded page", () => {
    const v = detectGarble(encodeShift29(PLC5_PAGE));
    expect(v.garbled).toBe(true);
    if (!v.garbled || v.method !== "shift29") throw new Error("expected shift29");
    expect(v.decoded).toBe(PLC5_PAGE);
    expect(v.decodedDensity).toBeGreaterThanOrEqual(3);
  });

  it("control: an ordinary English page is not garbled", () => {
    expect(detectGarble(PLC5_PAGE)).toEqual({ garbled: false, density: expect.any(Number) });
  });

  it("control: a dense parts table (few common words, many codes) is not garbled", () => {
    expect(detectGarble(PARTS_TABLE).garbled).toBe(false);
    // …and the decoder is never applied to it, even when asked directly
    expect(repairExtractedPage(PARTS_TABLE)).toEqual({ text: PARTS_TABLE, repair: null, unrepaired: false });
  });

  it("control: a short page (< 80 letters) is never flagged, cipher or not", () => {
    expect(detectGarble(encodeShift29("In addition, the processor stores the program.")).garbled).toBe(false);
  });

  it("flags a long wordless letter-soup page as garbled-but-unknown (the OCR cue), without decoding it", () => {
    const soup = "QXZKV JQPLX ZVKQJ XPLQZ VKJQX ".repeat(12);
    const v = detectGarble(soup);
    expect(v.garbled).toBe(true);
    if (!v.garbled) throw new Error("unreachable");
    expect(v.method).toBe("unknown");
    expect(repairExtractedPage(soup)).toEqual({ text: soup, repair: null, unrepaired: true });
  });
});

describe("repairExtractedPage", () => {
  it("decodes a shifted page and marks the repair", () => {
    expect(repairExtractedPage(encodeShift29(PLC5_PAGE))).toEqual({ text: PLC5_PAGE, repair: "shift29", unrepaired: false });
  });
  it("still repairs when the spaces were dropped by the parser (words run together but are searchable)", () => {
    const noSpaces = encodeShift29(PLC5_PAGE).replace(/ /g, "");
    const out = repairExtractedPage(noSpaces);
    expect(out.repair).toBe("shift29");
    expect(out.text).toContain("Inaddition");
    expect(out.text).toContain("battery-backedRAM");
  });
});

describe("planChunkRepairs (the flag-gated backfill for rows already in knowledge_entries)", () => {
  it("returns only the rows it would rewrite, decoded, and leaves English rows out", () => {
    const plan = planChunkRepairs([
      { id: "a", content: encodeShift29(PLC5_PAGE) },
      { id: "b", content: PLC5_PAGE },
      { id: "c", content: PARTS_TABLE },
    ]);
    expect(plan.map((r) => r.id)).toEqual(["a"]);
    expect(plan[0]).toEqual({ id: "a", content: PLC5_PAGE, repair: "shift29" });
  });
});

// ── Review A (Grok 4.6 via Cursor, 2026-10-18) on #4486 ──
// The reviewer reported a false-POSITIVE: an English header followed by a
// cipher body supposedly got the whole page decoded, mangling the header.
// Verified on 40626b375 — that does NOT reproduce; the page came back
// `repair: null` with the header untouched. The real defect is the opposite
// and the reviewer's second finding names it: the page is left GARBLED,
// because the header's English words lift whole-page density above the gate.
// That is the actual TQ-05/06 shape, so it is the shape that matters.
//
// Repairing block by block fixes the false negative AND makes the
// false positive the reviewer feared structurally impossible: an English
// block is never handed to the decoder.
describe("Review A — a page that mixes English and cipher is repaired block by block", () => {
  const BODY =
    "In addition, the PLC-5 processor stores the program in battery-backed RAM. When the processor is in Program mode, the outputs are de-energized and the program is not scanned. Install the battery before you connect power to the chassis.";
  const HEADER = "Chapter 4  Processor Status and Fault Handling";

  it("decodes the cipher body and leaves the English header byte-identical", () => {
    const out = repairExtractedPage(`${HEADER}\n\n${encodeShift29(BODY)}`);
    expect(out.repair).toBe("shift29");
    expect(out.text.split("\n")[0]).toBe(HEADER);
    expect(out.text).toContain("battery-backed RAM");
    expect(out.text).not.toContain(",QDGGLWLRQ");
  });

  it("a mostly-cipher page with a few real words is repaired, not skipped", () => {
    const out = repairExtractedPage(`${encodeShift29(BODY)}\n\nWARNING Do not remove the cover.`);
    expect(out.repair).toBe("shift29");
    expect(out.text).toContain("WARNING Do not remove the cover.");
    expect(out.text).toContain("battery-backed RAM");
  });

  it("control: an all-English page is still untouched, block by block", () => {
    const page = `${HEADER}\n\n${BODY}`;
    expect(repairExtractedPage(page)).toEqual({ text: page, repair: null, unrepaired: false });
  });

  it("control: a parts table beside an English header is untouched", () => {
    const page = `${HEADER}\n\n1771-P7 120/220V AC 16A   1771-A1B 4-slot chassis   1785-L40E   1771-IBD 24V DC input`;
    expect(repairExtractedPage(page).repair).toBeNull();
  });
});

// Round-2 review (2026-10-18): the decoder was rewriting clean English. The
// +29 map produces NO ASCII lowercase, so lowercase is the structural tell;
// these pin the guard on the reviewer's own reproduction strings.
describe("round 2 — English is never decoded (the lowercase guard)", () => {
  const M172 = "Do not connect a power cable longer than 10 m (32.8 ft)";
  const HEADING_AND_CIPHER =
    "Using Relay-Type Instructions " +
    encodeShift29("The examine-if-closed instruction tests the bit for an on condition and the output energizes when true");

  it("the M172 line that was becoming 'ao not connect ~ power c~ble …' is untouched", () => {
    // Precondition: this is exactly the shape that slipped through — under 40
    // letters, so raw density reads 0, and the decode coins uppercase from the
    // digits and punctuation.
    expect((M172.match(/[A-Za-z]/g) ?? []).length).toBeLessThan(40);
    expect(englishDensity(M172)).toBe(0);
    expect(repairExtractedPage(M172)).toEqual({ text: M172, repair: null, unrepaired: false });
  });

  it("a heading sharing a LINE with cipher is left alone, never mangled (false negative, the safe direction)", () => {
    const out = repairExtractedPage(HEADING_AND_CIPHER);
    expect(out.text).toBe(HEADING_AND_CIPHER);
    expect(out.repair).toBeNull();
    expect(out.text.startsWith("Using Relay-Type Instructions")).toBe(true);
  });

  it("control: a pure-cipher block beside that heading on its OWN line is still decoded, heading byte-identical", () => {
    const body = encodeShift29("The examine-if-closed instruction tests the bit for an on condition and the output energizes when true");
    // This block's cipher happens to contain "FOR" ("closed" → "FORVHG"), so
    // its raw density is 1.22 — above the old block ceiling of 1.0. It is
    // genuine cipher and must still decode: the lowercase guard, not the
    // density ceiling, is what keeps English out.
    expect(englishDensity(body)).toBeGreaterThan(1);
    const out = repairExtractedPage(`Using Relay-Type Instructions\n${body}`);
    expect(out.repair).toBe("shift29");
    expect(out.text.split("\n")[0]).toBe("Using Relay-Type Instructions");
    expect(out.text).toContain("examine-if-closed instruction");
  });

  const SHORT_LINES = [
    "Install the battery first.",
    "Connect power to the chassis.",
    "Check the fault table word.",
    "Replace the module and set the mode.",
  ].map(encodeShift29);

  it("the whole-page fallback decodes a page of SHORT cipher lines (each under the block minimum)", () => {
    for (const l of SHORT_LINES) expect((l.match(/[A-Za-z]/g) ?? []).length).toBeLessThan(40);
    const out = repairExtractedPage(SHORT_LINES.join("\n"));
    expect(out.repair).toBe("shift29");
    expect(out.text).toContain("Install the battery first.");
  });

  it("…but never wholesale over a page that carries an English heading (left garbled, flagged for OCR)", () => {
    const page = `Relay Ladder Logic\n${SHORT_LINES.join("\n")}`;
    // Precondition: the page-level verdict alone WOULD decode this page.
    expect(detectGarble(page)).toMatchObject({ garbled: true, method: "shift29" });
    expect(repairExtractedPage(page)).toEqual({ text: page, repair: null, unrepaired: true });
  });
});

// The 3-distinct-common-words floor in blockIsShift29, pinned at its boundary
// so it cannot be quietly lowered. Both fixtures pass every OTHER gate
// identically (42–45 letters, zero digits, raw density 0, decoded density 33):
// the only difference is how many different common words the decode yields.
describe("blockIsShift29 — the distinct-common-words floor is exactly three", () => {
  const TWO_WORDS = encodeShift29("the and ".repeat(7).trim()); // decodes to {the, and}
  const THREE_WORDS = encodeShift29("the and for ".repeat(5).trim()); // decodes to {the, and, for}

  it("a block that decodes to only two distinct common words is NOT repaired", () => {
    // Precondition: the fixture really is cipher that would decode to English.
    expect(englishDensity(decodeShift29(TWO_WORDS))).toBeGreaterThanOrEqual(3);
    expect(repairExtractedPage(TWO_WORDS)).toEqual({ text: TWO_WORDS, repair: null, unrepaired: false });
  });

  it("control: the same shape with three distinct common words IS repaired", () => {
    const out = repairExtractedPage(THREE_WORDS);
    expect(out.repair).toBe("shift29");
    expect(out.text).toBe("the and for ".repeat(5).trim());
  });
});
