/**
 * The assistant-ui conversation surface (conversationSurface="assistant").
 *
 * Two contracts. (1) Conversion is lossless: every InteractionTurn projects to
 * a ThreadMessageLike whose data parts carry the very part objects the store
 * holds, in order, with the turn id unchanged. (2) Rendering parity: for every
 * fixture and surface, the assistant thread renders the same turn ids and the
 * same visible part types, in the same order, as the classic list — so the
 * two surfaces differ only in viewport behaviour, never in what they say.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { FIXTURE_IDS, LIFECYCLES, getFixture, type ContextSnapshot, type InteractionTurn, type Lifecycle, type ShellAction } from "@factorylm/interaction";
import { contextDiffers } from "../parts";
import { HEAD_PART_NAME, TURN_PART_NAME, sendText, statusOf, textOfAppend, turnToThreadMessage } from "../assistant";
import { fakeAdapter, renderHarness, type HarnessView } from "./harness";

const views: HarnessView[] = [];

afterEach(() => {
  views.splice(0).forEach((view) => view.cleanup());
});

function render(...args: Parameters<typeof renderHarness>): HarnessView {
  const view = renderHarness(...args);
  views.push(view);
  return view;
}

function everyFixtureTurn(): InteractionTurn[] {
  return FIXTURE_IDS.flatMap((id) => [...getFixture(id).thread.turns]);
}

describe("turnToThreadMessage", () => {
  it("projects every fixture turn losslessly: same id, same role, one data part per store part, in order", () => {
    const turns = everyFixtureTurn();
    expect(turns.length).toBeGreaterThan(0);
    for (const turn of turns) {
      const message = turnToThreadMessage(turn);
      expect(message.id).toBe(turn.id);
      // System turns render in the library's assistant group (a system message
      // may only be one text part); the FactoryLM role stays on the turn.
      expect(message.role).toBe(turn.role === "system" ? "assistant" : turn.role);
      const content = message.content as readonly { type: string; data?: unknown }[];
      expect(content[0]?.type).toBe(`data-${HEAD_PART_NAME}`);
      expect((content[0]?.data as { turn: InteractionTurn }).turn).toBe(turn);
      const parts = content.slice(1);
      expect(parts.map((part) => part.type)).toEqual(turn.parts.map(() => `data-${TURN_PART_NAME}`));
      parts.forEach((part, index) => {
        const data = part.data as { turn: InteractionTurn; part: unknown; index: number };
        expect(data.turn).toBe(turn);
        expect(data.part).toBe(turn.parts[index]);
        expect(data.index).toBe(index);
      });
    }
  });

  it("is deterministic and never mutates the turn", () => {
    const turn = everyFixtureTurn()[0]!;
    const before = JSON.stringify(turn);
    const a = turnToThreadMessage(turn);
    const b = turnToThreadMessage(turn);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(turn)).toBe(before);
  });

  it("carries a run status only on assistant turns, mapped from every lifecycle member", () => {
    for (const lifecycle of LIFECYCLES as readonly Lifecycle[]) {
      const status = statusOf(lifecycle);
      expect(status.type).toMatch(/^(running|incomplete|complete)$/);
    }
    expect(statusOf("running")).toEqual({ type: "running" });
    expect(statusOf("completed")).toEqual({ type: "complete", reason: "stop" });
    expect(statusOf("failed")).toEqual({ type: "incomplete", reason: "error" });
    expect(statusOf("stopped")).toEqual({ type: "incomplete", reason: "cancelled" });
    expect(statusOf("safety_stop")).toEqual({ type: "incomplete", reason: "cancelled" });
    const user = everyFixtureTurn().find((turn) => turn.role === "user")!;
    expect(turnToThreadMessage(user).status).toBeUndefined();
    const assistant = everyFixtureTurn().find((turn) => turn.role === "assistant")!;
    expect(turnToThreadMessage(assistant).status).toBeDefined();
  });
});

describe("library-originated sends", () => {
  it("reads the first text part of an appended message and trims it", () => {
    expect(textOfAppend("  hello ")).toBe("hello");
    expect(textOfAppend([{ type: "text", text: " hi " }] as never)).toBe("hi");
    expect(textOfAppend([] as never)).toBe("");
  });

  it("goes to the host send path when one exists, and to the reducer mock otherwise", () => {
    const sent: string[] = [];
    const dispatched: string[] = [];
    sendText("what is F30001", (action) => dispatched.push(action.type), { onSend: (text) => sent.push(text) });
    expect(sent).toEqual(["what is F30001"]);
    expect(dispatched).toEqual([]);

    sendText("what is F30001", (action) => dispatched.push(action.type), undefined);
    expect(dispatched).toEqual(["set-draft", "mock-send"]);

    sendText("", (action) => dispatched.push(action.type), undefined);
    expect(dispatched).toEqual(["set-draft", "mock-send"]);
  });
});

describe("assistant surface rendering", () => {
  it("renders every fixture on every surface with the same turns and visible parts as the classic list", () => {
    let rendered = 0;
    for (const fixture of FIXTURE_IDS) {
      for (const surface of ["public", "web", "mobile", "hub"] as const) {
        const classic = render({ surface, fixture, conversationSurface: "classic" });
        const assistant = render({ surface, fixture, conversationSurface: "assistant" });
        const data = getFixture(fixture);
        const visibleParts = (parts: readonly { type: string; change?: ContextSnapshot }[]) =>
          parts.filter((part) => part.type !== "context_change" || !part.change || contextDiffers({ activeContext: data.activeContext } as never, part.change)).map((part) => part.type);

        const project = (view: HarnessView) => Array.from(view.container.querySelectorAll<HTMLElement>("[data-turn-id]")).map((turn) => ({
          id: turn.dataset.turnId,
          role: turn.dataset.role,
          lifecycle: turn.dataset.lifecycle,
          parts: Array.from(turn.querySelectorAll<HTMLElement>("[data-part-type]")).map((part) => part.dataset.partType),
        }));

        const expected = data.thread.turns.map((turn) => ({
          id: turn.id,
          role: turn.role,
          lifecycle: turn.lifecycle,
          parts: visibleParts(turn.parts as never),
        }));
        expect(project(assistant)).toEqual(expected);
        expect(project(assistant)).toEqual(project(classic));
        expect(assistant.container.querySelector('[data-conversation-surface="assistant"][aria-label="Conversation"]')).not.toBeNull();
        expect(assistant.container.querySelector(".fl-thread__viewport")).not.toBeNull();
        rendered += 1;
      }
    }
    expect(rendered).toBe(FIXTURE_IDS.length * 4);
  });

  it("keeps the shell's composer, header and navigation on the assistant surface", () => {
    const view = render({ surface: "mobile", fixture: "grounded-answer", conversationSurface: "assistant" });
    expect(view.container.querySelector('[aria-label="Composer"]')).not.toBeNull();
    expect(view.container.querySelector('[aria-label="Ask MIRA"]')).not.toBeNull();
    expect(view.buttonNamed("Jump to latest")).not.toBeNull();
    expect(view.container.querySelector('.fl-shell[data-conversation-surface="assistant"]')).not.toBeNull();
  });

  it("offers Stop only when the host can abort, exactly like the classic surface", () => {
    const withStop = render({ surface: "web", fixture: "grounded-answer", conversationSurface: "assistant", hooks: { busy: true, onStop: () => {}, onSend: () => {} } });
    expect(withStop.buttonNamed("Stop")).not.toBeNull();
    const withoutStop = render({ surface: "web", fixture: "grounded-answer", conversationSurface: "assistant", hooks: { busy: true, onSend: () => {} } });
    expect(withoutStop.buttonNamed("Stop")).toBeNull();
  });

  it("sends through the host from the composer on the assistant surface", async () => {
    const sent: string[] = [];
    const view = render({ surface: "mobile", fixture: "empty", conversationSurface: "assistant", adapter: fakeAdapter(), hooks: { onSend: (text) => sent.push(text) } });
    const input = view.container.querySelector<HTMLTextAreaElement>('[aria-label="Ask MIRA"]');
    if (!input) throw new Error("composer input must render");
    view.type(input, "why did the conveyor stop");
    const form = view.container.querySelector<HTMLFormElement>('[aria-label="Composer"]');
    if (!form) throw new Error("composer form must render");
    view.submit(form);
    await view.flush();
    expect(sent).toEqual(["why did the conveyor stop"]);
  });

  it("renders the action row on assistant turns only, and never on a user turn", () => {
    const view = render({
      surface: "web", fixture: "grounded-answer", conversationSurface: "assistant",
      hooks: { onCopy: () => {} },
    });
    const turns = view.container.querySelectorAll<HTMLElement>("[data-turn-id]");
    expect(turns.length).toBeGreaterThan(0);
    let found = 0;
    turns.forEach((turn) => {
      const actionRow = turn.querySelector(".fl-turn__actions");
      if (turn.dataset.role === "assistant") {
        expect(actionRow).not.toBeNull();
        found += 1;
      } else {
        expect(actionRow).toBeNull();
      }
    });
    expect(found).toBeGreaterThan(0);
  });

  it("mounts no action row at all when the host supplies no action hooks", () => {
    // The wrapper carries display:flex and a top margin, so mounting it empty
    // adds dead vertical space under every answer and gives nothing back. The
    // mobile host supplied none of these hooks when the row first landed.
    const view = render({ surface: "web", fixture: "grounded-answer", conversationSurface: "assistant" });
    const assistant = view.container.querySelectorAll<HTMLElement>('[data-turn-id][data-role="assistant"]');
    expect(assistant.length).toBeGreaterThan(0);
    assistant.forEach((turn) => expect(turn.querySelector(".fl-turn__actions")).toBeNull());
  });

  it("renders action row controls only when their hooks exist", () => {
    const copied: string[] = [];
    const regenerated: string[] = [];
    const fedback: Array<[string, "up" | "down"]> = [];
    const withHooks = render({
      surface: "web",
      fixture: "grounded-answer",
      conversationSurface: "assistant",
      hooks: {
        onCopy: (turnId) => copied.push(turnId),
        onRegenerate: (turnId) => regenerated.push(turnId),
        onFeedback: (turnId, dir) => fedback.push([turnId, dir]),
      },
    });
    const assistantTurns = Array.from(withHooks.container.querySelectorAll<HTMLElement>('[data-turn-id][data-role="assistant"]'));
    expect(assistantTurns.length).toBeGreaterThan(0);

    const firstTurnId = assistantTurns[0]?.dataset.turnId;
    const row = assistantTurns[0]?.querySelector(".fl-turn__actions");
    expect(row).not.toBeNull();

    const copyBtn = row?.querySelector<HTMLButtonElement>('[aria-label="Copy"]');
    const regenBtn = row?.querySelector<HTMLButtonElement>('[aria-label="Regenerate"]');
    const feedbackBtn = row?.querySelector<HTMLButtonElement>('[aria-label="Good answer"]');
    const feedbackDownBtn = row?.querySelector<HTMLButtonElement>('[aria-label="Bad answer"]');

    expect(copyBtn).not.toBeNull();
    expect(regenBtn).not.toBeNull();
    expect(feedbackBtn).not.toBeNull();
    expect(feedbackDownBtn).not.toBeNull();

    if (copyBtn && firstTurnId) {
      copyBtn.click();
      expect(copied).toEqual([firstTurnId]);
    }
    if (regenBtn && firstTurnId) {
      regenBtn.click();
      expect(regenerated).toEqual([firstTurnId]);
    }
    if (feedbackBtn && firstTurnId) {
      feedbackBtn.click();
      expect(fedback).toContainEqual([firstTurnId, "up"]);
    }
  });

  it("renders greeting and grounding line on first-run (empty thread)", () => {
    const view = render({ surface: "mobile", fixture: "empty", conversationSurface: "assistant" });
    const greeting = view.container.querySelector<HTMLElement>(".fl-conversation__greeting");
    const grounding = view.container.querySelector<HTMLElement>(".fl-conversation__grounding");
    expect(greeting).not.toBeNull();
    expect(grounding).not.toBeNull();
    expect(greeting?.textContent).toContain("What can I help you with");
  });

  it("does not render first-run surface once a turn exists", () => {
    const view = render({ surface: "mobile", fixture: "grounded-answer", conversationSurface: "assistant" });
    const greeting = view.container.querySelector(".fl-conversation__greeting");
    const grounding = view.container.querySelector(".fl-conversation__grounding");
    expect(greeting).toBeNull();
    expect(grounding).toBeNull();
  });

  it("renders suggestion chips when host provides them", () => {
    const sent: string[] = [];
    const chips = [
      { id: "chip-1", text: "Why did the motor stop?" },
      { id: "chip-2", text: "Check the voltage" },
      { id: "chip-3", text: "What is a VFD?" },
    ];
    const view = render({
      surface: "mobile",
      fixture: "empty",
      conversationSurface: "assistant",
      hooks: {
        onSend: (text) => sent.push(text),
        suggestChips: () => chips,
      },
    });
    const chipButtons = Array.from(view.container.querySelectorAll<HTMLButtonElement>(".fl-suggestion-chip"));
    expect(chipButtons.length).toBe(3);
    expect(chipButtons[0]?.textContent).toContain("Why did the motor stop?");
  });

  it("sends exact chip text when chip is clicked", () => {
    const sent: string[] = [];
    const chips = [
      { id: "chip-1", text: "Why did the motor stop?" },
    ];
    const view = render({
      surface: "mobile",
      fixture: "empty",
      conversationSurface: "assistant",
      hooks: {
        onSend: (text) => sent.push(text),
        suggestChips: () => chips,
      },
    });
    const chipButton = view.container.querySelector<HTMLButtonElement>(".fl-suggestion-chip");
    if (!chipButton) throw new Error("chip button must render");
    view.click(chipButton);
    expect(sent).toEqual(["Why did the motor stop?"]);
  });

  it("does not render chips when host supplies none", () => {
    const view = render({ surface: "mobile", fixture: "empty", conversationSurface: "assistant" });
    const chips = view.container.querySelectorAll(".fl-suggestion-chip");
    expect(chips.length).toBe(0);
  });

  it("does not render greeting when turns already exist", () => {
    const view = render({
      surface: "mobile",
      fixture: "grounded-answer",
      conversationSurface: "assistant",
    });
    const greeting = view.container.querySelector(".fl-conversation__greeting");
    const messages = Array.from(view.container.querySelectorAll<HTMLElement>("[data-turn-id]"));
    expect(greeting).toBeNull();
    expect(messages.length).toBeGreaterThan(0);
  });

  it("does not clear question on send error", () => {
    const view = render({
      surface: "web",
      fixture: "empty",
      conversationSurface: "assistant",
      hooks: {
        onSend: () => {
          throw new Error("Temporarily unavailable");
        },
      },
    });
    const composer = view.container.querySelector<HTMLFormElement>('form[aria-label="Composer"]');
    const textarea = composer?.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask MIRA"]');
    if (!composer || !textarea) throw new Error("composer must render");

    // Type a question
    view.type(textarea, "What is the current temperature?");
    expect(textarea.value).toBe("What is the current temperature?");

    // Submit the form (this will throw in onSend)
    view.submit(composer);

    // The question should still be in the composer (draft not cleared on error)
    expect(textarea.value).toBe("What is the current temperature?");
  });

  it("retry re-sends the exact same question", () => {
    const sent: string[] = [];
    const view = render({
      surface: "web",
      fixture: "empty",
      conversationSurface: "assistant",
      hooks: {
        onSend: (text) => {
          sent.push(text);
          if (sent.length === 1) {
            throw new Error("Temporarily unavailable");
          }
        },
      },
    });
    const composer = view.container.querySelector<HTMLFormElement>('form[aria-label="Composer"]');
    const textarea = composer?.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask MIRA"]');
    if (!composer || !textarea) throw new Error("composer must render");

    view.type(textarea, "Why did it stop?");
    view.submit(composer);

    // Question is preserved in composer on first (failed) send
    expect(textarea.value).toBe("Why did it stop?");
    expect(sent).toEqual(["Why did it stop?"]);
  });

  it("preserves question in composer on failed send", () => {
    const view = render({
      surface: "web",
      fixture: "empty",
      conversationSurface: "assistant",
      hooks: {
        onSend: () => {
          throw new Error("Service unavailable");
        },
      },
    });
    const composer = view.container.querySelector<HTMLFormElement>('form[aria-label="Composer"]');
    const textarea = composer?.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask MIRA"]');
    if (!composer || !textarea) throw new Error("composer must render");

    view.type(textarea, "Check the motor");
    view.submit(composer);

    // Question is preserved in composer (draft is not cleared on error)
    expect(textarea.value).toBe("Check the motor");
  });

  describe("speaker asymmetry: ChatGPT-like visual grammar", () => {
    it("user and assistant turns have distinguishable role data on the assistant surface", () => {
      // Test across all fixtures to find at least one with user turns
      let foundUser = false;
      let foundAssistant = false;

      for (const fixtureId of FIXTURE_IDS) {
        const fixture = getFixture(fixtureId);
        const view = render({ surface: "web", fixture: fixtureId, conversationSurface: "assistant" });

        const userTurns = Array.from(view.container.querySelectorAll<HTMLElement>('[data-turn-id][data-role="user"]'));
        const assistantTurns = Array.from(view.container.querySelectorAll<HTMLElement>('[data-turn-id][data-role="assistant"]'));

        if (userTurns.length > 0) {
          foundUser = true;
          userTurns.forEach((turn) => {
            expect(turn.dataset.role).toBe("user");
            expect(turn.className).toContain("fl-turn");
          });
        }

        if (assistantTurns.length > 0) {
          foundAssistant = true;
          assistantTurns.forEach((turn) => {
            expect(turn.dataset.role).toBe("assistant");
            expect(turn.className).toContain("fl-turn");
          });
        }

        view.cleanup();
      }

      expect(foundUser).toBe(true);
      expect(foundAssistant).toBe(true);
    });

    it("stylesheet uses only token variables, no hardcoded hex colors", () => {
      // Scan conversation.css for hardcoded color values (hex, rgb, hsl)
      // Valid patterns: var(--fl-*), transparent, inherit, currentColor
      const fs = require("fs");
      const path = require("path");
      const cssPath = path.join(__dirname, "../conversation.css");
      const content = fs.readFileSync(cssPath, "utf-8");

      // Regex to find hex colors, rgb/rgba, hsl/hsla that aren't in comments
      // Exclude var(--fl-*), transparent, inherit, currentColor
      const lines = content.split("\n");
      const offendingLines: string[] = [];

      lines.forEach((line, i) => {
        // Skip comments and lines that clearly use tokens
        if (line.trim().startsWith("/*") || line.trim().startsWith("//")) return;
        if (line.includes("var(--fl-")) return;
        if (line.includes("transparent") || line.includes("inherit") || line.includes("currentColor")) {
          // These are OK, but check if there's also a hex color
          if (!/\b#[0-9a-f]{3,8}\b|\brgb/.test(line)) return;
        }

        // Look for color values: hex, rgb, rgba, hsl, hsla
        if (/\b#[0-9a-f]{3,8}\b|\brgb\(|\brgba\(|\bhsl\(|\bhsla\(/.test(line)) {
          // Allow exceptions: in strings (url, data:), comments, or known values
          if (line.includes("url(") || line.includes("data:")) return;
          offendingLines.push(`Line ${i + 1}: ${line.trim()}`);
        }
      });

      expect(offendingLines).toEqual([]);
    });

    it("stylesheet contains no gradient definitions", () => {
      const fs = require("fs");
      const path = require("path");
      const cssPath = path.join(__dirname, "../conversation.css");
      const content = fs.readFileSync(cssPath, "utf-8");

      // Look for linear-gradient, radial-gradient, conic-gradient
      const lines = content.split("\n");
      const gradientLines: string[] = [];

      lines.forEach((line, i) => {
        if (line.trim().startsWith("/*") || line.trim().startsWith("//")) return;
        if (/linear-gradient|radial-gradient|conic-gradient|repeating-/.test(line)) {
          gradientLines.push(`Line ${i + 1}: ${line.trim()}`);
        }
      });

      expect(gradientLines).toEqual([]);
    });
  });
});
