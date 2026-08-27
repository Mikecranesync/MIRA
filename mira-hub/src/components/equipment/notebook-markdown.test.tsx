/**
 * RNDR-1 / RNDR-2 — markdown answer rendering with citation chips inside the
 * markdown tree (GFM table + [n] + list) and code blocks with a copy button.
 * Hub tests run in node with no jsdom: assert on renderToStaticMarkup output.
 * Run: npx vitest run src/components/equipment/notebook-markdown.test.tsx
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnswerMarkdown, CodeBlock, codeText, copyToClipboard, languageOf } from "./notebook-markdown";
import { Bubble, type ChatTurn } from "./NotebookChat";

const c1 = { citationId: "1", docId: "d1", sourceTitle: "PF525 User Manual", page: 87, fileId: "f1", quote: null };
const c2 = { citationId: "2", docId: "d1", sourceTitle: "PF525 User Manual", page: 12, fileId: "f1", quote: null };

const FIXTURE = [
  "## Spec & parts table",
  "",
  "| Part | Spec | Source |",
  "|---|---|---|",
  "| Motor | 3 HP, 460 V [1] | manual |",
  "| Drive | PowerFlex 525 [2] | manual |",
  "",
  "Checks:",
  "- Verify DC bus voltage [1]",
  "- Confirm **P053** = 2",
  "",
  "See [7] for nothing — no such source.",
].join("\n");

describe("AnswerMarkdown (RNDR-1)", () => {
  it("renders a GFM table, list items, and citation chips INSIDE the table and list", () => {
    const html = renderToStaticMarkup(<AnswerMarkdown content={FIXTURE} citations={[c1, c2]} />);
    expect(html).toContain("<table");
    expect(html).toContain("<li");
    expect(html).toContain("<strong>P053</strong>");
    // chips carry the accessible label and live inside a <td> / <li>
    expect(html).toContain("Open citation 1: PF525 User Manual, page 87");
    expect(html).toContain("Open citation 2: PF525 User Manual, page 12");
    expect(html).toMatch(/<td[^>]*>3 HP, 460 V\s*<button[^>]*aria-label="Open citation 1/);
    expect(html).toMatch(/<li[^>]*>Verify DC bus voltage\s*<button/);
    // never a same-window <a href="#mira-cite-…"> — the marker becomes a button
    expect(html).not.toContain('href="#mira-cite-');
  });

  it("does NOT fabricate a chip for an unmatched [n]", () => {
    const html = renderToStaticMarkup(<AnswerMarkdown content={FIXTURE} citations={[c1, c2]} />);
    expect(html).toContain("See [7] for nothing");
    expect(html).not.toMatch(/<button[^>]*>7<\/button>/);
  });

  it("escapes raw HTML (no rehype-raw) and neuters javascript: links", () => {
    const html = renderToStaticMarkup(
      <AnswerMarkdown content={"<img src=x onerror=alert(1)> [click](javascript:alert(1))"} citations={[]} />,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("javascript:");
  });

  it("keeps soft line breaks (multi-step answers keep their lines)", () => {
    const html = renderToStaticMarkup(<AnswerMarkdown content={"Step 1\nStep 2"} citations={[]} />);
    expect(html).toContain("<br");
  });

  it("ordinary links open in a new tab with rel=noopener", () => {
    const html = renderToStaticMarkup(<AnswerMarkdown content="[docs](https://example.com)" citations={[]} />);
    expect(html).toMatch(/<a[^>]*href="https:\/\/example.com"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
  });
});

describe("CodeBlock (RNDR-2)", () => {
  it("renders a language label and a Copy button for a fenced block", () => {
    const html = renderToStaticMarkup(
      <AnswerMarkdown content={"```python\nprint(1)\n```"} citations={[]} />,
    );
    expect(html).toContain('data-testid="code-block"');
    expect(html).toMatch(/data-testid="code-lang"[^>]*>python</);
    expect(html).toContain('aria-label="Copy code"');
    expect(html).toContain("print(1)");
  });

  it("labels a block without a language as generic code", () => {
    const html = renderToStaticMarkup(<CodeBlock><code>x = 1</code></CodeBlock>);
    expect(html).toMatch(/data-testid="code-lang"[^>]*>code</);
  });

  it("helpers: languageOf / codeText", () => {
    expect(languageOf("language-ts")).toBe("ts");
    expect(languageOf(undefined)).toBe("");
    expect(codeText(["a", <span key="1">b</span>, "c"])).toBe("abc");
  });

  describe("copyToClipboard uses navigator.clipboard", () => {
    const original = globalThis.navigator;
    afterEach(() => {
      Object.defineProperty(globalThis, "navigator", { value: original, configurable: true });
    });
    it("writes the text and reports success", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText } }, configurable: true });
      await expect(copyToClipboard("print(1)")).resolves.toBe(true);
      expect(writeText).toHaveBeenCalledWith("print(1)");
    });
    it("fails honestly without a clipboard", async () => {
      Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
      await expect(copyToClipboard("x")).resolves.toBe(false);
    });
  });
});

describe("Bubble through markdown — existing copy is unchanged", () => {
  it("refusal note and general-reasoning caption are byte-identical", () => {
    const refusal: ChatTurn = {
      id: "a1",
      role: "assistant",
      content: "I couldn't find that in the selected sources.",
      status: "insufficient_evidence",
    };
    const html = renderToStaticMarkup(<Bubble turn={refusal} />);
    expect(html).toContain("Not found in the selected sources. Add a source or rephrase.");
    expect(html).toContain("I couldn&#x27;t find that in the selected sources.");

    const general: ChatTurn = { id: "a2", role: "assistant", content: "x", status: "answered", basis: "general_reasoning" };
    expect(renderToStaticMarkup(<Bubble turn={general} />)).toContain(
      "General guidance — not grounded in this machine&#x27;s documents.",
    );
  });

  it("a stopped turn shows the partial text + Stopped caption and no follow-up chips", () => {
    const stopped: ChatTurn = {
      id: "a3",
      role: "assistant",
      content: "The F004 fault is",
      status: "error",
      stopped: true,
      followups: ["should not render"],
    };
    const html = renderToStaticMarkup(<Bubble turn={stopped} onFollowup={() => {}} />);
    expect(html).toContain("The F004 fault is");
    expect(html).toContain('data-testid="stopped-caption"');
    expect(html).not.toContain("followup-chips");
  });

  it("user turns are never parsed as markdown", () => {
    const user: ChatTurn = { id: "u1", role: "user", content: "| not | a table |" };
    const html = renderToStaticMarkup(<Bubble turn={user} />);
    expect(html).not.toContain("<table");
    expect(html).toContain("| not | a table |");
  });
});
