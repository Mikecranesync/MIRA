import { afterEach, describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Attachment } from "@factorylm/interaction";
import { withoutStatusCode } from "../SendError";
import { Harness, fakeAdapter, renderHarness, type HarnessView } from "./harness";

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

  it("marks draft fallback as an explicit retry, preserving host-owned retained evidence", () => {
    const sent: unknown[][] = [];
    const view = show({ onSend: (...args: unknown[]) => { sent.push(args); } });
    view.dispatch({ type: "set-draft", draft: "Does this help?" });
    view.click(view.buttonNamed("Try again")!);
    expect(sent).toEqual([["Does this help?", [], { retry: true }]]);
  });

  // #5746 r6 F7: on a host that checks a send before it goes (the Hub holds a manual question
  // while its manual is prepared), Try again on a draft goes through that same check, with the
  // composer's attachments. The draft and the chips stay until the check accepts the send, so a
  // second Stop keeps them too. Mobile, which has no such check, keeps the plain retry above.
  describe("on a host that checks a send before it goes", () => {
    const PHOTO: Attachment = { id: "a-photo", name: "nameplate.jpg", mediaType: "image/jpeg", kind: "photo", status: "ready" };
    const PAUSED = "Send paused. Your message and attachments are still here.";
    const QUESTION_TEXT = "According to the manual, what is the acceleration parameter?";

    async function checkedHost() {
      const checks: { text: string; attachments: string[] }[] = [];
      const plain: unknown[][] = [];
      const waits: { resolve: () => void; reject: (error: Error) => void }[] = [];
      const hooks = {
        onSend: (...args: unknown[]) => { plain.push(args); },
        onComposerSend: (text: string, attachments: readonly Attachment[]) => {
          checks.push({ text, attachments: attachments.map((a) => a.id) });
          return new Promise<void>((resolve, reject) => { waits.push({ resolve, reject }); });
        },
      };
      const view = renderHarness({ surface: "web", fixture: "grounded-answer", conversationSurface: "assistant", adapter: fakeAdapter({ photo: PHOTO }), hooks });
      views.push(view);
      view.click(view.buttonNamed("Add attachment")!);
      view.click(view.buttonNamed("Photo")!);
      await view.flush();
      view.type(view.container.querySelector("textarea")!, QUESTION_TEXT);
      view.click(view.buttonNamed("Send")!);
      await view.flush();
      return { view, checks, plain, waits };
    }
    const chipCount = (view: HarnessView) => view.container.querySelectorAll('[aria-label="Pending attachments"] li').length;
    const banner = (view: HarnessView) => view.container.querySelector('[aria-label="Send error"]');

    it("sends the draft and its attachment through the check again, never the plain send", async () => {
      const { view, checks, plain, waits } = await checkedHost();
      expect(checks).toEqual([{ text: QUESTION_TEXT, attachments: ["a-photo"] }]);
      waits[0]!.reject(new Error(PAUSED));
      await view.flush();
      // Precondition: Stop kept the draft and the chip, and offers Try again.
      expect(view.outputs().draft).toBe(QUESTION_TEXT);
      expect(chipCount(view)).toBe(1);
      view.click(view.buttonNamed("Try again")!);
      await view.flush();
      expect(checks).toEqual([
        { text: QUESTION_TEXT, attachments: ["a-photo"] },
        { text: QUESTION_TEXT, attachments: ["a-photo"] },
      ]);
      expect(plain).toEqual([]);
      // Waiting again: the error is cleared, and the draft and chip are still held.
      expect(banner(view)).toBeNull();
      expect(view.outputs().draft).toBe(QUESTION_TEXT);
      expect(chipCount(view)).toBe(1);
      waits[1]!.resolve();
      await view.flush();
      expect(view.outputs().draft).toBe("");
      expect(chipCount(view)).toBe(0);
      expect(banner(view)).toBeNull();
    });

    // #5746 r7: Stop and Send shared one DOM button. Stop's click handler re-rendered it, in the
    // same event, into the submit button, and the browser's default click action then submitted
    // the form: a Stop restarted the held send at once, so Try again found the composer busy.
    // Seen in the Hub's production build (a form submit, submitter "Send", right after Stop).
    it("Stop is its own element, so its click can never submit the draft", () => {
      const sends: string[] = [];
      function StopHost() {
        const [busy, setBusy] = useState(true);
        return <Harness surface="web" fixture="grounded-answer" conversationSurface="assistant"
          hooks={{ onSend: (text: string) => { sends.push(text); }, onStop: () => setBusy(false), busy }} />;
      }
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      try {
        act(() => { root.render(<StopHost />); });
        const named = (name: string) => Array.from(container.querySelectorAll("button"))
          .find((button) => (button.getAttribute("aria-label") ?? button.textContent ?? "").trim() === name) ?? null;
        const textarea = container.querySelector("textarea")!;
        act(() => {
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, QUESTION_TEXT);
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
        });
        const stop = named("Stop");
        // Precondition: busy shows Stop, not Send, over a draft that Send could submit.
        expect(stop).not.toBeNull();
        expect(named("Send")).toBeNull();
        act(() => { stop!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        const send = named("Send");
        expect(send).not.toBeNull();
        expect(send!.disabled).toBe(false);
        expect(send).not.toBe(stop);
        expect(stop!.isConnected).toBe(false);
        expect(sends).toEqual([]);
      } finally {
        act(() => root.unmount());
        container.remove();
      }
    });

    it("keeps the draft and the attachment through a second Stop", async () => {
      const { view, checks, plain, waits } = await checkedHost();
      waits[0]!.reject(new Error(PAUSED));
      await view.flush();
      view.click(view.buttonNamed("Try again")!);
      await view.flush();
      waits[1]!.reject(new Error(PAUSED));
      await view.flush();
      expect(checks).toHaveLength(2);
      expect(plain).toEqual([]);
      expect(banner(view)?.textContent ?? "").toContain(PAUSED);
      expect(view.outputs().draft).toBe(QUESTION_TEXT);
      expect(chipCount(view)).toBe(1);
      expect(view.buttonNamed("Try again")).not.toBeNull();
    });
  });

  it("only promises the message is saved when a draft actually holds it", () => {
    const view = show({});
    const detail = view.container.querySelector('[aria-label="Send error"]')?.textContent ?? "";
    expect(detail).not.toContain("saved below");
  });
});

// #5746 r6 audit: the shell hands a technician's question to the host from the composer (through
// the host's check, when it has one) and from Try again on the same draft. Two library paths call
// the host's plain send directly: the runtime's own send, and first-run chips. Neither can be
// reached on a host that checks its sends: the shell renders no control that makes the runtime
// send, and the Hub offers no first-run chips (pinned in mira-hub hub-host-logic.test.ts).
describe("where the shell sends a question", () => {
  const SRC = fileURLToPath(new URL("..", import.meta.url));
  const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : files(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });

  it("renders no assistant-ui control that makes the runtime send a message", () => {
    const found = files(SRC).filter((path) =>
      /ComposerPrimitive|ThreadPrimitive\.Suggestion|ActionBarPrimitive|BranchPickerPrimitive|useThreadRuntime|useComposerRuntime|\.append\(/.test(readFileSync(path, "utf8")));
    // Precondition: the scan reads the shell, including the runtime's own send.
    expect(files(SRC).some((path) => path.endsWith(join("assistant", "runtime.tsx")))).toBe(true);
    expect(found).toEqual([]);
  });

  it("follow-up suggestions fill the draft and send nothing", () => {
    const sent: unknown[][] = [];
    const view = renderHarness({
      surface: "web", fixture: "general-ask", conversationSurface: "assistant",
      hooks: { onSend: (...args: unknown[]) => { sent.push(args); }, onComposerSend: (...args: unknown[]) => { sent.push(args); } },
    });
    views.push(view);
    view.click(view.buttonNamed("How is preload measured?")!);
    expect(view.outputs().draft).toBe("How is preload measured?");
    expect(sent).toEqual([]);
  });
});

describe("a target review is not a failure (#5557)", () => {
  const REVIEW = "This question was asked about VFD1. The question target is now the whole machine. Check the target, then press Send to ask about the whole machine.";

  function review(hooks: Record<string, unknown>): HarnessView {
    const view = renderHarness({ surface: "web", fixture: "grounded-answer", conversationSurface: "assistant", hooks: { targetReview: REVIEW, ...hooks } });
    views.push(view);
    view.dispatch({ type: "set-draft", draft: "what fuse does the selected component take" });
    view.dispatch({ type: "set-send-error", error: REVIEW });
    return view;
  }

  it("offers no Try again even though the kept question sits in the composer", () => {
    // The hub keeps the held question in the draft, which re-armed Try again
    // through the draft fallback; one tap re-asked about the new target.
    const sent: unknown[][] = [];
    const view = review({ onSend: (...args: unknown[]) => { sent.push(args); }, onRetry: () => { sent.push(["retry"]); } });
    expect(view.buttonNamed("Try again")).toBeNull();
    expect(view.buttonNamed("Dismiss")).not.toBeNull();
    expect(sent).toEqual([]);
  });

  it("does not claim MIRA was unreachable", () => {
    const view = review({ onSend: () => {} });
    const banner = view.container.querySelector('[aria-label="Send error"]')?.textContent ?? "";
    expect(banner).toContain("Check the question target");
    expect(banner).not.toContain("Couldn't reach MIRA");
    expect(banner).toContain(REVIEW);
  });

  it("a different error while a review is pending is still a failure with Try again", () => {
    const view = review({ onSend: () => {} });
    view.dispatch({ type: "set-send-error", error: "Couldn't reach MIRA." });
    const banner = view.container.querySelector('[aria-label="Send error"]')?.textContent ?? "";
    expect(banner).toContain("Couldn't reach MIRA");
    expect(view.buttonNamed("Try again")).not.toBeNull();
  });
});

// #5746 (option A): a send the host's backend held for a manual pauses; it is not a failure to
// reach MIRA, and it offers one send without the manual next to Try again.
describe("a send paused for a manual", () => {
  const PAUSED = "This project's manual isn't available, so MIRA didn't answer from it.";
  function paused(hooks: Record<string, unknown>): HarnessView {
    const view = renderHarness({ surface: "web", fixture: "grounded-answer", conversationSurface: "assistant", hooks });
    views.push(view);
    view.dispatch({ type: "set-draft", draft: "What page of the manual shows the acceleration time?" });
    view.dispatch({ type: "set-send-error", error: PAUSED });
    return view;
  }
  const banner = (view: HarnessView) => view.container.querySelector('[aria-label="Send error"]');

  it("says the send is paused and offers Send without the manual once", () => {
    const calls: string[] = [];
    const view = paused({ onSend: () => calls.push("send"), onSendWithoutManual: () => calls.push("without") });
    expect(banner(view)?.textContent ?? "").toContain("Send paused");
    expect(banner(view)?.textContent ?? "").not.toContain("Couldn't reach MIRA");
    expect(banner(view)?.getAttribute("data-kind")).toBe("paused");
    expect(view.buttonNamed("Try again")).not.toBeNull();
    view.click(view.buttonNamed("Send without the manual")!);
    expect(calls).toEqual(["without"]);
    expect(banner(view)).toBeNull();
  });

  it("control: without the host's hook there is no such button, and the failure reads as before", () => {
    const view = paused({ onSend: () => {} });
    expect(view.buttonNamed("Send without the manual")).toBeNull();
    expect(banner(view)?.textContent ?? "").toContain("Couldn't reach MIRA");
  });

  it("a target review never offers it", () => {
    const REVIEW = "Check the target, then press Send.";
    const view = paused({ onSend: () => {}, onSendWithoutManual: () => {}, targetReview: REVIEW });
    view.dispatch({ type: "set-send-error", error: REVIEW });
    expect(view.buttonNamed("Send without the manual")).toBeNull();
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
