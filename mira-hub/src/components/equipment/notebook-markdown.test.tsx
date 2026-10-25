/**
 * RNDR-1 / RNDR-2 — markdown answer rendering with citation chips inside the
 * markdown tree (GFM table + [n] + list) and code blocks with a copy button.
 * Hub tests run in node with no jsdom: assert on renderToStaticMarkup output.
 * Run: npx vitest run src/components/equipment/notebook-markdown.test.tsx
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AnswerMarkdown,
  CodeBlock,
  citationDisplayNumbers,
  codeText,
  copyToClipboard,
  languageOf,
} from "./notebook-markdown";
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

  // #4667: citationId is a THREAD-WIDE running counter minted by the server,
  // not a per-message ordinal — hub-host.tsx uses it as the real resolution
  // key, so it must never be mutated. But the visible "[n]" must reset per
  // message, in order of first appearance within THAT message's own
  // citations, or a later message with a single source shows e.g. "[3]"
  // instead of "[1]" (the bug as reported).
  it("renders the visible chip number by per-message order of appearance, not the raw thread-wide citationId", () => {
    // A later message in the thread: its only citation happens to have been
    // minted 3rd across the whole conversation.
    const late = { citationId: "3", docId: "d9", sourceTitle: "GS10 Manual", page: 4, fileId: "f9", quote: null };
    const html = renderToStaticMarkup(<AnswerMarkdown content="See [3] for the spec." citations={[late]} />);
    expect(html).toMatch(/<button[^>]*aria-label="Open citation 1:[^>]*>1<\/button>/);
    expect(html).not.toMatch(/<button[^>]*>3<\/button>/);
  });

  it("control: two citations number 1, 2 in the order the server listed them (same convention distinctPassages already uses) regardless of [n] marker order in the text", () => {
    // citationIds "5" and "8" (thread-wide, both arbitrary), citations[] order
    // is (a, b) even though the text happens to mention "[8]" first.
    const a = { citationId: "5", docId: "d1", sourceTitle: "Manual A", page: 1, fileId: "f1", quote: null };
    const b = { citationId: "8", docId: "d2", sourceTitle: "Manual B", page: 2, fileId: "f2", quote: null };
    const html = renderToStaticMarkup(
      <AnswerMarkdown content="First [8], then [5]." citations={[a, b]} />,
    );
    expect(html).toMatch(/First\s*<button[^>]*>2<\/button>/);
    expect(html).toMatch(/then\s*<button[^>]*>1<\/button>/);
  });

  it("control: repeated citations of the same passage within one message share one display number", () => {
    const rep = { citationId: "12", docId: "d1", sourceTitle: "Manual", page: 9, fileId: "f1", quote: null };
    const html = renderToStaticMarkup(
      <AnswerMarkdown content="Check [12] and again [12]." citations={[rep]} />,
    );
    const matches = html.match(/<button[^>]*>1<\/button>/g) ?? [];
    expect(matches.length).toBe(2);
    expect(html).not.toMatch(/<button[^>]*>12<\/button>/);
  });
});

describe("citationDisplayNumbers (#4667)", () => {
  it("maps each citationId to its 1-based order of first appearance", () => {
    const cites = [
      { citationId: "5", docId: "d1", sourceTitle: "A", page: 1, fileId: null, quote: null },
      { citationId: "3", docId: "d2", sourceTitle: "B", page: 2, fileId: null, quote: null },
    ];
    expect(Array.from(citationDisplayNumbers(cites).entries())).toEqual([["5", 1], ["3", 2]]);
  });

  it("gives citations sharing one (docId, page) passage the same number", () => {
    const cites = [
      { citationId: "7", docId: "d1", sourceTitle: "A", page: 1, fileId: null, quote: null },
      { citationId: "9", docId: "d2", sourceTitle: "B", page: 2, fileId: null, quote: null },
      { citationId: "11", docId: "d1", sourceTitle: "A", page: 1, fileId: null, quote: null },
    ];
    const map = citationDisplayNumbers(cites);
    expect(map.get("7")).toBe(1);
    expect(map.get("9")).toBe(2);
    expect(map.get("11")).toBe(1);
  });

  it("control: an empty citation list maps nothing", () => {
    expect(citationDisplayNumbers([]).size).toBe(0);
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
  it("markdown images never become <img> (no network egress from answer/manual text)", () => {
    const html = renderToStaticMarkup(
      <AnswerMarkdown content="![tracker](https://evil.example/track.png) ![y](javascript:alert(1)) ![](https://evil.example/blank)" citations={[]} />,
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<link");
    expect(html).not.toContain("evil.example");
    expect(html).toContain("[image: tracker]");
  });
});
