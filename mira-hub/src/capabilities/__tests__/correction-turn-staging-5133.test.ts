// #5133 — the four staging correction turns since 10-15 (read-only pull,
// 2026-11-02), previous answer and draft exactly as stored. Two were the
// previous answer again; two were genuinely new. The draft is taken before
// the lockout banner is added, which is what the route hook sees.
import { describe, it, expect } from "vitest";
import { CORRECTION_REPEAT_TEXT, correctionRepeatReplacement } from "../correction-turn";

const LOCKOUT_BANNER =
  "⚠️ **Lockout conflict in a step below:** “With the drive isolated, locked out, and the DC bus confirmed dead with a meter, first check the motor and external wiring to the drive output terminals for a g”. That step mixes locked-out work with power on. Inspect, tighten and replace with the equipment locked out; any check that needs power is a separate step, after a qualified person removes the lockout and restores power under your site's energized-work procedure.";

const CASES = [
  {
    at: "10-27 22:07",
    message: "huh? thats not what i asked, i want the AMPS",
    prev: "The max output current for the 200…240V, 2 HP PF4 is 8.0 A, listed as code 8P0 in the “Output Current @ 200…240V Input” table on p.10 [1].",
    draft: "The max output current for the 240V, 2 hp PF4 is 8.0 A, code 8P0 in the “Output Current @ 200…240V Input” table [4].",
    repeat: true,
  },
  {
    at: "10-26 22:23",
    message: "thats not what i asked",
    prev: `${LOCKOUT_BANNER}\n\nWith the drive isolated, locked out, and the DC bus confirmed dead with a meter, first check the motor and external wiring to the drive output terminals for a grounded condition [6]. F013 means a current path to earth ground has been detected at one or more of the drive output terminals [6].`,
    draft:
      "F013 means a current path to earth ground has been detected at one or more of the drive output terminals [2]. If you want the first check, it is the motor and external wiring to the drive output terminals for a grounded condition, with the drive isolated and locked out and the DC bus confirmed dead with a meter [2].",
    repeat: true,
  },
  {
    at: "10-28 06:25",
    message: "ignore that, base rpm default",
    prev: "**P1.02 [Deceleration Time 1] is the decel time parameter, and its default is 10.0 sec [2][3].** P1.06 is [Deceleration Time 2] if you mean the second decel setting [2][3].",
    draft: "**P0.03 [Motor Base RPM] default is 1750 rpm [1].** It should be set to the motor’s rated base RPM from the nameplate [1].",
    repeat: false,
  },
  {
    at: "10-27 06:15",
    message: "ignore that",
    prev: "Do you mean **how to wire a 3-wire RTD**, or **how to configure the 4116 for 3-wire RTD**? The excerpts show the 4116 accepts RTD inputs and list RTD types and cable-resistance limits, but they don’t include the 3-wire terminal diagram or menu step for that setup [2][6].",
    draft:
      "I can’t resolve “ignore that” to a terminal question from the excerpts; tell me which terminal or value you want, and I’ll answer from the manual.",
    repeat: false,
  },
];

describe("staging correction turns (#5133)", () => {
  it.each(CASES)("$at: repeat=$repeat", ({ message, prev, draft, repeat }) => {
    const history = [
      { role: "user" as const, content: "previous question" },
      { role: "assistant" as const, content: prev },
    ];
    expect(correctionRepeatReplacement(message, draft, history)).toBe(repeat ? CORRECTION_REPEAT_TEXT : null);
  });
});
