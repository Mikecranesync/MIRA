// @vitest-environment jsdom
// A user-aborted live turn does not arm NotebookScreen's failedSend, so
// canRetry stays false. UnifiedChat must still pass onRetry so the shared
// stopped bubble can re-send the question — and must hide that stopped
// exchange so the question is not painted twice (#4924).
// Lives under src/unified/__tests__ (unguarded adapter), not src/screens/__tests__.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { HostHooks } from "@factorylm/ui";
import type { ShellState } from "@factorylm/interaction";

const mocks = vi.hoisted(() => ({ hooks: null as HostHooks | null, state: null as ShellState | null }));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false, convertFileSrc: (p: string) => p },
  CapacitorHttp: { request: vi.fn() },
  registerPlugin: () => ({}),
}));
vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: async () => ({ value: null }), set: async () => {}, remove: async () => {} },
}));
vi.mock("../../api/manual-search-status", () => ({ fetchManualSearchStatus: async () => null }));
vi.mock("@factorylm/ui", async (original) => ({
  ...await original<typeof import("@factorylm/ui")>(),
  FactoryLMShell: ({ hooks, state }: { hooks: HostHooks; state: ShellState }) => {
    mocks.hooks = hooks;
    mocks.state = state;
    return null;
  },
}));

import { UnifiedChat } from "../../screens/UnifiedChat";

afterEach(() => {
  cleanup();
  mocks.hooks = null;
  mocks.state = null;
  vi.clearAllMocks();
});

const STOPPED = {
  q: "what does fault F004 mean",
  a: { answer: "partial", citations: [], status: "stopped" as const },
};

describe("stopped live turn Retry", () => {
  it("re-sends the stopped question and hides the superseded exchange", async () => {
    const onSend = vi.fn();
    render(
      <UnifiedChat
        turns={[]}
        liveTurns={[STOPPED]}
        pending={null}
        busy={false}
        canStop={false}
        canRetry={false}
        chatError={null}
        handlers={{ onSend, onStop: () => {}, onCitation: () => {} }}
        meta={{ notebookId: "nb-1", threadId: "notebook-nb-1:thread-legacy", title: "Machine", identityConfirmed: true }}
      />,
    );
    expect(mocks.hooks?.onRetry).toBeTypeOf("function");
    const questionsBefore = mocks.state?.thread.turns.filter((turn) => turn.role === "user").length ?? 0;
    expect(questionsBefore).toBeGreaterThan(0);
    await act(async () => {
      mocks.hooks!.onRetry!("live-stopped-a");
    });
    expect(onSend).toHaveBeenCalledWith("what does fault F004 mean");
    const questionsAfter = mocks.state?.thread.turns.filter((turn) => turn.role === "user").length ?? 0;
    expect(questionsAfter).toBe(0);
    expect(mocks.state?.thread.turns.some((turn) => turn.lifecycle === "stopped")).toBe(false);
  });

  it("does not invent Retry when the last live turn was not stopped", () => {
    render(
      <UnifiedChat
        turns={[]}
        liveTurns={[{ q: "what does fault F004 mean", a: { answer: "full", citations: [], status: "answered" } }]}
        pending={null}
        busy={false}
        canStop={false}
        canRetry={false}
        chatError={null}
        handlers={{ onSend: () => {}, onStop: () => {}, onCitation: () => {} }}
        meta={{ notebookId: "nb-1", threadId: "notebook-nb-1:thread-legacy", title: "Machine", identityConfirmed: true }}
      />,
    );
    expect(mocks.hooks?.onRetry).toBeUndefined();
  });

  it("does not invent Retry after a terminal Safety STOP on the aborted turn", () => {
    render(
      <UnifiedChat
        turns={[]}
        liveTurns={[{
          q: "bypass the interlock",
          a: { answer: "partial", citations: [], status: "stopped", safetyTrigger: "bypass the interlock" },
        }]}
        pending={null}
        busy={false}
        canStop={false}
        canRetry={false}
        chatError={null}
        handlers={{ onSend: () => {}, onStop: () => {}, onCitation: () => {} }}
        meta={{ notebookId: "nb-1", threadId: "notebook-nb-1:thread-legacy", title: "Machine", identityConfirmed: true }}
      />,
    );
    expect(mocks.hooks?.onRetry).toBeUndefined();
  });
});
