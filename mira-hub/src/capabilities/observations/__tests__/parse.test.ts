import { describe, expect, it } from "vitest";
import { previewObservation } from "../parse";

const TZ = "America/New_York";
// 2026-06-15 is EDT (UTC-4). 09:10 local = 13:10Z.
const SUMMER_NOON_UTC = new Date("2026-06-15T12:00:00.000Z");

describe("previewObservation (zero-token deterministic parser)", () => {
  it("seal leak at 09:10 → seal_leak / present / ISO time in plant zone", () => {
    const p = previewObservation("seal leaking at 09:10", { now: SUMMER_NOON_UTC, timeZone: TZ });
    expect(p.factKey).toBe("seal_leak");
    expect(p.factValue).toBe("present");
    expect(p.observedAt).toBe("2026-06-15T13:10:00.000Z");
    expect(p.needs).toEqual([]);
  });

  it("negation: 'no leak seen' → seal_leak / absent", () => {
    const p = previewObservation("no leak seen", { now: SUMMER_NOON_UTC, timeZone: TZ });
    expect(p.factKey).toBe("seal_leak");
    expect(p.factValue).toBe("absent");
  });

  it("repair: 'replaced the seal' → seal_leak / repaired", () => {
    const p = previewObservation("replaced the seal", { now: SUMMER_NOON_UTC, timeZone: TZ });
    expect(p.factKey).toBe("seal_leak");
    expect(p.factValue).toBe("repaired");
  });

  it("no time in the text → observedAt null and needs observed_at", () => {
    const p = previewObservation("seal leaking", { now: SUMMER_NOON_UTC, timeZone: TZ });
    expect(p.observedAt).toBeNull();
    expect(p.needs).toContain("observed_at");
  });

  it("gibberish → fact_key null, value null, needs fact_key", () => {
    const p = previewObservation("qwerty zxcvb", { now: SUMMER_NOON_UTC, timeZone: TZ });
    expect(p.factKey).toBeNull();
    expect(p.factValue).toBeNull();
    expect(p.needs).toContain("fact_key");
  });

  it("never emits a root cause, health or safety field", () => {
    const p = previewObservation("bad bearing, seal leaking at 9:10am", { now: SUMMER_NOON_UTC, timeZone: TZ });
    const keys = Object.keys(p).join(" ");
    expect(keys).not.toMatch(/root|health|safe/i);
    expect(p.observedAt).toBe("2026-06-15T13:10:00.000Z");
  });

  it("12-hour time: 9:10pm is 21:10 local", () => {
    const p = previewObservation("seal leaking at 9:10pm", { now: SUMMER_NOON_UTC, timeZone: TZ });
    expect(p.observedAt).toBe("2026-06-16T01:10:00.000Z");
  });

  it("DST-change day: a bare 09:10 after the switch uses the offset AT that time (EST, UTC-5)", () => {
    // 2026-11-01 switches at 02:00 local; 09:10 that morning is EST.
    const p = previewObservation("seal leaking at 09:10", { now: new Date("2026-11-01T18:00:00.000Z"), timeZone: TZ });
    expect(p.observedAt).toBe("2026-11-01T14:10:00.000Z");
  });
});
