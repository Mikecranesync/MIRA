/**
 * Notebook chat leaf renderer — citation rendering contract (PRD §15, §29.1).
 * Hub tests run in node with no jsdom: assert on renderToStaticMarkup output.
 * Run: npx vitest run src/components/equipment/NotebookChat.test.tsx
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Bubble, distinctPassages, hydrateTurns, SUGGESTED_QUESTIONS, type ChatTurn } from "./NotebookChat";

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
