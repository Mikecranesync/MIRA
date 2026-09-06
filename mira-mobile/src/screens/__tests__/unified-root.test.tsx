// @vitest-environment jsdom
// The unified root: the shell owns the app; the drawer lists notebooks; opening
// an item switches the notebook; the footer carries host controls.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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
  NotebookScreen: (props: { id: string; chromeless?: boolean; unifiedShell?: { projects: unknown[]; navigationFooter?: unknown; onOpenItem: (i: { kind: string; id: string; label: string }) => void } }) => (
    <div data-testid="nb" data-id={props.id} data-chromeless={String(props.chromeless)}>
      {props.unifiedShell ? <button onClick={() => props.unifiedShell?.onOpenItem({ kind: "thread", id: "notebook-nb-b", label: "General notes" })}>open-b</button> : null}
      <div data-testid="footer">{props.unifiedShell?.navigationFooter as never}</div>
    </div>
  ),
}));
vi.mock("../AboutUpdates", () => ({ AboutUpdates: (p: { onBack: () => void }) => <div data-testid="about"><button onClick={p.onBack}>back</button></div> }));

import { UnifiedRoot } from "../UnifiedRoot";

const ME = { id: "u", email: "mike@example.com", name: null, role: "tech", tenantId: "t", capabilities: [] };

afterEach(() => cleanup());

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
});
