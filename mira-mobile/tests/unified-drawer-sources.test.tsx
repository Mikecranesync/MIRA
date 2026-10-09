// @vitest-environment jsdom
// R6 (Pixel acceptance on staging 5da41825a, 2026-10-07): the drawer's
// "Sources (N)" came from the notebook list read once at boot, so a manual
// attached afterwards (auto-acquired for a new project, uploaded from the
// Sources panel, attached in the composer) left it at "Sources (0)" until the
// app was relaunched. The conversation now tells the root when sources may
// have changed, and the root re-reads the counts.
//
// Run: cd mira-mobile && bunx vitest run tests/unified-drawer-sources
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MutableRefObject } from "react";
import type { Notebook } from "../src/api/resources";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
if (!("scrollTo" in Element.prototype)) {
  Object.defineProperty(Element.prototype, "scrollTo", { value: () => {}, writable: true });
}

const prefStore = vi.hoisted(() => ({ mem: new Map<string, string>() }));
const notebookApi = vi.hoisted(() => ({
  listNotebooks: vi.fn(),
  createNotebook: vi.fn(),
}));

vi.mock("../src/api/client", async () => {
  const actual = await vi.importActual<typeof import("../src/api/client")>("../src/api/client");
  return { ...actual, hasActiveApiMutations: () => false };
});
vi.mock("../src/api/resources", async () => {
  const actual = await vi.importActual<typeof import("../src/api/resources")>("../src/api/resources");
  return { ...actual, listNotebooks: notebookApi.listNotebooks, createNotebook: notebookApi.createNotebook };
});
vi.mock("@capacitor/share", () => ({ Share: { share: vi.fn(async () => ({})) } }));
vi.mock("../src/screens/NotebookScreen", () => ({
  NotebookScreen: (props: {
    id: string;
    backRef: MutableRefObject<(() => boolean) | null>;
    unifiedShell?: {
      projects: { name: string; children: { kind: string; label: string }[] }[];
      onSourcesMayHaveChanged?: () => void;
    };
    onExit: () => void;
  }) => {
    props.backRef.current = () => {
      props.onExit();
      return true;
    };
    const projects = props.unifiedShell?.projects ?? [];
    return (
      <div
        data-testid="nb"
        data-id={props.id}
        data-project-names={JSON.stringify(projects.map((p) => p.name))}
        data-sources={JSON.stringify(projects.map((p) => p.children.find((c) => c.kind === "file")?.label ?? ""))}
      >
        <button onClick={() => props.unifiedShell?.onSourcesMayHaveChanged?.()}>sources-may-have-changed</button>
      </div>
    );
  },
}));
vi.mock("../src/lib/offline-queue", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/offline-queue")>("../src/lib/offline-queue");
  return {
    ...actual,
    preferencesStore: {
      get: async (k: string) => prefStore.mem.get(k) ?? null,
      set: async (k: string, v: string) => { prefStore.mem.set(k, v); },
      remove: async (k: string) => { prefStore.mem.delete(k); },
      keys: async () => Array.from(prefStore.mem.keys()),
    },
  };
});

import { UnifiedRoot } from "../src/screens/UnifiedRoot";

const ME = { id: "u", email: "tech@example.com", name: null, role: "tech", tenantId: "t", capabilities: [] };

function notebook(id: string, name: string, sourceCount: number): Notebook {
  return {
    id, displayName: name, manufacturer: null, model: null, equipmentType: null, identityStatus: "unknown",
    nodeId: "n", sourceCount, createdAt: null, asset: null,
    threads: [{ id: `thrd-${id}`, notebookId: id, title: `${name} chat`, createdAt: "", updatedAt: "", turnCount: 1, sharedLegacy: false }],
  };
}

afterEach(() => {
  cleanup();
  prefStore.mem.clear();
  notebookApi.listNotebooks.mockReset();
  notebookApi.createNotebook.mockReset();
});

async function openThread(label: string) {
  await waitFor(() => screen.getByTestId("unified-home"));
  fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
  fireEvent.click(screen.getByRole("button", { name: label }));
  return waitFor(() => screen.getByTestId("nb"));
}

const sources = () => JSON.parse(screen.getByTestId("nb").getAttribute("data-sources") ?? "[]") as string[];
const names = () => JSON.parse(screen.getByTestId("nb").getAttribute("data-project-names") ?? "[]") as string[];
const signal = () => fireEvent.click(screen.getByText("sources-may-have-changed"));

describe("the drawer's Sources (N) follows the server", () => {
  it("shows a source attached after the project opened", async () => {
    notebookApi.listNotebooks.mockResolvedValueOnce([notebook("nb-a", "PF525", 0)]);
    render(<UnifiedRoot me={ME} backRef={{ current: null }} onSignOut={async () => {}} />);
    await openThread("PF525 chat");
    expect(sources()).toEqual(["Sources (0)"]);

    notebookApi.listNotebooks.mockResolvedValueOnce([notebook("nb-a", "PF525", 1)]);
    signal();

    await waitFor(() => expect(sources()).toEqual(["Sources (1)"]));
  });

  // The Pixel case: a project created on the phone auto-acquires its manual
  // after it opens, and the boot-time list never had it at all.
  it("shows the manual a newly created project acquired", async () => {
    notebookApi.listNotebooks.mockResolvedValueOnce([notebook("nb-a", "PF525", 0)]);
    notebookApi.createNotebook.mockResolvedValueOnce(notebook("nb-new", "Line 1 drive", 0));
    render(<UnifiedRoot me={ME} backRef={{ current: null }} onSignOut={async () => {}} />);
    await waitFor(() => screen.getByTestId("unified-home"));
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    fireEvent.click(screen.getAllByRole("button", { name: "New project" })[0]);
    await waitFor(() => screen.getByTestId("unified-create-project"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Line 1 drive" } });
    fireEvent.submit(screen.getByRole("form", { name: "Name the machine" }));
    await waitFor(() => expect(screen.getByTestId("nb").getAttribute("data-id")).toBe("nb-new"));
    expect(sources()).toEqual(["Sources (0)", "Sources (0)"]);

    notebookApi.listNotebooks.mockResolvedValueOnce([notebook("nb-new", "Line 1 drive", 1), notebook("nb-a", "PF525", 0)]);
    signal();

    await waitFor(() => expect(sources()).toEqual(["Sources (1)", "Sources (0)"]));
  });

  it("does not let an older re-read that lands last undo a newer count", async () => {
    notebookApi.listNotebooks.mockResolvedValueOnce([notebook("nb-a", "PF525", 0)]);
    render(<UnifiedRoot me={ME} backRef={{ current: null }} onSignOut={async () => {}} />);
    await openThread("PF525 chat");

    let resolveOlder: (list: Notebook[]) => void = () => {};
    let resolveNewer: (list: Notebook[]) => void = () => {};
    notebookApi.listNotebooks
      .mockReturnValueOnce(new Promise<Notebook[]>((resolve) => { resolveOlder = resolve; }))
      .mockReturnValueOnce(new Promise<Notebook[]>((resolve) => { resolveNewer = resolve; }));
    signal();
    signal();

    await act(async () => { resolveNewer([notebook("nb-a", "PF525", 2)]); });
    await waitFor(() => expect(sources()).toEqual(["Sources (2)"]));
    await act(async () => { resolveOlder([notebook("nb-a", "PF525", 1)]); });

    expect(sources()).toEqual(["Sources (2)"]);
  });

  // Control: the re-read only corrects counts. A project the server list does
  // not have yet stays, and the drawer does not reshuffle under the technician.
  it("keeps the drawer's projects and order, and changes only the counts", async () => {
    notebookApi.listNotebooks.mockResolvedValueOnce([notebook("nb-a", "PF525", 0), notebook("nb-b", "Compressor", 0)]);
    notebookApi.createNotebook.mockResolvedValueOnce(notebook("nb-new", "Line 1 drive", 0));
    render(<UnifiedRoot me={ME} backRef={{ current: null }} onSignOut={async () => {}} />);
    await waitFor(() => screen.getByTestId("unified-home"));
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    fireEvent.click(screen.getAllByRole("button", { name: "New project" })[0]);
    await waitFor(() => screen.getByTestId("unified-create-project"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Line 1 drive" } });
    fireEvent.submit(screen.getByRole("form", { name: "Name the machine" }));
    await waitFor(() => expect(screen.getByTestId("nb").getAttribute("data-id")).toBe("nb-new"));

    notebookApi.listNotebooks.mockResolvedValueOnce([notebook("nb-b", "Compressor", 3), notebook("nb-a", "PF525", 1)]);
    signal();

    await waitFor(() => expect(sources()).toEqual(["Sources (0)", "Sources (1)", "Sources (3)"]));
    expect(names()).toEqual(["Line 1 drive", "PF525", "Compressor"]);
  });

  it("leaves the drawer as it was when the re-read fails", async () => {
    notebookApi.listNotebooks.mockResolvedValueOnce([notebook("nb-a", "PF525", 0)]);
    render(<UnifiedRoot me={ME} backRef={{ current: null }} onSignOut={async () => {}} />);
    await openThread("PF525 chat");

    notebookApi.listNotebooks.mockRejectedValueOnce(new Error("Network request failed"));
    signal();
    await act(async () => { await Promise.resolve(); });

    expect(notebookApi.listNotebooks).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("nb")).toBeTruthy();
    expect(sources()).toEqual(["Sources (0)"]);
  });
});
