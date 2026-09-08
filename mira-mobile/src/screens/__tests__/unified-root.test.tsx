// @vitest-environment jsdom
// The unified root: the shell owns the app; the drawer lists notebooks; opening
// an item switches the notebook; the footer carries host controls.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MutableRefObject } from "react";

const otaProbe = vi.hoisted(() => ({
  value: null as boolean | null,
  activeApiMutation: false,
}));

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, hasActiveApiMutations: () => otaProbe.activeApiMutation };
});

vi.mock("../../api/resources", async () => {
  const actual = await vi.importActual<typeof import("../../api/resources")>("../../api/resources");
  return {
    ...actual,
    listNotebooks: vi.fn(async () => [
      { id: "nb-a", displayName: "Drive A", manufacturer: "Siemens", model: "G120", equipmentType: null, identityStatus: "user_confirmed", nodeId: "n", sourceCount: 2, createdAt: null, asset: { entityId: "asset-1", selectedVia: null, confirmedBy: null, confirmedAt: null } },
      { id: "nb-b", displayName: "General notes", manufacturer: null, model: null, equipmentType: null, identityStatus: "unknown", nodeId: "n", sourceCount: 0, createdAt: null, asset: null },
    ]),
  };
});
vi.mock("../NotebookScreen", () => ({
  NotebookScreen: (props: { id: string; chromeless?: boolean; backRef: MutableRefObject<(() => boolean) | null>; unifiedShell?: { projects: unknown[]; navigationFooter?: unknown; onOpenItem: (i: { kind: string; id: string; label: string }) => void } }) => {
    props.backRef.current = () => false;
    return (
      <div data-testid="nb" data-id={props.id} data-chromeless={String(props.chromeless)}>
        {props.unifiedShell ? <button onClick={() => props.unifiedShell?.onOpenItem({ kind: "thread", id: "notebook-nb-b", label: "General notes" })}>open-b</button> : null}
        <div data-testid="footer">{props.unifiedShell?.navigationFooter as never}</div>
      </div>
    );
  },
}));
// preferencesStore is the real @capacitor/preferences web path; under some
// jsdom builds localStorage is not a full Storage and the root's load() throws,
// which the catch turns into the error state. Mock it like everything else.
vi.mock("../../lib/offline-queue", async () => {
  const actual = await vi.importActual<typeof import("../../lib/offline-queue")>("../../lib/offline-queue");
  const mem = new Map<string, string>();
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
vi.mock("../../unified/UnifiedAboutUpdates", () => ({
  UnifiedAboutUpdates: (p: { onBack: () => void; pendingOfflineWork: () => Promise<boolean> }) => (
    <div data-testid="about">
      <button onClick={p.onBack}>back</button>
      <button onClick={() => void p.pendingOfflineWork().then((value) => { otaProbe.value = value; })}>
        Probe update readiness
      </button>
    </div>
  ),
}));

import { UnifiedRoot } from "../UnifiedRoot";

const ME = { id: "u", email: "mike@example.com", name: null, role: "tech", tenantId: "t", capabilities: [] };

afterEach(() => {
  cleanup();
  otaProbe.value = null;
  otaProbe.activeApiMutation = false;
});

describe("UnifiedRoot", () => {
  it("loads notebooks, opens the first chromeless, switches on item open, and hosts the footer controls", async () => {
    const onSignOut = vi.fn(async () => {});
    const onSwitchClassic = vi.fn();
    render(<UnifiedRoot me={ME} backRef={{ current: null }} onSignOut={onSignOut} onSwitchClassic={onSwitchClassic} />);

    const nb = await waitFor(() => screen.getByTestId("nb"));
    expect(nb.getAttribute("data-id")).toBe("nb-a");
    expect(nb.getAttribute("data-chromeless")).toBe("true");

    fireEvent.click(screen.getByText("open-b"));
    await waitFor(() => expect(screen.getByTestId("nb").getAttribute("data-id")).toBe("nb-b"));

    expect(screen.getByTestId("footer").textContent).toContain("mike@example.com");
    fireEvent.click(screen.getByText("Use classic app"));
    expect(onSwitchClassic).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Sign out"));
    expect(onSignOut).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("About & updates"));
    expect(await waitFor(() => screen.getByTestId("about"))).toBeTruthy();
  });

  it("consumes Android Back on About and returns to the unified conversation", async () => {
    const backRef = { current: null as (() => boolean) | null };
    render(
      <UnifiedRoot
        me={ME}
        backRef={backRef}
        onSignOut={async () => {}}
        onSwitchClassic={() => {}}
      />,
    );

    await waitFor(() => screen.getByTestId("nb"));
    fireEvent.click(screen.getByText("About & updates"));
    await waitFor(() => screen.getByTestId("about"));

    let consumed = false;
    await act(async () => {
      consumed = backRef.current?.() ?? false;
    });
    expect(consumed).toBe(true);
    expect(await waitFor(() => screen.getByTestId("nb"))).toBeTruthy();
  });

  it("reports an in-flight API mutation as busy to the update controller", async () => {
    otaProbe.activeApiMutation = true;
    render(
      <UnifiedRoot
        me={ME}
        backRef={{ current: null }}
        onSignOut={async () => {}}
        onSwitchClassic={() => {}}
      />,
    );

    await waitFor(() => screen.getByTestId("nb"));
    fireEvent.click(screen.getByText("About & updates"));
    fireEvent.click(await screen.findByRole("button", { name: "Probe update readiness" }));

    await waitFor(() => expect(otaProbe.value).toBe(true));
  });
});
