// @vitest-environment jsdom
// A user-aborted live turn does not arm NotebookScreen's failedSend, so
// canRetry stays false. UnifiedChat must still pass onRetry so the shared
// stopped bubble can re-send the question (#4924).
// Lives under src/unified/__tests__ (unguarded adapter), not src/screens/__tests__.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { HostHooks } from "@factorylm/ui";

const mocks = vi.hoisted(() => ({ hooks: null as HostHooks | null }));
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
  FactoryLMShell: ({ hooks }: { hooks: HostHooks }) => {
    mocks.hooks = hooks;
    return null;
  },
}));

import { UnifiedChat } from "../../screens/UnifiedChat";

afterEach(() => {
  cleanup();
  mocks.hooks = null;
  vi.clearAllMocks();
});

describe("stopped live turn Retry", () => {
  it("re-sends the stopped question when the host did not arm canRetry", async () => {
    const onSend = vi.fn();
    render(
      <UnifiedChat
        turns={[]}
        liveTurns={[{ q: "what does fault F004 mean", a: { answer: "partial", citations: [], status: "stopped" } }]}
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
    await act(async () => {
      mocks.hooks!.onRetry!("live-stopped-a");
    });
    expect(onSend).toHaveBeenCalledWith("what does fault F004 mean");
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
});
