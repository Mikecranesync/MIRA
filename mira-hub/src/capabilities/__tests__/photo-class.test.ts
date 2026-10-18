/**
 * Item 8 (2026-10-17 prod test): print vs nameplate vs other, and the
 * PrintSense dispatch stub that refuses to dispatch.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyPhoto } from "../photo-class";
import { dispatchPrint, printsenseDispatchEnabled } from "../printsense-dispatch";

/** Readouts in the shape `recordLookObservation` stores (INSPECTION pass text). */
const LADDER_SHEET =
  "The image shows a ladder diagram, sheet 3 of 7. Rung 12 carries a normally open contact labelled PB1 feeding coil CR4. Continued on sheet 4.";
const ONE_LINE =
  "This is a one-line diagram. Drawing no. E-1042. Terminal strip TB2 wire numbers 101 through 118 are shown along the left edge.";
const MOTOR_PLATE =
  "A motor nameplate. Catalog No. 1LA02104, 10 HP, 460 V, 3-phase, 60 Hz, 1750 RPM, service factor 1.15, insulation class F.";
const DRIVE_PLATE =
  "The label on the drive reads Model Number GS10-2P5, input 240 VAC single-phase, output 2.5 A.";
const CONVEYOR =
  "A conveyor belt viewed from the side. The belt is tracking off to the right and the guard is removed.";
const PANEL_INTERIOR =
  "The inside of a control panel. Several wire numbers are visible on the terminals but no diagram is shown.";

describe("classifyPhoto", () => {
  it.each([
    ["a ladder sheet", LADDER_SHEET],
    ["a one-line drawing", ONE_LINE],
  ])("%s is an electrical print", (_label, text) => {
    const v = classifyPhoto(text);
    expect(v.klass).toBe("electrical_print");
    expect(v.signals.length).toBeGreaterThanOrEqual(2);
  });

  it.each([
    ["a motor nameplate", MOTOR_PLATE],
    ["a drive label", DRIVE_PLATE],
  ])("%s is a nameplate", (_label, text) => {
    expect(classifyPhoto(text).klass).toBe("nameplate");
  });

  it.each([
    ["an equipment photo", CONVEYOR],
    ["a panel interior with only wire numbers", PANEL_INTERIOR],
    ["an empty readout", ""],
    ["a null readout", null],
  ])("%s is other", (_label, text) => {
    expect(classifyPhoto(text).klass).toBe("other");
  });

  it("ONE print signal alone is not a print — the bar is deliberately two", () => {
    // "wire numbers" fires terminal_strip and nothing else.
    expect(classifyPhoto("Terminal strip TB1 with wire numbers.").klass).toBe("other");
    expect(classifyPhoto("Terminal strip TB1 with wire numbers. Continued on sheet 2.").klass).toBe("electrical_print");
  });

  it("a nameplate that merely mentions a diagram stays a nameplate (the expensive mistake is routing a plate to a paid service)", () => {
    const mixed = `${MOTOR_PLATE} A connection diagram is printed on the inside of the cover.`;
    expect(classifyPhoto(mixed).klass).toBe("nameplate");
  });

  it("a print sheet that happens to name a catalog number is still a print when print signals dominate", () => {
    expect(classifyPhoto(`${LADDER_SHEET} Cat. No. 1LA02104 appears in the parts callout.`).klass).toBe("electrical_print");
  });
});

describe("printsense dispatch stub", () => {
  afterEach(() => {
    delete process.env.NOTEBOOK_PRINTSENSE_DISPATCH;
    vi.restoreAllMocks();
  });

  const req = {
    tenantId: "11111111-1111-4111-8111-111111111111",
    fileId: "44444444-4444-4444-8444-444444444444",
    contentSha256: "a".repeat(64),
    klass: "electrical_print" as const,
  };

  it("the flag defaults OFF and only '1' enables it", () => {
    expect(printsenseDispatchEnabled()).toBe(false);
    process.env.NOTEBOOK_PRINTSENSE_DISPATCH = "1";
    expect(printsenseDispatchEnabled()).toBe(true);
  });

  it("a non-print is never dispatched, flag on or off", () => {
    process.env.NOTEBOOK_PRINTSENSE_DISPATCH = "1";
    expect(dispatchPrint({ ...req, klass: "nameplate" })).toEqual({ dispatch: false, reason: "not_a_print" });
    expect(dispatchPrint({ ...req, klass: "other" })).toEqual({ dispatch: false, reason: "not_a_print" });
  });

  it("a print with the flag off reports flag_off and carries no request", () => {
    expect(dispatchPrint(req)).toEqual({ dispatch: false, reason: "flag_off" });
  });

  it("a print with the flag ON still does NOT dispatch — it reports not_wired and carries the recall key", () => {
    process.env.NOTEBOOK_PRINTSENSE_DISPATCH = "1";
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const out = dispatchPrint(req);
    expect(out.dispatch).toBe(false);
    expect(out.reason).toBe("not_wired");
    if (out.reason !== "not_wired") throw new Error("unreachable");
    // The content hash is present from day one so the first real
    // implementation cannot forget its recall key.
    expect(out.request.contentSha256).toBe("a".repeat(64));
    expect(out.request.fileId).toBe(req.fileId);
  });

  it("never performs I/O — no fetch, on any path", () => {
    process.env.NOTEBOOK_PRINTSENSE_DISPATCH = "1";
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    dispatchPrint(req);
    dispatchPrint({ ...req, klass: "nameplate" });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
