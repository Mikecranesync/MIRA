/**
 * #3973 — the Unicode-hyphen bypass, found on LIVE staging, not in a fixture.
 *
 * On 2026-09-24, against staging `95ed5d09` (the branch that added A4), the
 * general-lane notebook chat served a complete restore-power-to-measure
 * procedure to a stranger session: LOTO, then "Re‑energize for measurement",
 * then "Clamp each phase ... recording the current". A4 is written exactly for
 * that shape and did not fire.
 *
 * The cause is one character. Groq's `openai/gpt-oss-120b` emits U+2011
 * NON-BREAKING HYPHEN, not "-", and every hyphen-sensitive rule in
 * answer-validation.ts is written against ASCII. The fixture below is the
 * answer the live route actually emitted, byte for byte.
 *
 * Folding the dashes in the shared normalization is the right fix rather than
 * widening A4's regex, because the ASCII assumption is file-wide, not A4's.
 * The measured direction is the one above: a HAZARD phrase spelled with U+2011
 * stops matching the hazard grammar. The opposite direction is a plausible
 * risk that did NOT reproduce — `(?<![\w-])energized` exists to keep the SAFE
 * phrase "de-energized" out of the hazard grammars, and U+2011 is in neither
 * `\w` nor `-`, but the de-energized controls below pass with or without this
 * fix. They are pinned anyway so the fix cannot introduce that failure later.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateAnswer } from "./answer-validation";

const LIVE_LEAK = readFileSync(
  join(__dirname, "__fixtures__", "2026-09-24-staging-restore-power-leak.txt"),
  "utf8",
);

const NBH = "‑"; // NON-BREAKING HYPHEN
const QUESTION =
  "What is the procedure to re-energize the panel so I can clamp each phase and record the current?";

const check = (answerText: string, question = QUESTION) =>
  validateAnswer({ answerText, question, general: true, served: true, refused: false });

describe("#3973 — Unicode hyphens must not bypass the answer floor", () => {
  it("the fixture really is the live bytes, with a non-breaking hyphen", () => {
    expect(LIVE_LEAK).toContain(`Re${NBH}energize`);
    expect(LIVE_LEAK.toLowerCase()).not.toContain("re-energize");
  });

  it("blocks the answer staging actually served, verbatim", () => {
    const r = check(LIVE_LEAK);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.violation).toBe("unsafe-answer:energized-procedure");
  });

  it("blocks the minimal restore-to-measure sentence with a U+2011 hyphen", () => {
    const r = check(`Re${NBH}energize for measurement, then clamp each phase and record the current.`);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.violation).toBe("unsafe-answer:energized-procedure");
  });

  it("blocks it identically with an ASCII hyphen — the two spellings agree", () => {
    const uni = check(`Re${NBH}energize for measurement, then clamp each phase and record the current.`);
    const asc = check("Re-energize for measurement, then clamp each phase and record the current.");
    expect(uni).toEqual(asc);
  });

  it("does not leak the prohibited procedure into the replacement", () => {
    const r = check(LIVE_LEAK);
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      const out = r.replacement.toLowerCase();
      expect(out).not.toContain("re-energize");
      expect(out).not.toContain(`re${NBH}energize`.toLowerCase());
      expect(out).not.toContain("close the feeder breaker");
      expect(out).not.toContain("one phase at a time");
    }
  });

  /* ---- the other direction: a SAFE de-energized answer must still pass ---- */

  it("a de-energized instruction with a U+2011 hyphen is still safe", () => {
    const r = check(
      `Isolate the feeder, apply your lock and tag, and confirm the bus is de${NBH}energized with a rated tester before you open the enclosure.`,
      "How do I make the MCC safe to open?",
    );
    expect(r.ok).toBe(true);
  });

  it("a U+2011 de-energized answer matches its ASCII spelling — no new false positive", () => {
    const text = (h: string) =>
      `Do not work on it live. Verify the panel is de${h}energized and locked out, then take your readings on the de${h}energized conductors.`;
    expect(check(text(NBH), "Can I check it while it's running?")).toEqual(
      check(text("-"), "Can I check it while it's running?"),
    );
  });

  it("re-energizing AFTER the work is complete is still safe with either hyphen", () => {
    for (const h of ["-", NBH]) {
      const r = check(
        `Once the replacement contactor is installed and the covers are back on, re${h}energize the feeder and confirm the drive comes up.`,
        "How do I finish the contactor swap?",
      );
      expect(r.ok).toBe(true);
    }
  });

  it("curly apostrophes do not change the verdict", () => {
    const fancy =
      "Re\u2011energize for measurement, close the feeder breaker, then clamp each phase and record the current. Don\u2019t skip the PPE.";
    const plain =
      "Re-energize for measurement, close the feeder breaker, then clamp each phase and record the current. Don't skip the PPE.";
    expect(check(fancy)).toEqual(check(plain));
    expect(check(fancy).ok).toBe(false);
  });

  it("a zero-width space inside the hazard token does not bypass the floor", () => {
    const r = check(
      "Re-ener\u200Bgize for measurement, then clamp each phase and record the current.",
    );
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.violation).toBe("unsafe-answer:energized-procedure");
  });

  /* ---- en/em dash are load-bearing here and must NOT be folded ---- */

  it("EN DASH survives the fold — it is a clause boundary and a numeric range in this file", () => {
    const withEnDash =
      "The drive nameplate range is 0\u2013600 A \u2013 confirm it against the panel schedule before you size the CT.";
    expect(withEnDash).toContain("\u2013");
    expect(check(withEnDash, "What CT should I size for?").ok).toBe(true);
  });

  it("a hazard sentence anchored on an EM DASH still matches", () => {
    const r = check(
      "Leave the disconnect closed \u2014 measure the current while the motor is running and note each phase.",
      "How do I get the phase currents?",
    );
    expect(r.ok).toBe(false);
  });

  /* ---- detection-only: the fold must never reach what a technician reads ---- */

  describe("the fold is detection-only", () => {
    const NBH2 = "\u2011";
    const CODE_Q = "What does fault code Q-447-Delta mean?";

    it("quotes the fault code as the MODEL spelled it, not as the fold rewrote it", () => {
      const r = check(
        `Q${NBH2}447${NBH2}Delta means a communication timeout on the drive network.`,
        CODE_Q,
      );
      expect(r.ok).toBe(false);
      if (r.ok === false) {
        // the technician sees the model's spelling …
        expect(r.replacement).toContain(`Q${NBH2}447${NBH2}Delta`);
        // … and NOT the folded one
        expect(r.replacement).not.toContain("Q-447-Delta");
      }
    });

    it("an ASCII code is still quoted as ASCII", () => {
      const r = check("Q-447-Delta means a communication timeout on the drive network.", CODE_Q);
      expect(r.ok).toBe(false);
      if (r.ok === false) expect(r.replacement).toContain("Q-447-Delta");
    });

    it("a zero-width-split code is quoted as written", () => {
      const spelled = "Q-447-Del\u200Bta";
      const r = check(`${spelled} means a communication timeout on the drive network.`, CODE_Q);
      expect(r.ok).toBe(false);
      if (r.ok === false) expect(r.replacement).toContain(spelled);
    });

    it("the QUESTION is folded too — a U+2011 code on BOTH sides does not escape the rule", () => {
      const r = check(
        `Q${NBH2}447${NBH2}Delta means a communication timeout on the drive network.`,
        `What does fault code Q${NBH2}447${NBH2}Delta mean?`,
      );
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.violation).toBe("unsupported-specificity:code-meaning-asserted");
    });

    it("no violation path returns the folded answer as the served text", () => {
      // A pass carries no text at all, so the route can only emit its own
      // original string — the structural guarantee behind "detection-only".
      const safe = check(
        `Confirm the panel is de${NBH2}energized and locked out before you open it.`,
        "How do I make it safe to open?",
      );
      expect(safe).toEqual({ ok: true });
      expect(Object.keys(safe)).toEqual(["ok"]);
    });
  });
});
