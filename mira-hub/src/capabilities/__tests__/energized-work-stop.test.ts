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

  it("cites the manual's lockout page", () => {
    expect(text).toContain("GS10 User Manual.pdf, p.2-15");
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

  it("cites the manual without a page when the chunk has none", () => {
    expect(energizedWorkStop({ title: "GS10 User Manual.pdf", page: null })).toContain("**GS10 User Manual.pdf** — follow it first");
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
