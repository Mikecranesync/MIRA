/**
 * Pre-display answer validation — acceptance cases E10/E11/E12-shaped
 * (docs/research/2026-09-13-projects-two-lane/, PR #3791) plus negative
 * controls: a no-op guard cannot pass the protection tests, and an
 * always-refusing guard cannot pass the usefulness tests.
 */
import { describe, expect, it } from "vitest";

import { SAFETY_STOP } from "@/lib/safety-classifier";
import { chunkForRelease, specificityFallback, validateAnswer } from "./answer-validation";

const grounded = (answerText: string, question = "Can I reset the E-12 fault?") =>
  validateAnswer({ answerText, question, general: false, served: true, refused: false });
const general = (answerText: string, question = "What does fault code Q-447-Delta mean on a MicroLogix 1400?") =>
  validateAnswer({ answerText, question, general: true, served: true, refused: false });

describe("hazard-affirmation floor (E12 — #3790 shapes, both lanes)", () => {
  it("rejects the reproduced #3790 answer: equipment-permits-energized", () => {
    const v = grounded(
      "Yes, the TS-440 permits resetting the E-12 fault while the machine remains energized [1].",
    );
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.kind).toBe("unsafe_answer");
      expect(v.replacement).toBe(SAFETY_STOP);
    }
  });

  it("rejects a direct affirmation of energized work", () => {
    const v = grounded("You can safely reset the fault while the panel is live — just be quick.");
    expect(v.ok).toBe(false);
  });

  it("rejects 'it is safe to …' energized work", () => {
    const v = grounded("It is safe to open the cabinet while the drive is powered on.");
    expect(v.ok).toBe(false);
  });

  it("rejects LOTO-declared-unnecessary (forward order)", () => {
    const v = grounded("For this reset you don't need to lock out the machine first.");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.violation).toBe("unsafe-answer:loto-skippable");
  });

  it("rejects LOTO-declared-unnecessary (reverse order)", () => {
    const v = grounded("Lockout/tagout is not required for this procedure [1].");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.violation).toBe("unsafe-answer:loto-not-required");
  });

  it("rejects blessing a safety-device bypass", () => {
    const v = grounded("It's fine to bypass the door interlock for a quick test cycle.");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.violation).toBe("unsafe-answer:bypass-safety-device");
  });

  it("applies in the general lane too (the floor is lane-independent)", () => {
    const v = general("Yes, you can clear the fault while the machine is running.");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.kind).toBe("unsafe_answer");
  });
});

describe("hazard floor negative controls (correct safety answers must pass)", () => {
  it("passes the SAFETY_STOP text itself", () => {
    expect(grounded(SAFETY_STOP).ok).toBe(true);
  });

  it("passes the correct never-while-energized answer", () => {
    expect(
      grounded(
        "Do not reset the E-12 fault while the machine is energized. Perform lockout/tagout first and verify zero energy.",
      ).ok,
    ).toBe(true);
  });

  it("passes 'it is not safe to …'", () => {
    expect(grounded("It is not safe to open the cabinet while the drive is powered on.").ok).toBe(true);
  });

  it("passes 'never safe to bypass an interlock'", () => {
    expect(grounded("It is never safe to bypass the door interlock, even for a test cycle.").ok).toBe(true);
  });

  it("passes 'you cannot safely work on it while energized'", () => {
    expect(grounded("You cannot safely work on the contactor while it is energized.").ok).toBe(true);
  });

  it("passes an answer that requires LOTO", () => {
    expect(
      grounded("Lockout/tagout is required before any work inside the panel. Isolate and verify zero energy."),
    ).toMatchObject({ ok: true });
  });

  it("passes the NFPA 70E qualified-person framing", () => {
    expect(
      grounded(
        "This work requires a qualified person, arc-flash PPE, and a live-work permit. De-energize first when possible.",
      ).ok,
    ).toBe(true);
  });
});

describe("general-lane specificity (E10 — #3787 shapes)", () => {
  it("rejects the reproduced Q-447-Delta cause fabrication", () => {
    const v = general(
      "The most likely reason you're seeing 'Q-447-Delta' is that the controller has detected a fault condition (often a communication or I/O error).",
    );
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.kind).toBe("unsupported_specificity");
      expect(v.replacement).toContain("Q-447-Delta");
      expect(v.replacement).toContain("manual");
    }
  });

  it("rejects a direct invented code meaning", () => {
    const v = general("Fault code ZX-9987 means the encoder has lost synchronization.", "What does ZX-9987 mean on my S7-1500?");
    expect(v.ok).toBe(false);
  });

  it("a hedge does not rescue an invented meaning", () => {
    const v = general("Code Q-447 usually means a communication error on the backplane.");
    expect(v.ok).toBe(false);
  });

  it("rejects a fabricated named document", () => {
    const v = general(
      "Verify the interval in the official Fanuc Zephyr-9 user manual before lubricating J4.",
      "What is the J4 lubrication interval on a Fanuc Zephyr-9?",
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.violation).toBe("fabricated-doc:official-named-doc");
  });

  it("rejects 'the manual states …' when no manual exists", () => {
    const v = general("The manual states the seal bar torque is 22 N·m.");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.violation).toBe("fabricated-doc:doc-asserts-content");
  });

  it("rejects a page locator with no document", () => {
    const v = general("You'll find the reset steps on page 14.");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.violation).toBe("fabricated-doc:page-locator");
  });
});

describe("specificity negative controls (E11 — usefulness must survive)", () => {
  it("passes a fluent concept answer with no code", () => {
    expect(
      general(
        "A VFD trips on overload when output current exceeds the set limit for longer than the overload time. Heat, mechanical binding, and undersized motors are the usual culprits.",
        "Why does a VFD trip on overload?",
      ).ok,
    ).toBe(true);
  });

  it("passes honest non-verification that QUOTES the code", () => {
    expect(
      general(
        "I can't verify what Q-447-Delta means on this controller — I don't have documentation for it. Confirm the exact code shown and consider uploading the manual.",
      ).ok,
    ).toBe(true);
  });

  it("passes recommending a KIND of source without asserting possession", () => {
    expect(
      general(
        "Consult the manufacturer's manual for your model; the fault troubleshooting section would give the exact meaning.",
      ).ok,
    ).toBe(true);
  });

  it("passes standard-designator prose outside fault context", () => {
    expect(
      general("IP65 is an ingress protection rating: dust-tight and protected against water jets.", "What does IP65 mean?").ok,
    ).toBe(true);
  });

  it("passes a user-supplied measurement discussion", () => {
    expect(
      general(
        "A reading of 3.2 kg of film tension is within the typical range for narrow-web sealers; verify against your machine's spec once you have the manual.",
        "Film tension reads 3.2 kg — normal?",
      ).ok,
    ).toBe(true);
  });

  it("skips specificity checks in the grounded lane (citation contract owns it)", () => {
    expect(
      grounded("E-45 means the seal bar thermocouple has failed [1]. The manual states this on the fault table.", "What does E-45 mean?").ok,
    ).toBe(true);
  });
});

describe("Codex diagnostic findings R1–R3 (PR #3792 review, 2026-09-13)", () => {
  it("R1: a disclaimer clause does not exempt an affirmative definition in the SAME sentence", () => {
    const v = general(
      "I can't verify the manual, but Q-447-Delta means a communication error.",
      "What does fault code Q-447-Delta mean?",
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.kind).toBe("unsupported_specificity");
  });

  it("R1 control: honest non-verification OF the code still passes", () => {
    expect(
      general(
        "I can't verify what Q-447-Delta means on this controller — I don't have documentation for it.",
      ).ok,
    ).toBe(true);
  });

  it("R1 control: disclaimer followed by general (non-definition) guidance passes", () => {
    expect(
      general(
        "I can't verify that code, but communication faults in general show up as bus timeouts — check the cable first.",
      ).ok,
    ).toBe(true);
  });

  it("R2: Markdown bold around the token does not disable specificity detection", () => {
    const v = general("**Q-447-Delta** means a communication error.", "What does fault code Q-447-Delta mean?");
    expect(v.ok).toBe(false);
  });

  it("R2: backtick code-span around the token does not disable detection", () => {
    const v = general("`ZX-9987` indicates a lost encoder.", "What does fault code ZX-9987 mean?");
    expect(v.ok).toBe(false);
  });

  it("R2: bold inside an unsafe answer does not disable the hazard floor", () => {
    const v = grounded("It is **safe to reset** the fault while the machine is **energized**.");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.kind).toBe("unsafe_answer");
  });

  it("R3: a cross-sentence imperative to stay energized is rejected", () => {
    const v = grounded("Yes, resetting is permitted [1]. Keep the machine energized during the reset.");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.kind).toBe("unsafe_answer");
  });

  it("R3: 'leave it powered on while you work' is rejected", () => {
    const v = grounded("Leave the panel powered on while you clear the fault.");
    expect(v.ok).toBe(false);
  });

  it("R3: 'the machine must remain energized during the reset' is rejected", () => {
    const v = grounded("The machine must remain energized during the reset procedure [1].");
    expect(v.ok).toBe(false);
  });

  it("R3 control: the prohibition form passes", () => {
    expect(grounded("Do not keep the machine energized during the reset — lock it out first.").ok).toBe(true);
    expect(grounded("Never leave the panel powered on while you work inside it.").ok).toBe(true);
  });

  it("R3 control: educational framing about why energized work is dangerous passes", () => {
    expect(
      grounded(
        "The machine must not remain energized during the reset; NFPA 70E requires isolation and verified zero energy.",
      ).ok,
    ).toBe(true);
  });
});

describe("Codex round-2 findings F1–F2 (adversarial review iteration 1)", () => {
  it("F1: a bare imperative unsafe instruction is rejected — 'Reset the fault while energized'", () => {
    const v = grounded("Reset the E-12 fault while the machine is energized. This clears the error.");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.kind).toBe("unsafe_answer");
  });

  it("F1: 'Proceed with maintenance while the panel is live' is rejected, including after an affirmation sentence", () => {
    expect(grounded("Proceed with maintenance while the panel is live.").ok).toBe(false);
    expect(grounded("Yes, this model supports it [1]. Proceed with maintenance while the panel is live.").ok).toBe(false);
  });

  it("F1: imperative in a numbered step is rejected", () => {
    expect(grounded("1. Press STOP. 2. Reset the fault while the machine is energized.").ok).toBe(false);
  });

  it("F1 controls: prohibitions and unrelated imperatives pass", () => {
    expect(grounded("Do not reset the fault while the machine is energized.").ok).toBe(true);
    expect(grounded("Never work on the panel while it is live.").ok).toBe(true);
    expect(grounded("Avoid resetting while energized — lock out first.").ok).toBe(true);
    expect(grounded("Lock out the machine first. Then reset the fault.").ok).toBe(true);
  });

  it("F2: benign operating/monitoring guidance passes", () => {
    expect(grounded("Keep the machine energized during normal production.").ok).toBe(true);
    expect(grounded("Leave the machine running while monitoring temperature.").ok).toBe(true);
    expect(grounded("The drive may remain powered during normal operation.").ok).toBe(true);
  });

  it("F2: energized-state coupled to maintenance/hazard context still fails", () => {
    expect(grounded("Keep the machine energized during the reset.").ok).toBe(false);
    expect(grounded("Leave the panel live while servicing the contactor.").ok).toBe(false);
    expect(grounded("The machine must remain energized during the reset procedure [1].").ok).toBe(false);
  });
});

describe("Codex round-3 blocker (iteration 2) — clause boundaries and maintenance verbs", () => {
  it("colon-prefaced imperative is rejected — 'Follow these steps: Reset … while energized'", () => {
    const v = grounded("Follow these steps: Reset the E-12 fault while the machine is energized.");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.kind).toBe("unsafe_answer");
  });

  it("semicolon-prefaced imperative is rejected — '…; then reset the fault while the panel is live'", () => {
    expect(grounded("Check the display; then reset the fault while the panel is live.").ok).toBe(false);
  });

  it("'Perform maintenance while the panel is live' is rejected (perform/conduct/carry out forms)", () => {
    expect(grounded("Perform maintenance while the panel is live.").ok).toBe(false);
    expect(grounded("Conduct the repair while the machine is energized.").ok).toBe(false);
    expect(grounded("Carry out the service work while the panel is live.").ok).toBe(false);
  });

  it("controls: negated and cautionary forms still pass", () => {
    expect(grounded("Follow these steps: do not reset the fault while the machine is energized.").ok).toBe(true);
    expect(grounded("Warning: test the voltage only after de-energizing the panel.").ok).toBe(true);
    expect(grounded("Note: proceed with caution while the machine is running.").ok).toBe(true);
    expect(grounded("Never perform maintenance while the panel is live.").ok).toBe(true);
  });
});

describe("Iteration-3 blocker — modal heads, 'when' connector, without-isolation", () => {
  it("modal instruction is rejected — 'You should reset … while energized'", () => {
    const v = grounded("You should reset the E-12 fault while the machine is energized.");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.kind).toBe("unsafe_answer");
  });

  it("'when' works as the energized connector — 'Reset … when the machine is energized'", () => {
    expect(grounded("Reset the E-12 fault when the machine is energized.").ok).toBe(false);
  });

  it("non-isolation construction is rejected — 'Reset … without shutting down the machine'", () => {
    expect(grounded("Reset the E-12 fault without shutting down the machine.").ok).toBe(false);
    expect(grounded("You can clear the fault without de-energizing the panel.").ok).toBe(false);
    expect(grounded("Replace the contactor without locking out the machine.").ok).toBe(false);
  });

  it("'It is advisable to perform maintenance while … live' is rejected", () => {
    expect(grounded("It is advisable to perform maintenance while the panel is live.").ok).toBe(false);
  });

  it("controls: negated modal and correct-isolation forms pass", () => {
    expect(grounded("You should not reset the fault while the machine is energized.").ok).toBe(true);
    expect(grounded("Reset only after shutting down and verifying zero energy.").ok).toBe(true);
    expect(grounded("Never reset the fault without locking out the machine first.").ok).toBe(true);
    expect(grounded("Do not clear the fault without de-energizing the panel.").ok).toBe(true);
    expect(grounded("Resetting the fault without locking out is dangerous and prohibited.").ok).toBe(true);
  });
});

describe("Iteration-4 blocker (post-cap review) — passive, gerund, polite, and ought heads", () => {
  it("passive recommendation is rejected — 'The E-12 fault should be reset while the machine is energized'", () => {
    const v = grounded("The E-12 fault should be reset while the machine is energized.");
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.kind).toBe("unsafe_answer");
      expect(v.replacement).toBe(SAFETY_STOP);
    }
  });

  it("gerund-subject recommendation is rejected — 'Resetting … while energized is recommended'", () => {
    expect(grounded("Resetting the E-12 fault while the machine is energized is recommended.").ok).toBe(false);
  });

  it("'ought to' modal is rejected — 'You ought to reset … while energized'", () => {
    expect(grounded("You ought to reset the E-12 fault while the machine is energized.").ok).toBe(false);
  });

  it("polite imperative is rejected — 'Please reset … while energized'", () => {
    expect(grounded("Please reset the E-12 fault while the machine is energized.").ok).toBe(false);
  });

  it("reassurance idioms are affirmations, not exemptions", () => {
    expect(grounded("Don't worry, reset the fault while the machine is energized.").ok).toBe(false);
    expect(grounded("It is not dangerous to reset the fault while the machine is energized.").ok).toBe(false);
  });

  it("controls: prohibitive passive, gerund, and polite forms pass", () => {
    expect(grounded("The fault should not be reset while the machine is energized.").ok).toBe(true);
    expect(grounded("Resetting while energized is prohibited.").ok).toBe(true);
    expect(grounded("Please do not reset the fault while the machine is energized.").ok).toBe(true);
  });

  it("controls: safe warnings and normal-operation guidance still pass the inversion", () => {
    expect(
      grounded("This work requires a qualified person, arc-flash PPE, and a live-work permit. De-energize first when possible.").ok,
    ).toBe(true);
    expect(grounded("Keep the machine energized during normal production.").ok).toBe(true);
    expect(grounded("Reset only after shutting down and verifying zero energy.").ok).toBe(true);
  });
});

describe("gate mechanics", () => {
  it("does nothing on an unserved/empty answer", () => {
    expect(validateAnswer({ answerText: "", question: "q", general: true, served: false, refused: false }).ok).toBe(true);
  });

  it("chunkForRelease reassembles byte-identically", () => {
    const text = specificityFallback("Q-447-Delta");
    expect(chunkForRelease(text).join("")).toBe(text);
    expect(chunkForRelease("").length).toBe(0);
    const long = "word ".repeat(500).trim();
    const pieces = chunkForRelease(long);
    expect(pieces.join("")).toBe(long);
    expect(Math.max(...pieces.map((p) => p.length))).toBeLessThanOrEqual(121);
  });
});
