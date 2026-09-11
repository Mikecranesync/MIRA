import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { withoutStatusCode } from "../SendError";
import { renderHarness, type HarnessView } from "./harness";

const views: HarnessView[] = [];
afterEach(() => { views.splice(0).forEach((v) => v.cleanup()); });

function show(hooks: Record<string, unknown>): HarnessView {
  const view = renderHarness({ surface: "web", fixture: "grounded-answer", conversationSurface: "assistant", hooks });
  views.push(view);
  view.dispatch({ type: "set-send-error", error: "Couldn't reach MIRA." });
  return view;
}

const CONVERSATION_CSS = readFileSync(new URL("../conversation.css", import.meta.url), "utf8");

describe("the action row survives a touch screen", () => {
  it("reveals the row where hover does not exist", () => {
    // The row was revealed only on .fl-turn:hover. A phone has no hover, so on
    // the device the P0 this row exists to close stayed open — and no DOM test
    // could see it, because the element renders either way at opacity 0.
    const hoverNone = CONVERSATION_CSS.match(/@media\s*\(\s*hover:\s*none\s*\)\s*\{([\s\S]*?)\}\s*\}/);
    expect(hoverNone, "conversation.css must carry a (hover: none) block").not.toBeNull();
    expect(hoverNone![1]).toMatch(/\.fl-turn__actions\s*\{[^}]*opacity:\s*1/);
  });

  it("still reveals on hover and on keyboard focus where they do exist", () => {
    expect(CONVERSATION_CSS).toMatch(/\.fl-turn:hover\s+\.fl-turn__actions\s*\{[^}]*opacity:\s*1/);
    expect(CONVERSATION_CSS).toMatch(/\.fl-turn__action:focus-visible\s*\{[^}]*opacity:\s*1/);
  });
});

describe("withoutStatusCode", () => {
  it("keeps a technician's own three-digit numbers", () => {
    // The first pass used /\b\d{3}\b/, which silently ate the model number out
    // of the most common question this product answers.
    expect(withoutStatusCode("PowerFlex 525 will not start")).toBe("PowerFlex 525 will not start");
    expect(withoutStatusCode("fault F0004 on drive 400")).toBe("fault F0004 on drive 400");
  });

  it("removes a status code only where the message actually reports one", () => {
    expect(withoutStatusCode("Chat unavailable (412)")).toBe("Chat unavailable");
    expect(withoutStatusCode("HTTP 500 from upstream")).toBe("from upstream");
    expect(withoutStatusCode("status code 404")).toBe("");
  });

  it("leaves an already-plain message untouched", () => {
    expect(withoutStatusCode("Couldn't reach MIRA.")).toBe("Couldn't reach MIRA.");
  });
});

describe("Try again is never a dead button", () => {
  it("offers no Try again when neither a host retry nor a draft exists", () => {
    // On the real host the composer clears the draft at send time, so a
    // draft-only retry is exactly the dead control Stop was designed to avoid.
    const view = show({});
    expect(view.container.querySelector('[aria-label="Send error"]')).not.toBeNull();
    expect(view.buttonNamed("Try again")).toBeNull();
  });

  it("prefers the host's retry, which is the only layer that knows what failed", () => {
    const retried: string[] = [];
    const view = show({ onRetry: (id: string) => { retried.push(id); } });
    const btn = view.buttonNamed("Try again");
    expect(btn).not.toBeNull();
    view.click(btn!);
    expect(retried.length).toBe(1);
  });

  it("only promises the message is saved when a draft actually holds it", () => {
    const view = show({});
    const detail = view.container.querySelector('[aria-label="Send error"]')?.textContent ?? "";
    expect(detail).not.toContain("saved below");
  });
});

describe("assistant glance grammar stays visible on the assistant surface", () => {
  it("keeps user turns visibly bubbled without changing assistant document text", () => {
    expect(CONVERSATION_CSS).toMatch(/\.fl-turn\[data-role="user"\]\s+\.fl-part--text\s*\{[^}]*border:\s*1px solid var\(--fl-workspace-line\)/);
    expect(CONVERSATION_CSS).toMatch(/\.fl-turn\[data-role="user"\]\s+\.fl-part--text\s*\{[^}]*background:\s*var\(--fl-workspace-surface-hi\)/);
    expect(CONVERSATION_CSS).toMatch(/\.fl-turn--aui\[data-role="assistant"\]\s+\.fl-part--text\s*\{[^}]*max-inline-size:\s*75ch/);
  });

  it("reserves bottom space so Jump to latest does not cover the last answer/source row", () => {
    expect(CONVERSATION_CSS).toMatch(/\.fl-thread__viewport\s*\{[^}]*padding:[^;]*calc\(var\(--fl-workspace-space-8\) \+ max\(2\.75rem,\s*44px\)\)/);
  });
});
