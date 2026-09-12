// @vitest-environment jsdom
/**
 * V6 Root tests — Projects sidebar, chat-first home, no-machine mode.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { V6Root } from "../../screens/V6Root";
import type { Me } from "../../api/resources";
import * as v6Data from "../data";

// Mock Capacitor Preferences
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn().mockResolvedValue({ value: null }),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock offline queue
vi.mock("../../lib/offline-queue", () => ({
  beginSessionLocalPurge: vi.fn(),
  resumeSessionLocalWrites: vi.fn(),
  waitForSessionLocalProducers: vi.fn().mockResolvedValue(undefined),
  waitForWorkOrderQueueProducers: vi.fn().mockResolvedValue(undefined),
  pendingCount: vi.fn().mockResolvedValue(0),
  drainQueueForSessionPurge: vi.fn().mockResolvedValue({ rejected: [] }),
  purgeAllQueues: vi.fn().mockResolvedValue(undefined),
  preferencesStore: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock API client
vi.mock("../../api/client", () => ({
  hasActiveApiMutations: vi.fn().mockReturnValue(false),
  invalidateLocalSessionRequests: vi.fn(),
}));

// Mock transient layer
vi.mock("../../lib/transient-layer", () => ({
  registerTransientLayer: vi.fn(),
}));

// Prevent createShellState crash when activeContext is absent in fixture.
// Provides a complete ShellState (all required fields from packages/factorylm-interaction/src/reducer.ts).
vi.mock("../../../../packages/factorylm-interaction/src/reducer", async () => {
  const actual = await vi.importActual<typeof import("../../../../packages/factorylm-interaction/src/reducer")>(
    "../../../../packages/factorylm-interaction/src/reducer"
  );
  return {
    ...actual,
    createShellState: vi.fn(() => ({
      fixtureId: "test-fixture",
      activeContext: { projectId: null, folderId: null, machineId: null, source: null },
      profile: { kind: "mobile" },
      theme: "light",
      draft: "",
      selectedSource: null,
      selectedProjectId: undefined,
      selectedFolderId: undefined,
      navigationVisible: true,
      inspectorVisible: false,
      attachmentMenuVisible: false,
      mode: "ask",
      offline: { state: "online", pendingChanges: 0 },
      thread: {
        id: "new-chat",
        tenantId: "tenant-123",
        notebookId: "nb-1",
        title: "New chat",
        mode: "ask",
        visibility: "private",
        turns: [],
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      projects: [],
      machines: [],
    })),
  };
});

const mockMe: Me = {
  id: "u1",
  email: "tech@example.com",
  name: "Test Tech",
  tenantId: "tenant-123",
  role: "technician",
  capabilities: ["chat_v2"],
};

describe("V6Root", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock v6 data functions
    vi.spyOn(v6Data, "v6Projects").mockResolvedValue([
      {
        id: "project-1",
        name: "Line 1 Machines",
        children: [
          {
            kind: "machine-link",
            id: "machine-link-1",
            machineId: "machine-1",
            label: "Filler A",
          },
          {
            kind: "thread",
            id: "thread-1",
            label: "Troubleshooting session",
          },
        ],
      },
      {
        id: "project-general",
        name: "General",
        children: [
          {
            kind: "thread",
            id: "thread-general",
            label: "General questions",
          },
        ],
      },
    ]);

    vi.spyOn(v6Data, "v6Machines").mockResolvedValue([
      {
        id: "machine-1",
        canonicalAssetId: "asset-1",
        name: "Filler A",
        unsPath: "enterprise.plant.line1.filler_a",
        status: "normal",
      },
    ]);
  });

  it("renders the canonical FactoryLMShell", async () => {
    const backRef = { current: null };
    const onSignOut = vi.fn();
    const onSwitchLegacy = vi.fn();

    render(
      <V6Root
        me={mockMe}
        backRef={backRef}
        onSignOut={onSignOut}
        onSwitchLegacy={onSwitchLegacy}
      />
    );

    // V6 root wrapper should be present
    expect(screen.getByTestId("v6-root")).toBeTruthy();

    // Shell should render (check for shell class)
    await waitFor(() => {
      const shell = document.querySelector(".fl-shell");
      expect(shell).not.toBeNull();
    });
  });

  it("loads Projects on mount", async () => {
    const backRef = { current: null };
    const onSignOut = vi.fn();
    const onSwitchLegacy = vi.fn();

    render(
      <V6Root
        me={mockMe}
        backRef={backRef}
        onSignOut={onSignOut}
        onSwitchLegacy={onSwitchLegacy}
      />
    );

    // Wait for projects to load
    await waitFor(() => {
      expect(v6Data.v6Projects).toHaveBeenCalled();
      expect(v6Data.v6Machines).toHaveBeenCalled();
    });

    // Projects should be visible in navigation (use getAllByText — shell may render labels in multiple places)
    await waitFor(() => {
      expect(screen.getAllByText("Line 1 Machines").length).toBeGreaterThan(0);
      expect(screen.getAllByText("General").length).toBeGreaterThan(0);
    }, { timeout: 3000 });
  });

  it("supports no-machine mode (can ask without selecting machine)", async () => {
    const backRef = { current: null };
    const onSignOut = vi.fn();
    const onSwitchLegacy = vi.fn();

    render(
      <V6Root
        me={mockMe}
        backRef={backRef}
        onSignOut={onSignOut}
        onSwitchLegacy={onSwitchLegacy}
      />
    );

    // Wait for shell to render
    await waitFor(() => {
      const shell = document.querySelector(".fl-shell");
      expect(shell).not.toBeNull();
    });

    // Composer should be available even without a machine selected
    // (This is the key difference from legacy - no machine required)
    const composer = document.querySelector(".fl-composer");
    expect(composer).not.toBeNull();
  });

  it("shows navigation footer with email and sign out", async () => {
    const backRef = { current: null };
    const onSignOut = vi.fn();
    const onSwitchLegacy = vi.fn();

    render(
      <V6Root
        me={mockMe}
        backRef={backRef}
        onSignOut={onSignOut}
        onSwitchLegacy={onSwitchLegacy}
      />
    );

    await waitFor(() => {
      expect(screen.getAllByText(mockMe.email).length).toBeGreaterThan(0);
      expect(screen.getAllByText("Use legacy app").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Sign out").length).toBeGreaterThan(0);
    });
  });
});
