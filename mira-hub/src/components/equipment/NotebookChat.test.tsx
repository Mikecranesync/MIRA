/**
 * Notebook chat leaf renderer — citation rendering contract (PRD §15, §29.1).
 * Hub tests run in node with no jsdom: assert on renderToStaticMarkup output.
 * Run: npx vitest run src/components/equipment/NotebookChat.test.tsx
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Bubble, distinctPassages, hydrateTurns, SUGGESTED_QUESTIONS, type ChatTurn } from "./NotebookChat";
import { persistedTurns } from "./notebook-chat-utils";

const citation = {
  citationId: "1",
  docId: "d1",
  sourceTitle: "PF525 User Manual",
  page: 87,
  fileId: "f1",
  quote: "DC bus undervoltage",
};

describe("Bubble", () => {
  it("renders a clickable numbered citation chip wired to its source", () => {
    const turn: ChatTurn = {
      id: "a1",
      role: "assistant",
      content: "F004 is an undervoltage fault on the DC bus. [1]",
      citations: [citation],
      status: "answered",
    };
    const html = renderToStaticMarkup(<Bubble turn={turn} />);
    // the marker becomes a <button>, not raw text
    expect(html).toContain("<button");
    // the chip's accessible label carries source + page (clickable to open it)
    expect(html).toContain("Open citation 1: PF525 User Manual, page 87");
    // citations collapse to a compact count, not a stack of filename pills
    expect(html).toContain("1 supporting passage");
  });

  it("does NOT fabricate a citation button when the [n] has no matching source", () => {
    const turn: ChatTurn = {
      id: "a2",
      role: "assistant",
      content: "See [2] for details.",
      citations: [citation], // only [1] exists
    };
    const html = renderToStaticMarkup(<Bubble turn={turn} />);
    // [2] renders as plain text, never as a dead citation button
    expect(html).toContain("[2]");
    const buttonCount = (html.match(/<button/g) ?? []).length;
    // one chip row button for [1] + inline [1] = 2; the important part: no [2] button
    expect(html).not.toMatch(/<button[^>]*>\[2\]/);
    expect(buttonCount).toBeGreaterThanOrEqual(1);
  });

  it("shows the honest abstention note on insufficient_evidence", () => {
    const turn: ChatTurn = {
      id: "a3",
      role: "assistant",
      content: "I couldn't find that in the selected sources.",
      status: "insufficient_evidence",
    };
    const html = renderToStaticMarkup(<Bubble turn={turn} />);
    expect(html).toContain("Add a source or rephrase");
  });

  it("renders a user turn without any citation chrome", () => {
    const turn: ChatTurn = { id: "u1", role: "user", content: "What does F004 mean?" };
    const html = renderToStaticMarkup(<Bubble turn={turn} />);
    expect(html).toContain("What does F004 mean?");
    expect(html).not.toContain("<button");
  });

  it("gives the inline citation chip an accessible label (not a bare number)", () => {
    const turn: ChatTurn = {
      id: "a4",
      role: "assistant",
      content: "Set P053 to 2. [1]",
      citations: [citation],
      status: "answered",
    };
    const html = renderToStaticMarkup(<Bubble turn={turn} />);
    expect(html).toContain("Open citation 1: PF525 User Manual, page 87");
  });
});

describe("distinctPassages", () => {
  const c = (id: string, docId: string, page: number) => ({
    citationId: id, docId, sourceTitle: "m.pdf", page, fileId: null, quote: "",
  });
  it("collapses repeated (doc,page) citations to distinct passages", () => {
    const cites = [c("1", "d1", 5), c("2", "d1", 5), c("3", "d1", 9), c("4", "d2", 5)];
    expect(distinctPassages(cites).map((x) => x.citationId)).toEqual(["1", "3", "4"]);
  });
});

describe("hydrateTurns", () => {
  const t = (id: string): ChatTurn => ({ id, role: "user", content: id });

  it("fills an empty conversation with persisted history", () => {
    expect(hydrateTurns([], [t("h1"), t("h2")])).toEqual([t("h1"), t("h2")]);
  });

  it("never clobbers a live conversation (idempotent on repeat loads)", () => {
    const live = [t("live1")];
    expect(hydrateTurns(live, [t("h1")])).toBe(live);
  });

  it("no-ops when there is nothing to hydrate", () => {
    expect(hydrateTurns([], [])).toEqual([]);
  });
});

describe("SUGGESTED_QUESTIONS", () => {
  it("is a small, non-empty first-use set (PRD §7.3 — a minor surface)", () => {
    expect(SUGGESTED_QUESTIONS.length).toBeGreaterThan(0);
    expect(SUGGESTED_QUESTIONS.length).toBeLessThanOrEqual(6);
  });
});

describe("Bubble — follow-up suggestion chips", () => {
  it("renders tappable follow-up chips on an answered turn when a handler is provided", () => {
    const turn: ChatTurn = {
      id: "a9",
      role: "assistant",
      content: "P042 [Decel Time 1] sets the deceleration time. [1]",
      status: "answered",
      followups: ["What's the valid range for P042?", "How do I change P042 from the keypad?"],
    };
    const html = renderToStaticMarkup(<Bubble turn={turn} onFollowup={() => {}} />);
    expect(html).toContain("What&#x27;s the valid range for P042?");
    expect(html).toContain("How do I change P042 from the keypad?");
    expect(html).toContain("Ask follow-up:");
  });

  it("renders NO chips without a handler (older turns) or without followups", () => {
    const turn: ChatTurn = {
      id: "a10",
      role: "assistant",
      content: "P042 sets the deceleration time. [1]",
      status: "answered",
      followups: ["What's the valid range for P042?"],
    };
    expect(renderToStaticMarkup(<Bubble turn={turn} />)).not.toContain("valid range");
    const bare: ChatTurn = { id: "a11", role: "assistant", content: "Hi.", status: "answered" };
    expect(renderToStaticMarkup(<Bubble turn={bare} onFollowup={() => {}} />)).not.toContain("Ask follow-up");
  });
});

describe("Bubble — rehydrated stopped turn (STRM-2 on reload)", () => {
  it("renders the partial with the Stopped caption, no citation chips, no follow-ups", () => {
    const [, a] = persistedTurns([
      {
        id: "t1",
        question: "And F005?",
        answerStatus: "error",
        answerText: "F005 is over [1]",
        evidence: [citation],
        basis: "oem_documentation",
      },
    ]);
    const html = renderToStaticMarkup(<Bubble turn={a as ChatTurn} onFollowup={() => {}} />);
    expect(html).toContain("F005 is over");
    expect(html).toContain('data-testid="stopped-caption"');
    expect(html).not.toContain("Open citation");
    expect(html).not.toContain("supporting passage");
    expect(html).not.toContain("Ask follow-up");
    expect(html).not.toContain("General guidance");
  });
});

// ── Sensor S4 (contract §4.5): basis caption for EVERY basis + Machine Replay card ──
describe("Bubble — evidence basis captions (spec §1.3, contract §4.5)", () => {
  const base: ChatTurn = { id: "b", role: "assistant", content: "Check the DC bus.", status: "answered" };

  it("renders a caption for every basis value; amber is reserved for general_reasoning", () => {
    const expected: Record<string, string> = {
      general_reasoning: "General guidance — not grounded in this machine",
      identified_component: "Grounded in the identified component.",
      oem_documentation: "Grounded in this notebook",
      workspace_evidence: "Grounded in workspace evidence.",
      // S5 D5 cross-lane contract: exact strings, shared with mobile. m9: the
      // two machine bases end with a period like every other caption.
      machine_history: "Grounded in recorded machine history — not live.",
      live_machine_evidence: "Grounded in live machine evidence.",
    };
    for (const [basis, text] of Object.entries(expected)) {
      const html = renderToStaticMarkup(<Bubble turn={{ ...base, basis }} />);
      expect(html, basis).toContain(`data-basis="${basis}"`);
      expect(html.replace(/&#x27;/g, "'"), basis).toContain(text);
      if (basis === "general_reasoning") expect(html, basis).toContain("var(--status-yellow)");
      else expect(html, basis).not.toContain("var(--status-yellow)");
    }
  });

  it("no basis → no caption (a stopped or failed turn makes no basis claim)", () => {
    const html = renderToStaticMarkup(<Bubble turn={{ ...base, basis: null }} />);
    expect(html).not.toContain('data-testid="basis-caption"');
  });

  it("renders a 'Machine Replay · N recorded observations around <time> · <freshness>' card for a machine_evidence entry, never as a citation", () => {
    const turn: ChatTurn = {
      ...base,
      basis: "machine_history",
      machineEvidence: [
        { kind: "machine_evidence", assetId: "a1", anchorAt: "2026-08-27T23:16:31.000Z", pre: 5, post: 2, rowCount: 7, freshness: "stale" },
      ],
    };
    const html = renderToStaticMarkup(<Bubble turn={turn} />);
    expect(html).toContain('data-testid="machine-replay-card"');
    expect(html).toContain('data-freshness="stale"');
    expect(html).toMatch(/Machine Replay · 7 recorded observations around \d{2}:\d{2}:\d{2} · Stale</);
    expect(html).not.toContain("observed change");
    expect(html).toContain("Grounded in recorded machine history — not live.</p>");
    // Not a citation: no supporting-passage chip, no [n] button.
    expect(html).not.toContain("supporting passage");
  });

  it("a live window says so; a simulated one is never called live", () => {
    const mk = (freshness: "live" | "simulated") =>
      renderToStaticMarkup(
        <Bubble
          turn={{
            ...base,
            machineEvidence: [{ kind: "machine_evidence", assetId: "a1", anchorAt: "2026-08-27T23:16:31.000Z", pre: 5, post: 2, rowCount: 1, freshness }],
          }}
        />,
      );
    expect(mk("live")).toContain("1 recorded observation around");
    expect(mk("live")).toContain("· Live</span>");
    expect(mk("simulated")).toContain("· Simulated</span>");
    expect(mk("simulated")).not.toContain("· Live</span>");
  });

  // §2.8: an empty card must say WHICH empty it is. A "0 recorded observations"
  // count reads as a real, quiet window and would hide a missing backend.
  it("an unavailable window and an empty one get their own captions — never a zero count", () => {
    const mk = (entry: Record<string, unknown>) =>
      renderToStaticMarkup(
        <Bubble
          turn={{
            ...base,
            basis: "oem_documentation",
            machineEvidence: [
              { kind: "machine_evidence", assetId: "a1", anchorAt: "2026-08-27T23:16:31.000Z", pre: 5, post: 2, rowCount: 0, freshness: "unknown", ...entry },
            ] as ChatTurn["machineEvidence"],
          }}
        />,
      );
    const unavailable = mk({ reason: "unavailable" });
    expect(unavailable).toContain("Machine Replay · Machine history unavailable");
    expect(unavailable).not.toContain("recorded observation");
    const empty = mk({});
    expect(empty).toContain("Machine Replay · No machine changes recorded in this window");
    expect(empty).not.toContain("recorded observation");
    // Neither claims a machine basis — the turn keeps the basis it earned.
    expect(unavailable).toContain("Grounded in this notebook's sources".replace(/'/g, "&#x27;"));
  });
});

// ── S5 D3 (contract §4.5): the persisted Visual observation card ────────────
describe("Bubble — Visual observation card", () => {
  const base: ChatTurn = { id: "v", role: "assistant", content: "The green LED is the run indicator.", status: "answered" };
  const visual = {
    kind: "visual_observation" as const,
    fileId: "f0000000-0000-4000-8000-000000000001",
    capturedAt: "2026-08-27T23:14:21.000Z",
    provenance: "phone_photo" as const,
  };

  it("renders 'Visual observation · Photo captured · HH:MM:SS' with the thumb from the file door — never markdown, never a citation", () => {
    const html = renderToStaticMarkup(<Bubble turn={{ ...base, basis: "oem_documentation", visualEvidence: [visual] }} />);
    expect(html).toContain('data-testid="visual-observation-card"');
    expect(html).toMatch(/Visual observation · Photo captured · \d{2}:\d{2}:\d{2}/);
    // the thumbnail is the existing byte-serving file door for this fileId
    expect(html).toMatch(new RegExp(`<img[^>]+src="[^"]*/api/namespace/files/${visual.fileId}"`));
    expect(html).toContain(`data-file-id="${visual.fileId}"`);
    // not a citation, and the basis is untouched by the photo
    expect(html).not.toContain("supporting passage");
    expect(html).not.toContain("Open citation");
    expect(html).toContain('data-basis="oem_documentation"');
  });

  it("survives reload: a persisted turn with a visual entry in evidence[] renders the card", () => {
    const [, a] = persistedTurns([
      { id: "t1", question: "what is this LED?", answerStatus: "answered", answerText: "Run indicator. [1]", evidence: [citation, visual], basis: "oem_documentation" },
    ]);
    const html = renderToStaticMarkup(<Bubble turn={a as ChatTurn} />);
    expect(html).toContain('data-testid="visual-observation-card"');
    expect(html).toContain("Open citation 1: PF525 User Manual, page 87");
  });

  it("no visual entry → no card (byte-identical to before)", () => {
    const html = renderToStaticMarkup(<Bubble turn={{ ...base, basis: "oem_documentation" }} />);
    expect(html).not.toContain("visual-observation");
    expect(html).not.toContain("<img");
  });
});
