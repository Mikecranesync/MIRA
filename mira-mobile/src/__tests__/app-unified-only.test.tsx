// @vitest-environment jsdom
// The unified shell is the ONLY authenticated experience. A stored classic/v2
// chat-ui preference from an earlier release must not resurrect the retired
// tab shell — the preference has no readers left in the boot path — and a
// deep link must flow into the unified root, not a retired tab route.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { api, storage, prefStore, rootProbe } = vi.hoisted(() => ({
  storage: {
    get: vi.fn(async () => ({ value: null as string | null })),
  },
  api: {
    getMe: vi.fn(),
  },
  prefStore: {
    mem: new Map<string, string>(),
  },
  rootProbe: {
    lastDeepLink: null as { tag: string | null; raw: string } | null,
  },
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(async () => ({ remove: vi.fn() })),
    minimizeApp: vi.fn(async () => undefined),
  },
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    convertFileSrc: (path: string) => path,
    isNativePlatform: () => true,
  },
  CapacitorHttp: { request: vi.fn() },
  registerPlugin: () => ({}),
}));

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: storage.get,
    set: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  },
}));

vi.mock("../api/resources", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/resources")>();
  return { ...actual, getMe: api.getMe };
});

vi.mock("../lib/offline-queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/offline-queue")>();
  return {
    ...actual,
    preferencesStore: {
      get: async (k: string) => prefStore.mem.get(k) ?? null,
      set: async (k: string, v: string) => {
        prefStore.mem.set(k, v);
      },
      remove: async (k: string) => {
        prefStore.mem.delete(k);
      },
      keys: async () => Array.from(prefStore.mem.keys()),
    },
  };
});

vi.mock("../screens/UnifiedRoot", () => ({
  UnifiedRoot: (props: { deepLink?: { tag: string | null; raw: string } | null }) => {
    rootProbe.lastDeepLink = props.deepLink ?? null;
    return <div data-testid="unified-root-stub" />;
  },
}));

import App, { handleDeepLink } from "../App";

const ME = {
  id: "u",
  email: "mike@example.com",
  name: null,
  role: "tech",
  tenantId: "t",
  capabilities: ["chat_v2"],
};

beforeEach(() => {
  api.getMe.mockReset().mockResolvedValue(ME);
  storage.get.mockReset().mockResolvedValue({ value: null });
  prefStore.mem.clear();
  rootProbe.lastDeepLink = null;
});

afterEach(() => {
  cleanup();
});

describe("App unified-only shell", () => {
  it.each(["legacy", "v2"])(
    "a stored %s chat-ui preference cannot resurrect the classic tab shell",
    async (stored) => {
      prefStore.mem.set("flm.chatui.v1", stored);

      render(<App onBundleReady={async () => undefined} />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByTestId("unified-root-stub")).toBeTruthy();
      expect(document.querySelector(".tabbar")).toBeNull();
      expect(document.querySelector(".tabhost")).toBeNull();
    },
  );

  it("a deep link reaches the unified root instead of a retired tab route", async () => {
    render(<App onBundleReady={async () => undefined} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("unified-root-stub")).toBeTruthy();

    await act(async () => {
      handleDeepLink("https://app.factorylm.com/m/CV-101");
    });

    expect(rootProbe.lastDeepLink).not.toBeNull();
    expect(rootProbe.lastDeepLink?.raw).toBe("https://app.factorylm.com/m/CV-101");
  });
});
