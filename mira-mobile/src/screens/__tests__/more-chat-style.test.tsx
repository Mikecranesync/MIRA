// @vitest-environment jsdom
// The Chat style card's toggle must tell the App to re-root immediately
// (onChatUiChange), not only persist the choice for the next launch. Regression
// for canary 1.1.5, where the button flipped its label but the unified root
// only appeared after a force-stop and relaunch.
// Run: cd mira-mobile && npx vitest run src/screens/__tests__/more-chat-style
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mem = new Map<string, string>();
vi.mock("../../lib/offline-queue", async () => {
  const actual = await vi.importActual<typeof import("../../lib/offline-queue")>("../../lib/offline-queue");
  return {
    ...actual,
    preferencesStore: {
      get: async (k: string) => mem.get(k) ?? null,
      set: async (k: string, v: string) => { mem.set(k, v); },
      remove: async (k: string) => { mem.delete(k); },
      keys: async () => Array.from(mem.keys()),
    },
  };
});
vi.mock("../../api/resources", async () => {
  const actual = await vi.importActual<typeof import("../../api/resources")>("../../api/resources");
  return { ...actual, listTeam: vi.fn(async () => []), getUsage: vi.fn(async () => null) };
});

import { MoreTab } from "../More";

const ME = { id: "u1", email: "tech@example.com", name: "Tech", role: "owner", tenantId: "t1", capabilities: [] as string[] };

afterEach(() => {
  cleanup();
  mem.clear();
});

describe("MoreTab chat style", () => {
  it("re-roots the app on the unified beta without the chat_v2 capability, and back", async () => {
    const onChatUiChange = vi.fn();
    render(<MoreTab me={ME} chatV2Available={false} onChatUiChange={onChatUiChange} onSignOut={async () => {}} backRef={{ current: null }} />);

    const toggle = await screen.findByTestId("chat-style-toggle");
    await waitFor(() => expect(toggle.textContent).toContain("Try the unified interface"));
    fireEvent.click(toggle);
    expect(onChatUiChange).toHaveBeenCalledWith("unified");
    await waitFor(() => expect(mem.get("flm.chatui.v1")).toBe("unified"));

    fireEvent.click(screen.getByTestId("chat-style-toggle"));
    expect(onChatUiChange).toHaveBeenLastCalledWith("legacy");
  });

  it("re-roots from the new conversation to the unified beta when chat_v2 is available", async () => {
    const onChatUiChange = vi.fn();
    render(<MoreTab me={ME} chatV2Available={true} onChatUiChange={onChatUiChange} onSignOut={async () => {}} backRef={{ current: null }} />);
    const toggle = await screen.findByTestId("chat-style-toggle");
    await waitFor(() => expect(toggle.textContent).toContain("Try the unified interface"));
    fireEvent.click(toggle);
    expect(onChatUiChange).toHaveBeenCalledWith("unified");
  });
});
