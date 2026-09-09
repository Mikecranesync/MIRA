import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { withoutStatusCode } from "../SendError";

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
