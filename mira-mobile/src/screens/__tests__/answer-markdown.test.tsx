// @vitest-environment jsdom
// RNDR-1 / RNDR-2: the answer renders as markdown (GFM table, list, code
// block with language + copy) while `[n]` stays a working citation chip
// INSIDE the rendered structure; links never open a window; status copy
// (refusal / error) renders unchanged.
//
// Run: cd mira-mobile && bunx vitest run src/screens/__tests__/answer-markdown

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AnswerMarkdown } from "../AnswerMarkdown";
import { humanizeAnswerStatus } from "../../lib/chat-copy";
import type { ChatCitation } from "../../lib/sse";

afterEach(cleanup);

const cite = (id: string): ChatCitation => ({
  citationId: id,
  sourceTitle: "GS10 manual",
  page: 42,
  quote: null,
  docId: "d1",
  fileId: "f1",
  originFileId: null,
});

const FIXTURE = `## Overload settings

| Parameter | Value | Units |
|---|---|---|
| P06.01 | 115 | % FLA [1] |
| P06.02 | 60 | s [2] |

- Trip point is **115%** of motor FLA [1].
- Reset requires a power cycle.

See [the manual](https://example.com/gs10.pdf) and [1] for details.

\`\`\`st
IF Overload THEN Stop := TRUE; END_IF;
\`\`\`
`;

describe("AnswerMarkdown", () => {
  it("renders a table, list items, a heading and citation chips inside them", () => {
    const onCitation = vi.fn();
    const { container } = render(
      <AnswerMarkdown text={FIXTURE} citations={[cite("1"), cite("2")]} onCitation={onCitation} />,
    );
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("h2")?.textContent).toBe("Overload settings");
    expect(container.querySelector("strong")?.textContent).toBe("115%");

    // The chip for [1] lives INSIDE a <td> and INSIDE an <li> — no pre-split.
    const chips = screen.getAllByRole("button", { name: "Citation 1" });
    expect(chips.length).toBe(3);
    expect(chips.some((b) => b.closest("td"))).toBe(true);
    expect(chips.some((b) => b.closest("li"))).toBe(true);
    fireEvent.click(chips[0]);
    expect(onCitation).toHaveBeenCalledWith(cite("1"));
    expect(screen.getAllByRole("button", { name: "Citation 2" })[0].closest("td")).not.toBeNull();
  });

  it("an unknown [n] stays literal text and no dead chip is offered", () => {
    render(<AnswerMarkdown text="see [7] here" citations={[cite("1")]} />);
    expect(screen.queryByRole("button", { name: "Citation 7" })).toBeNull();
    expect(screen.getByText("see [7] here")).toBeTruthy();
  });

  it("links render as text + URL, never an <a> (window.open ban)", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { container } = render(<AnswerMarkdown text={FIXTURE} citations={[]} />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("the manual (https://example.com/gs10.pdf)");
    expect(open).not.toHaveBeenCalled();
  });

  it("code block: language label + copy button that writes the code (RNDR-2)", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { container } = render(<AnswerMarkdown text={FIXTURE} citations={[]} />);
    expect(container.querySelector(".code-block-lang")?.textContent).toBe("st");
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("IF Overload THEN Stop := TRUE; END_IF;"));
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Copy code" }).textContent).toBe("Copied"));
  });

  it("raw HTML in the answer is NOT rendered as markup (no passthrough)", () => {
    const { container } = render(
      <AnswerMarkdown text={'<img src=x onerror="alert(1)"> plain'} citations={[]} />,
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("refusal and error copy render byte-identical as plain text", () => {
    for (const status of ["insufficient_evidence", "error", "http 502"]) {
      const copy = humanizeAnswerStatus(status);
      const { container, unmount } = render(<AnswerMarkdown text={copy} citations={[]} />);
      expect(container.querySelector("p")?.textContent).toBe(copy);
      unmount();
    }
  });
});
