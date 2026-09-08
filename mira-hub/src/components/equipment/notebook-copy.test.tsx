import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Bubble, turnCopyPayload, type ChatTurn } from "./NotebookChat";

/**
 * B-8 on the notebook chat — the surface with device evidence behind it. A
 * Pixel 9a run on 2026-09-08 produced a grounded answer here with four
 * citations and real page numbers, so this is the answer a technician actually
 * relays.
 *
 * The clipboard is the point, not the button. An answer leaves the app into a
 * work order, a message, or a handover note, and whatever the clipboard carries
 * is what the next person reads — with no product in front of them. So the
 * sources and the basis label must survive the paste, or the honesty stops at
 * exactly the boundary where it matters most.
 */

const CITED: ChatTurn = {
  id: "t1",
  role: "assistant",
  content: "Serial number 49849 is listed on the nameplate [1].",
  status: "answered",
  basis: "oem_documentation",
  citations: [
    { citationId: "1", docId: "d1", sourceTitle: "Nameplate — Allen-Bradley PowerFlex 525.txt", page: 1, fileId: null },
    { citationId: "2", docId: "d1", sourceTitle: "Nameplate — Allen-Bradley PowerFlex 525.txt", page: 1, fileId: null },
    { citationId: "3", docId: "d2", sourceTitle: "Series 3 End Trucks Owners Manual.pdf", page: 7, fileId: null },
  ],
} as ChatTurn;

const UNGROUNDED: ChatTurn = {
  id: "t2",
  role: "assistant",
  content: "Overcurrent on start usually points at load or acceleration time.",
  status: "answered",
  basis: "general_reasoning",
  citations: [],
} as ChatTurn;

describe("turnCopyPayload — what survives the paste", () => {
  it("carries the answer", () => {
    expect(turnCopyPayload(CITED)).toContain("Serial number 49849");
  });

  it("carries the sources, collapsed the way the reader saw them", () => {
    const out = turnCopyPayload(CITED);
    // Two cites of the same doc+page are ONE passage on screen; the paste must
    // agree, or the copy claims more evidence than the answer showed.
    expect(out).toContain("[1] Nameplate — Allen-Bradley PowerFlex 525.txt · p.1");
    expect(out).toContain("[3] Series 3 End Trucks Owners Manual.pdf · p.7");
    expect(out).not.toContain("[2] ");
  });

  it("never separates a claim from its sources", () => {
    const out = turnCopyPayload(CITED);
    expect(out).toContain(CITED.content);
    expect(out, "the source did not travel with the answer").toContain("PowerFlex 525");
  });

  it("carries the basis label, so an ungrounded answer stays ungrounded once pasted", () => {
    const out = turnCopyPayload(UNGROUNDED);
    expect(out).toContain(UNGROUNDED.content);
    expect(out.toLowerCase()).toContain("general guidance");
  });

  it("the two kinds of answer are distinguishable after pasting", () => {
    // E-2's point, carried past the screen. If a reader cannot tell a cited
    // answer from a general one in the paste, the label was decoration.
    expect(turnCopyPayload(CITED).toLowerCase()).not.toContain("general guidance");
    expect(turnCopyPayload(UNGROUNDED)).not.toMatch(/^\[\d+\] /m);
  });

  it("never prints a placeholder for a missing page", () => {
    const noPage = { ...CITED, citations: [{ ...CITED.citations![0], page: null }] } as ChatTurn;
    const out = turnCopyPayload(noPage);
    expect(out).not.toContain("p.null");
    expect(out).not.toContain("undefined");
  });
});

describe("Bubble — the control is actually rendered", () => {
  const html = (t: ChatTurn) => renderToStaticMarkup(<Bubble turn={t} />);

  it("renders a copy control on an answered assistant turn", () => {
    expect(html(CITED)).toContain('data-testid="copy-answer"');
  });

  it("renders it on an ungrounded answer too — that one gets relayed most", () => {
    expect(html(UNGROUNDED)).toContain('data-testid="copy-answer"');
  });

  it("does NOT offer copy on a safety notice", () => {
    // A LOTO/arc-flash stop is an instruction to stop work, not an answer to
    // relay. Giving it an answer's affordances would blur that.
    const safety = { ...CITED, safetyNotice: { kind: "loto" } } as unknown as ChatTurn;
    expect(html(safety)).not.toContain('data-testid="copy-answer"');
  });

  it("does NOT offer copy on an empty turn", () => {
    const empty = { ...CITED, content: "   " } as ChatTurn;
    expect(html(empty)).not.toContain('data-testid="copy-answer"');
  });
});
