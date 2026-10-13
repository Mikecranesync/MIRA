import { describe, it, expect } from "vitest";
import { buildAlarmCard } from "./alarm-card";
import { validateAnswer } from "./answer-validation";
import { stepEnergyContradiction } from "./step-energy";
import { SITE_PROCEDURE_LINE } from "./alarm-packs/loader";
import {
  SCREEN_FAIL_SAFE, SCREEN_FAIL_SAFE_PASSIVATION_FIRST, SCREEN_PASSIVATION_ONLY,
  SCREEN_RTD, SCREEN_NEGATIVE, SCREEN_UNCOVERED_ONLY, SCREEN_HISTORY,
} from "./alarm-screens.fixture";

const HEADINGS = ["**Alarm**", "**What it means**", "**Two hypotheses**", "**Next three checks**", "**What this does not prove**"];

function passesCheckers(text: string) {
  expect(validateAnswer({ answerText: text, question: "what does this alarm mean", general: false, served: true, refused: false, evidenceSufficient: true })).toEqual({ ok: true });
  expect(stepEnergyContradiction(text)).toBeNull();
}

describe("alarm card — fail-safe output screen", () => {
  const card = buildAlarmCard(SCREEN_FAIL_SAFE)!;

  it("builds a card led by the top wire break, not a first-out (times are cut off)", () => {
    expect(card).not.toBeNull();
    expect(card.lead.record.text).toContain("Output channel 1");
    expect(card.firstOut).toBe(false);
    expect(card.packIds).toEqual(["fail-safe-output"]);
  });
  it("keeps the fixed section order and ends with the site-procedure line", () => {
    const idx = HEADINGS.map((h) => card.text.indexOf(h));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(card.text.trimEnd().endsWith(SITE_PROCEDURE_LINE)).toBe(true);
    // Exactly once: a copy anywhere earlier would put the energized-step check's
    // isolation scope in front of the quoted alarm text (spec §7).
    expect(card.text.split(SITE_PROCEDURE_LINE)).toHaveLength(2);
  });
  it("adds the shared-cause and consequence notes", () => {
    expect(card.text).toContain("Several channels came in at the same time on this screen");
    expect(card.text).toContain("This screen doesn't show which passivation belongs to which channel.");
  });
  it("collapses duplicates with a count and lists the other alarms", () => {
    expect(card.text).toContain("(×2)");
    expect(card.text).toContain("Output channel 5");
    expect(card.text).toContain("Output channel 4");
  });
  it("names what it could not read", () => {
    expect(card.text).toContain("This screen cuts off the times, so it can't show which alarm came first — read it from the alarm history.");
    expect(card.text).toContain("The F-I/O start addresses are cut off.");
  });
  it("puts designations only inside quoted alarm lines", () => {
    for (const line of card.text.split("\n")) {
      if (/=y\.CTL/.test(line)) expect(line.startsWith("> ") || line.startsWith("- ")).toBe(true);
    }
  });
  it("passes the answer checker and the energized-step check unmodified", () => passesCheckers(card.text));
});

describe("alarm card — lead selection", () => {
  it("a passivation never leads over a wire break on the same screen", () => {
    const card = buildAlarmCard(SCREEN_FAIL_SAFE_PASSIVATION_FIRST)!;
    expect(card.lead.kind).toBe("io_diagnostic");
  });
  it("a passivation-only screen leads with the passivation and adds no consequence note", () => {
    const card = buildAlarmCard(SCREEN_PASSIVATION_ONLY)!;
    expect(card.lead.kind).toBe("safety_passivation");
    expect(card.text).toContain("A communication fault between the controller and the module.");
    expect(card.text).not.toContain("which passivation belongs to which channel");
    // Passivation happens on inputs too: never claim an output went off (review #4389 r8).
    expect(card.text).not.toContain("output off");
    expect(card.text).toContain("an input channel reads as its safe value");
    passesCheckers(card.text);
  });
  it("first-out: full times on one date lead with the earliest, not the top line", () => {
    const card = buildAlarmCard(SCREEN_RTD)!;
    expect(card.firstOut).toBe(true);
    expect(card.lead.record.text).toContain("LEFT WINDING");
    expect(card.text).not.toContain("cuts off the times");
  });
});

describe("alarm card — a reading in a form the parser does not know", () => {
  const card = buildAlarmCard([
    "No. Time Date Status Text",
    "112 06:02:17 11/05/2027 I Error: Temperature measurement LEFT WINDING too high",
    "=1.HYD+04-TE2 (115 °C, limit is 70 °C)",
  ])!;
  it("never says the screen hides a reading it shows", () => {
    expect(card).not.toBeNull();
    expect(card.text).not.toContain("isn't shown");
  });
  it("says it could not read the reading, under What I could not read", () => {
    const cannot = card.text.slice(card.text.indexOf("**What I could not read**"));
    expect(cannot).toContain("The reading on the alarm line is in a form I can't read — read it from your photo.");
    passesCheckers(card.text);
  });
});

describe("alarm card — RTD screen", () => {
  const card = buildAlarmCard(SCREEN_RTD)!;
  it("says the reading is not on this view when value and limit are both 0", () => {
    expect(card.text).toContain("The reading isn't shown on this screen — read it from the alarm history.");
  });
  it("lists uncovered alarms verbatim under Also on this screen", () => {
    const also = card.text.slice(card.text.indexOf("**Also on this screen**"));
    expect(also).toContain("Warning: Automatic stop");
    expect(also).toContain("Error: E-stop reset required");
  });
  it("co-alarms with stop/reset wording sit before the site-procedure line and pass both checkers", () => {
    expect(card.text.indexOf("E-stop reset")).toBeLessThan(card.text.indexOf(SITE_PROCEDURE_LINE));
    passesCheckers(card.text);
  });
  it("never asserts absence", () => {
    expect(card.text).not.toMatch(/\bnot tripped\b/i);
  });
});

describe("alarm card — when there is no card", () => {
  it("ordinary screen text", () => expect(buildAlarmCard(SCREEN_NEGATIVE)).toBeNull());
  it("only alarms no pack covers", () => expect(buildAlarmCard(SCREEN_UNCOVERED_ONLY)).toBeNull());
  it("no lines", () => expect(buildAlarmCard([])).toBeNull());
});

describe("alarm card — shared-cause rule edges", () => {
  it("different visible times: no shared-cause note", () => {
    const card = buildAlarmCard([
      "40 08:14:31 03/02/2027 I Error: Wire break on Output channel 1", "=y.CTL+07-K4.1-2.",
      "40 08:20:05 03/02/2027 I Error: Wire break on Output channel 5", "=y.CTL+07-K4.1-2.",
    ])!;
    expect(card.text).not.toContain("Several channels came in at the same time");
  });
  it("one channel listed twice is not several channels", () => {
    const card = buildAlarmCard([
      "40 08:14:3… 03/02/2027 I Error: Wire break on Output channel 1", "=y.CTL+07-K4.1-2.",
      "40 08:14:3… 03/02/2027 I Error: Wire break on Output channel 1", "=y.CTL+07-K4.1-2.",
    ])!;
    expect(card.text).not.toContain("Several channels came in at the same time");
  });
});

describe("alarm card — dates", () => {
  it("full times without dates are not ordered (they may span midnight)", () => {
    const card = buildAlarmCard([
      "40 23:59:58 I Error: Wire break on Output channel 1", "=y.CTL+07-K4.1-2.",
      "40 00:00:03 I Error: Wire break on Output channel 5", "=y.CTL+07-K4.1-2.",
    ])!;
    expect(card.firstOut).toBe(false);
    expect(card.text).toContain("I can't order these alarms from this screen — read the order from the alarm history.");
  });
  it("the same clock time on different dates is not the same moment", () => {
    const card = buildAlarmCard([
      "40 08:14:31 03/02/2027 I Error: Wire break on Output channel 1", "=y.CTL+07-K4.1-2.",
      "40 08:14:31 03/03/2027 I Error: Wire break on Output channel 5", "=y.CTL+07-K4.1-2.",
    ])!;
    expect(card.text).not.toContain("Several channels came in at the same time");
  });
  it("control: the same time on the same date still is", () => {
    const card = buildAlarmCard([
      "40 08:14:31 03/02/2027 I Error: Wire break on Output channel 1", "=y.CTL+07-K4.1-2.",
      "40 08:14:31 03/02/2027 I Error: Wire break on Output channel 5", "=y.CTL+07-K4.1-2.",
    ])!;
    expect(card.text).toContain("Several channels came in at the same time on this screen");
  });
});

describe("alarm card — a shown value", () => {
  it("either shows the value or leaves it on the photo; never fails the checker", () => {
    const card = buildAlarmCard([
      "112 06:02:17 11/05/2027 I Error: Temperature measurement LEFT WINDING too high",
      "=1.HYD+04-TE2 value 132.5 °C limit 120 °C",
    ])!;
    expect(card).not.toBeNull();
    passesCheckers(card.text);
    if (card.valuesRedacted) expect(card.text).toContain("values left on your photo");
  });
});

describe("alarm card — date-first history layout screen", () => {
  const card = buildAlarmCard(SCREEN_HISTORY)!;
  // An alarm-history list spans hours, so its earliest line is not a first-out: the card leads
  // with the most recent same-day occurrence (Mike, 2026-10-13).
  it("builds a card led by the most recent same-day occurrence, not the earliest", () => {
    expect(card).not.toBeNull();
    expect(card.firstOut).toBe(false);
    expect(card.lead.record.time?.text).toBe("06:02:19");
    expect(card.lead.record.text).toContain("(88Â°C, limit is 70Â°C)");
  });
  it("the older occurrences stay on the card under Also on this screen", () => {
    const also = card.text.slice(card.text.indexOf("**Also on this screen**"));
    expect(also).toContain("(0°C, limit is 70°C)");
  });
  it("keeps the fixed section order and passes both checkers", () => {
    const idx = HEADINGS.map((h) => card.text.indexOf(h));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    passesCheckers(card.text);
  });
});

describe("alarm card — history-layout reason wording", () => {
  const header = "Event Time Display Path Name Label";
  it("zero_and_zero_limit on a history record gets the diagnostic-view wording, not the alarm-history one", () => {
    const card = buildAlarmCard([
      header,
      "11/05/2027 06:01:40 Line2 525 =k.TBR+05-BT3 temperature measurement LEFT COIL too high (0Â, A°C, limit is 0Â, A°C)",
    ])!;
    expect(card).not.toBeNull();
    const cannot = card.text.slice(card.text.indexOf("**What I could not read**"));
    expect(cannot).toContain(
      "The screen prints 0 against a limit of 0, so this line does not show the real reading — read it from the diagnostic view.",
    );
    expect(card.text).not.toContain("The reading isn't shown on this screen — read it from the alarm history.");
    passesCheckers(card.text);
  });
  it("the existing-layout zero_and_zero_limit wording stays byte-identical", () => {
    const card = buildAlarmCard(SCREEN_RTD)!;
    expect(card.text).toContain("The reading isn't shown on this screen — read it from the alarm history.");
  });
  it("contradicts_alarm gets the safe-side wording", () => {
    const card = buildAlarmCard([
      header,
      "11/05/2027 05:58:02 Line2 525 =k.TBR+05-BT3 temperature measurement LEFT COIL too high (0°C, limit is 70°C)",
    ])!;
    expect(card).not.toBeNull();
    const cannot = card.text.slice(card.text.indexOf("**What I could not read**"));
    expect(cannot).toContain(
      "The value shown is on the safe side of its limit, so it is not the reading that raised this alarm — read the value at the alarm time from the diagnostic view.",
    );
    passesCheckers(card.text);
  });
  it("control: a non-history screen still leads with the earliest full time (first-out)", () => {
    const card = buildAlarmCard(SCREEN_RTD)!;
    expect(card.firstOut).toBe(true);
    expect(card.lead.record.text).toContain("LEFT WINDING");
  });
  it("rounded gets the diagnostic-view wording", () => {
    const card = buildAlarmCard([
      header,
      "11/05/2027 06:01:40 Line2 525 =k.TBR+05-BT3 temperature measurement LEFT COIL too high (70°C, limit is 70°C)",
    ])!;
    expect(card).not.toBeNull();
    const cannot = card.text.slice(card.text.indexOf("**What I could not read**"));
    expect(cannot).toContain(
      "The value shown equals its limit; the screen may be rounding it — read the exact value from the diagnostic view.",
    );
    passesCheckers(card.text);
  });
});
