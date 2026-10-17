import { describe, it, expect } from "vitest";
import { alarmCardForTurn, alarmReadingEntry } from "./alarm-fast-path";
import { SCREEN_FAIL_SAFE, SCREEN_NEGATIVE } from "./alarm-screens.fixture";

describe("alarmCardForTurn", () => {
  it.each(["", "what does this alarm mean", "What do these alarms mean?", "why is this alarming", "what is this fault"])(
    "claims an alarm question: %j", (q) => {
      expect(alarmCardForTurn({ question: q, lines: SCREEN_FAIL_SAFE })).not.toBeNull();
    });
  it("claims a question that quotes a designation on the screen", () => {
    expect(alarmCardForTurn({ question: "what is =y.CTL+07-K4.1-6 doing", lines: SCREEN_FAIL_SAFE })).not.toBeNull();
  });
  it.each(["what is the torque spec for the motor mount", "show me the wiring for the pump"])(
    "falls through on an unrelated question: %j", (q) => {
      expect(alarmCardForTurn({ question: q, lines: SCREEN_FAIL_SAFE })).toBeNull();
    });
  it("falls through with no lines or non-alarm lines", () => {
    expect(alarmCardForTurn({ question: "what does this alarm mean", lines: null })).toBeNull();
    expect(alarmCardForTurn({ question: "what does this alarm mean", lines: SCREEN_NEGATIVE })).toBeNull();
  });
});

describe("alarmReadingEntry", () => {
  it("records packs and parsed records, never the card prose", () => {
    const card = alarmCardForTurn({ question: "", lines: SCREEN_FAIL_SAFE })!;
    const e = alarmReadingEntry("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", card);
    expect(e.kind).toBe("alarm_reading");
    expect(e.packIds).toEqual(["fail-safe-output"]);
    expect(e.records[0]).toMatchObject({ kind: "io_diagnostic", count: 2 });
    expect(JSON.stringify(e)).not.toContain("**What it means**");
  });
});
