import { describe, expect, it } from "vitest";

import { copyPayload } from "./HomeComposer";

/**
 * B-8 (a persistent action row with copy) and E-2 (unsourced claims labelled),
 * at the boundary where they matter most: when the answer leaves the app.
 *
 * The recon found a manual-cited answer and a general-knowledge answer
 * rendering typographically identical. For a product whose claim is GROUNDED
 * answers that is a trust failure, not a styling one — and it does not stop at
 * the screen. A technician copies an answer into a work order, a message, or a
 * handover note; whatever the clipboard carries is what the next person reads,
 * usually without the app in front of them.
 *
 * So two rules are tested here rather than assumed:
 *   1. citations travel WITH the answer — a claim separated from its source
 *      arrives looking like an assertion nobody can check;
 *   2. an ungrounded answer says so in the copied text, not only on screen.
 */

const CITED = {
  answer: "Check the supply voltage first [1].",
  provider: "groq",
  citations: [
    { index: 1, title: "Allen-Bradley PowerFlex 525", url: null, page: 418, verified: true },
    { index: 2, title: "Nameplate — Allen-Bradley PowerFlex 525.txt", url: null, page: null, verified: true },
  ],
};

const UNGROUNDED = {
  answer: "Overcurrent on start usually points at load or acceleration time.",
  provider: "groq",
  citations: [],
};

describe("copyPayload — what actually reaches the clipboard", () => {
  it("carries the answer", () => {
    expect(copyPayload(CITED)).toContain("Check the supply voltage first [1].");
  });

  it("carries every citation, with its page", () => {
    const out = copyPayload(CITED);
    expect(out).toContain("[1] Allen-Bradley PowerFlex 525 · p.418");
    // A citation without a page must not invent one, and must not print "null".
    expect(out).toContain("[2] Nameplate — Allen-Bradley PowerFlex 525.txt");
    expect(out).not.toContain("p.null");
    expect(out).not.toContain("undefined");
  });

  it("never separates a claim from its sources", () => {
    // The rule stated as a property rather than a format: if the answer is
    // present, so is every source backing it.
    const out = copyPayload(CITED);
    expect(out).toContain(CITED.answer);
    for (const c of CITED.citations) {
      expect(out, `citation ${c.index} did not travel with the answer`).toContain(c.title);
    }
  });

  it("labels an ungrounded answer in the COPIED text, not just on screen", () => {
    const out = copyPayload(UNGROUNDED);
    expect(out).toContain(UNGROUNDED.answer);
    expect(out).toContain("General guidance");
    expect(out).toContain("not grounded in a manual on file");
  });

  it("the two kinds of answer are distinguishable once pasted", () => {
    // This is E-2's whole point. If a reader cannot tell a cited answer from a
    // general one after pasting, the label was decoration.
    const cited = copyPayload(CITED);
    const ungrounded = copyPayload(UNGROUNDED);
    expect(cited).not.toContain("General guidance");
    expect(ungrounded).not.toMatch(/^\[\d+\] /m);
    expect(cited).toMatch(/^\[\d+\] /m);
  });
});
