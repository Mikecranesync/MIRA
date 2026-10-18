/**
 * TQ-29 (2026-10-17 prod test): the energized-work stop cites the manual's own
 * lockout page (GS10 p.2-15) and carries no removal steps or torques.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { ManualChunk } from "@/lib/manual-rag";
import {
  energizedHardStopEnabled,
  energizedWorkStop,
  lockoutPageOf,
  pickLockoutChunk,
} from "../energized-work-stop";

const chunk = (over: Partial<ManualChunk>): ManualChunk => ({
  content: "",
  docId: "d-1",
  manufacturer: "",
  modelNumber: "",
  sourceUrl: "node-doc/u1/gs10_manual.pdf",
  sourcePage: 1,
  chunkIndex: null,
  title: "GS10 User Manual.pdf",
  rank: 0.1,
  verified: true,
  ...over,
});

const TORQUE_PAGE = chunk({
  content: "Remove the four cover screws (M4). Tighten the cover screws to 10 in-lb (1.1 N·m) on reassembly.",
  sourcePage: 43,
  pageLabel: "4-3",
});
const WIRING_STEP = chunk({
  content: "Disconnect power before changing the DIP switch. Terminal R/L1 accepts 14 AWG.",
  sourcePage: 30,
  pageLabel: "3-4",
});
const LOCKOUT_PAGE = chunk({
  content:
    "WARNING! Hazardous voltage. Disconnect all power to the drive and wait at least 5 minutes for the DC bus capacitors to discharge before servicing. Lock out and tag out the disconnect.",
  sourcePage: 25,
  pageLabel: "2-15",
});

afterEach(() => {
  delete process.env.NOTEBOOK_ENERGIZED_HARD_STOP;
});

describe("pickLockoutChunk", () => {
  it("prefers the WARNING-headed disconnect-power page over an incidental wiring mention", () => {
    expect(pickLockoutChunk([TORQUE_PAGE, WIRING_STEP, LOCKOUT_PAGE])).toBe(LOCKOUT_PAGE);
  });
  it("falls back to any passage that says to disconnect power", () => {
    expect(pickLockoutChunk([TORQUE_PAGE, WIRING_STEP])).toBe(WIRING_STEP);
  });
  it("returns null when no attached passage says to disconnect / lock out (never invents a page)", () => {
    expect(pickLockoutChunk([TORQUE_PAGE])).toBeNull();
    expect(pickLockoutChunk([])).toBeNull();
  });
});

describe("lockoutPageOf", () => {
  it("cites the printed chapter-section label when present (TQ-29: 2-15, not 25)", () => {
    expect(lockoutPageOf(LOCKOUT_PAGE)).toBe("2-15");
  });
  it("falls back to the integer page, then null", () => {
    expect(lockoutPageOf(chunk({ sourcePage: 7 }))).toBe("7");
    expect(lockoutPageOf(chunk({ sourcePage: null }))).toBeNull();
  });
});

describe("energizedWorkStop", () => {
  const text = energizedWorkStop({ title: "GS10 User Manual.pdf", page: "2-15" });

  // Review A HIGH: the filename used to be rendered here and is now gone —
  // the document is named by the turn's `sources` citation chip instead, so a
  // customer-controlled upload name can never reach a safety stop.
  it("cites the manual's lockout PAGE and never its filename", () => {
    expect(text).toContain("p.2-15");
    expect(text).not.toContain("GS10 User Manual.pdf");
    expect(text).toMatch(/SAFETY STOP/);
  });

  it("carries no removal steps and no torques — only the page number appears", () => {
    expect(text).not.toMatch(/in-lb|N·m|Nm|ft-lb|torque|tighten|remove the|unscrew|screws/i);
    // Every digit run in the stop (outside the manual's own title) is the cited page, nothing else.
    const numbers = text.replace("GS10 User Manual.pdf", "").match(/\d[\d-]*/g) ?? [];
    expect(numbers).toEqual(["2-15"]);
  });

  it("tells the technician what to do with no page (site LOTO), still with no steps", () => {
    const noPage = energizedWorkStop(null);
    expect(noPage).toMatch(/site's lockout\/tagout procedure/);
    expect(noPage).not.toMatch(/\d/);
  });

  it("with no usable page, points at the cited document without naming it", () => {
    const out = energizedWorkStop({ title: "GS10 User Manual.pdf", page: null });
    expect(out).toContain("the document cited below");
    expect(out).not.toContain("GS10 User Manual.pdf");
  });
});

describe("energizedHardStopEnabled", () => {
  it("defaults ON and only '0' disables it", () => {
    expect(energizedHardStopEnabled()).toBe(true);
    process.env.NOTEBOOK_ENERGIZED_HARD_STOP = "0";
    expect(energizedHardStopEnabled()).toBe(false);
    process.env.NOTEBOOK_ENERGIZED_HARD_STOP = "1";
    expect(energizedHardStopEnabled()).toBe(true);
  });
});

// ── Review A (Grok 4.6 via Cursor, 2026-10-18) HIGH findings, reproduced ──
// The stop text claimed "no removal steps, no torques". That held only because
// every input to it was harmless. Both the TITLE and the PAGE are
// attacker-influenced: a customer names the file they upload, and the page
// label comes from chunk metadata. Verified leaking on 0d28afad9.
describe("Review A HIGH — nothing from the manual may reach the stop text", () => {
  it("a crafted upload filename cannot inject steps or torques", () => {
    const out = energizedWorkStop({ title: "torque 8-10 kg·cm, remove jumper JP1.pdf", page: "2-15" });
    expect(out).not.toMatch(/torque|remove jumper|kg·cm/i);
    expect(out).toContain("p.2-15");
  });

  it("markdown or prose smuggled through the page label cannot inject steps", () => {
    const out = energizedWorkStop({ title: "m.pdf", page: "2-15**\n\n1. Remove the cover screws (8 kg·cm)" });
    expect(out).not.toMatch(/Remove the cover|kg·cm/i);
  });

  it.each([
    ["a chapter-section label", "2-15", true],
    ["a plain page number", "42", true],
    ["prose", "see the lockout section", false],
    ["markdown injection", "2-15**\n\n1. Remove the cover", false],
    ["an empty label", "", false],
  ])("only a real page label is ever cited: %s", (_l, page, kept) => {
    const out = energizedWorkStop({ title: "m.pdf", page });
    expect(/\bp\.[0-9A-Za-z-]+/.test(out)).toBe(kept);
  });
});

describe("Review A HIGH — pickLockoutChunk must not prefer front matter", () => {
  const FRONT = chunk({
    content: "WARNING! Read all instructions before use. Disconnect power before servicing.",
    sourcePage: 2,
    pageLabel: "2",
  });
  const REAL = chunk({
    content:
      "WARNING! Hazardous voltage. Disconnect all power to the drive and wait at least 5 minutes for the DC bus capacitors to discharge before servicing. Lock out and tag out the disconnect.",
    sourcePage: 25,
    pageLabel: "2-15",
  });

  it("the real lockout passage (p.2-15) beats a front-matter warning on p.2", () => {
    expect(lockoutPageOf(pickLockoutChunk([FRONT, REAL])!)).toBe("2-15");
    // order must not decide it
    expect(lockoutPageOf(pickLockoutChunk([REAL, FRONT])!)).toBe("2-15");
  });

  it("front matter is still used when it is the only lockout text there is", () => {
    expect(lockoutPageOf(pickLockoutChunk([FRONT])!)).toBe("2");
  });
});

// Round 2 (2026-10-18): the reviewer, who has the real GS10 manual, reports
// the actual TQ-29 passage is "Do not remove the RFI jumper while power is
// applied" on p.2-17 — and no lockout signal matched it, so that page could
// never be cited; the stop fell back to p.2-15. The "not while powered"
// warning is now a signal. Unverified against the real PDF: the fixture is
// the reviewer's quoted sentence.
describe("Round 2 — the manual's own 'not while power is applied' warning is a lockout signal", () => {
  const RFI_WARNING = chunk({
    content: "WARNING! Do not remove the RFI jumper while power is applied. Hazardous voltage is present at the jumper terminals.",
    sourcePage: 27,
    pageLabel: "2-17",
  });

  it("a passage that only says 'do not remove … while power is applied' is a candidate, not excluded", () => {
    expect(pickLockoutChunk([TORQUE_PAGE, RFI_WARNING])).toBe(RFI_WARNING);
  });

  it("control: the full lockout procedure (more distinct signals) still outranks it", () => {
    expect(lockoutPageOf(pickLockoutChunk([RFI_WARNING, LOCKOUT_PAGE])!)).toBe("2-15");
  });

  // Codex F4 (round 3): the powered-state phrase alone was a signal, so an
  // operating-page sentence was cited as "the manual's lockout procedure".
  it("operating text that merely mentions 'while power is applied' is NOT a lockout page (site-LOTO fallback instead)", () => {
    const OPERATING = chunk({ content: "The RUN indicator is illuminated while power is applied. The display shows the output frequency.", sourcePage: 43, pageLabel: "4-3" });
    expect(pickLockoutChunk([TORQUE_PAGE, OPERATING])).toBeNull();
    expect(energizedWorkStop(null)).toMatch(/lockout/i);
  });

  // Codex F4 (round 2): one bare keyword is not a lockout page.
  it.each([
    "The capacitor discharge resistor is rated at 100 ohms and mounts on the heatsink.",
    "The keypad lockout feature prevents parameter changes from the front panel. Set P3.00 to enable it.",
    "Tag out of range: the tagout field accepts up to 16 characters.",
    // round 3 — a declarative about relay behaviour, and a prohibition that is not about powered work
    "The fault relay de-energizes when an alarm occurs.",
    "Do not connect a low power sensor to this port.",
    // round 4 — "power" as a modifier, not the thing being removed
    "Turn off power saving mode to prevent the display from sleeping.",
    "Remove the power module from the chassis.",
    "Disconnect power output terminal T1 before wiring.",
    // Codex round 5 — "power supply" as a modifier of a setting or a signal cable
    "Turn off power supply monitoring in the diagnostics menu.",
    "Disconnect the power supply status cable from the controller.",
    "Remove the power supply cover screws to access the fuse.",
  ])("a single keyword noun is NOT a lockout page: %s", (content) => {
    expect(pickLockoutChunk([TORQUE_PAGE, chunk({ content, sourcePage: 43, pageLabel: "4-3" })])).toBeNull();
  });

  it.each([
    "Disconnect power before changing the DIP switch.", // the imperative alone qualifies
    "WARNING! Do not remove the RFI jumper while power is applied.", // the prohibition alone qualifies
    "Lock out the disconnect and wait 5 minutes before servicing.", // two signals qualify
    "Disconnect power.", // bare imperative at end of sentence
    "Disconnect the power supply before servicing the unit.", // "power supply" is the thing removed
    "Disconnect all power to the drive and wait 5 minutes before servicing.",
    "Isolate the main power supply from the drive and verify zero voltage.", // round 5 control: supply ends the clause
    "Turn off the power supply.", // round 5 control: bare, at end of sentence
  ])("control: an instruction or two signals still qualify: %s", (content) => {
    expect(pickLockoutChunk([TORQUE_PAGE, chunk({ content, sourcePage: 25, pageLabel: "2-15" })])).not.toBeNull();
  });
});
