/**
 * Notebook chat leaf renderer — citation rendering contract (PRD §15, §29.1).
 * Hub tests run in node with no jsdom: assert on renderToStaticMarkup output.
 * Run: npx vitest run src/components/equipment/NotebookChat.test.tsx
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Bubble, type ChatTurn } from "./NotebookChat";

const citation = {
  citationId: "1",
  docId: "d1",
  sourceTitle: "PF525 User Manual",
  page: 87,
  fileId: "f1",
  quote: "DC bus undervoltage",
};

describe("Bubble", () => {
  it("renders a clickable [1] button wired to its citation", () => {
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
    expect(html).toContain("[1]");
    // hover/tap title carries source + page
    expect(html).toContain("PF525 User Manual · p. 87");
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
});
