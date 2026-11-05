/**
 * Shared Composer Send/Stop cluster (#4924, #4798) and stopped Retry.
 *
 * Run: cd apps/factorylm-ui-lab && bun test ../../packages/factorylm-ui/src/__tests__/composer-send-stop.test.tsx
 */
import { afterEach, describe, expect, it } from "bun:test";
import { act } from "react";
import { STOP_ARM_DELAY_MS } from "../Composer";
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

function composer(view: HarnessView): { form: HTMLFormElement; textarea: HTMLTextAreaElement } {
  const form = view.container.querySelector<HTMLFormElement>('form[aria-label="Composer"]');
  const textarea = form?.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask MIRA"]') ?? null;
  if (!form || !textarea) throw new Error("the universal composer must render a labelled message field");
  return { form, textarea };
}

function enter(target: HTMLTextAreaElement) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
}

function hint(view: HarnessView): HTMLElement | null {
  return view.container.querySelector<HTMLElement>(".fl-composer__hint");
}

describe("#4924 — a second click right after Send does not hit Stop", () => {
  it("ignores Stop for the arming window after a successful Send, then honors it", async () => {
    const calls: string[] = [];
    const hooks = {
      busy: false,
      onSend: (text: string) => {
        calls.push(`send:${text}`);
        hooks.busy = true;
      },
      onStop: () => calls.push("stop"),
    };
    const view = render({ surface: "hub", fixture: "grounded-answer", hooks });
    const { form, textarea } = composer(view);
    view.type(textarea, "what does fault F004 mean");
    view.submit(form);
    view.dispatch({ type: "set-draft", draft: "" });
    expect(view.buttonNamed("Stop")).not.toBeNull();
    expect(view.buttonNamed("Send")).toBeNull();

    view.click(view.buttonNamed("Stop") ?? new Error("Stop is required") as never);
    expect(calls).toEqual(["send:what does fault F004 mean"]);

    await act(async () => {
      await Bun.sleep(STOP_ARM_DELAY_MS + 20);
    });
    view.click(view.buttonNamed("Stop") ?? new Error("Stop is required") as never);
    expect(calls).toEqual(["send:what does fault F004 mean", "stop"]);
  });

  it("honors Stop immediately when the composer mounted already busy (no local Send)", () => {
    const calls: string[] = [];
    const view = render({
      surface: "mobile",
      fixture: "grounded-answer",
      hooks: { busy: true, onStop: () => calls.push("stop") },
    });
    view.click(view.buttonNamed("Stop") ?? new Error("Stop is required") as never);
    expect(calls).toEqual(["stop"]);
  });
});

describe("#4798 — a draft typed while MIRA is answering is not dropped", () => {
  it("keeps the draft and shows a waiting hint while busy", () => {
    const view = render({
      surface: "hub",
      fixture: "grounded-answer",
      hooks: { busy: true, onStop: () => {}, onSend: () => {} },
    });
    const { textarea } = composer(view);
    view.type(textarea, "and what happens on a comm fault");
    expect(view.outputs().draft).toBe("and what happens on a comm fault");
    expect(hint(view)?.textContent).toBe("MIRA is still answering — send when it finishes");
    expect(hint(view)?.getAttribute("role")).toBe("status");
    expect(hint(view)?.dataset.queued).toBeUndefined();
  });

  it("queues Enter-while-busy and sends the kept draft when the answer finishes", async () => {
    const calls: string[] = [];
    const hooks = {
      busy: true,
      onSend: (text: string) => calls.push(`send:${text}`),
      onStop: () => calls.push("stop"),
    };
    const adapter = fakeAdapter({
      photo: { id: "file-queued-photo", name: "fault-screen.jpg", mediaType: "image/jpeg", kind: "photo", status: "ready" },
    });
    const view = render({ surface: "hub", fixture: "grounded-answer", adapter, hooks });
    view.click(view.buttonNamed("Add attachment") ?? new Error("Add attachment is required") as never);
    view.click(view.buttonNamed("Photo") ?? new Error("Photo is required") as never);
    await view.flush();
    const { textarea } = composer(view);
    view.type(textarea, "what does fault F004 mean");
    enter(textarea);
    await view.flush();

    expect(calls).toEqual([]);
    expect(view.outputs().draft).toBe("what does fault F004 mean");
    expect(hint(view)?.textContent).toBe("Will send after this answer");
    expect(hint(view)?.dataset.queued).toBe("true");
    expect(view.container.querySelector('[aria-label="Pending attachments"]')?.textContent).toContain("fault-screen.jpg");

    // Hosts re-render when `busy` falls. Mutating the hook object alone is not
    // a render; flip a reducer field after the host would have set busy false.
    hooks.busy = false;
    view.dispatch({ type: "set-theme", theme: "dark" });
    await view.flush();
    expect(calls).toEqual(["send:what does fault F004 mean"]);
    expect(view.outputs().draft).toBe("");
    expect(hint(view)).toBeNull();
  });

  it("does not show a hint while busy if the box is empty", () => {
    const view = render({
      surface: "mobile",
      fixture: "grounded-answer",
      hooks: { busy: true, onStop: () => {} },
    });
    expect(hint(view)).toBeNull();
    expect(view.buttonNamed("Stop")?.className).toContain("fl-composer__send--stop");
  });
});

describe("stopped answers offer Retry", () => {
  it("renders Retry for a retryable stopped turn and hands it to the host", () => {
    const calls: string[] = [];
    const view = render({
      surface: "web",
      fixture: "error-retry",
      hooks: { onRetry: (turnId: string) => calls.push(turnId) },
      transformFixture: (fixture) => ({
        ...fixture,
        thread: {
          ...fixture.thread,
          turns: fixture.thread.turns.map((turn) => ({
            ...turn,
            id: "turn-stopped-retry",
            lifecycle: "stopped" as const,
            parts: turn.parts.map((part) =>
              part.type === "error"
                ? { ...part, error: { code: "stopped" as const, message: "Stopped before the answer completed.", retryable: true } }
                : part
            ),
          })),
        },
      }),
    });
    const retry = view.buttonNamed("Retry");
    if (!retry) throw new Error("a retryable stopped turn must offer Retry");
    view.click(retry);
    expect(calls).toEqual(["turn-stopped-retry"]);
  });
});
