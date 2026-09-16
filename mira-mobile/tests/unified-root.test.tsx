// @vitest-environment jsdom
// The unified root: the shell owns the app; the drawer lists notebooks; opening
// an item switches the notebook; the footer carries host controls.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MutableRefObject } from "react";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
if (!("scrollTo" in Element.prototype)) {
  Object.defineProperty(Element.prototype, "scrollTo", { value: () => {}, writable: true });
}

const otaProbe = vi.hoisted(() => ({
  value: null as boolean | null,
  activeApiMutation: false,
}));
const prefStore = vi.hoisted(() => ({
  mem: new Map<string, string>(),
}));
const scanApi = vi.hoisted(() => ({
  getAssetByTag: vi.fn(),
  openAssetNotebook: vi.fn(),
}));
const nativePick = vi.hoisted(() => ({
  pickPhoto: vi.fn(),
  capturePhoto: vi.fn(),
  pickDocument: vi.fn(),
}));

vi.mock("../src/api/client", async () => {
  const actual = await vi.importActual<typeof import("../src/api/client")>("../src/api/client");
  return { ...actual, hasActiveApiMutations: () => otaProbe.activeApiMutation };
});

vi.mock("../src/api/resources", async () => {
  const actual = await vi.importActual<typeof import("../src/api/resources")>("../src/api/resources");
  return {
    ...actual,
    getAssetByTag: scanApi.getAssetByTag,
    openAssetNotebook: scanApi.openAssetNotebook,
    listNotebooks: vi.fn(async () => [
      { id: "nb-a", displayName: "Drive A", manufacturer: "Siemens", model: "G120", equipmentType: null, identityStatus: "user_confirmed", nodeId: "n", sourceCount: 2, createdAt: null, asset: { entityId: "asset-1", selectedVia: null, confirmedBy: null, confirmedAt: null },
        threads: [
          { id: "thrd-a1", notebookId: "nb-a", title: "Intermittent fault", createdAt: "", updatedAt: "2026-09-10T12:00:00Z", turnCount: 2, sharedLegacy: false },
          { id: "thrd-a2", notebookId: "nb-a", title: "Startup checks", createdAt: "", updatedAt: "2026-09-10T11:00:00Z", turnCount: 1, sharedLegacy: false },
        ] },
      { id: "nb-b", displayName: "General notes", manufacturer: null, model: null, equipmentType: null, identityStatus: "unknown", nodeId: "n", sourceCount: 0, createdAt: null, asset: null,
        threads: [{ id: "thrd-b1", notebookId: "nb-b", title: "General question", createdAt: "", updatedAt: "", turnCount: 1, sharedLegacy: false }] },
    ]),
  };
});
vi.mock("../src/lib/native-pick", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/native-pick")>("../src/lib/native-pick");
  return { ...actual, pickPhoto: nativePick.pickPhoto, capturePhoto: nativePick.capturePhoto, pickDocument: nativePick.pickDocument };
});
vi.mock("@capacitor/share", () => ({ Share: { share: vi.fn(async () => ({})) } }));
vi.mock("../src/screens/NotebookScreen", () => ({
  NotebookScreen: (props: {
    id: string;
    threadId?: string | null;
    openAddSources?: boolean;
    chromeless?: boolean;
    backRef: MutableRefObject<(() => boolean) | null>;
    unifiedShell?: { projects: unknown[]; navigationFooter?: unknown; onOpenItem: (i: { kind: string; id: string; label: string }) => void };
    initialQuestion?: string | null;
    initialSensorStart?: "read-scan" | null;
    onExit: () => void;
  }) => {
    props.backRef.current = () => {
      props.onExit();
      return true;
    };
    return (
      <div
        data-testid="nb"
        data-id={props.id}
        data-thread-id={props.threadId ?? ""}
        data-open-add-sources={String(Boolean(props.openAddSources))}
        data-chromeless={String(props.chromeless)}
        data-initial-question={props.initialQuestion ?? ""}
        data-initial-sensor={props.initialSensorStart ?? ""}
      >
        {props.unifiedShell ? <button onClick={() => props.unifiedShell?.onOpenItem({ kind: "thread", id: "notebook-nb-b:thread-thrd-b1", label: "General question" })}>open-b</button> : null}
        <div data-testid="footer">{props.unifiedShell?.navigationFooter as never}</div>
      </div>
    );
  },
}));
// preferencesStore is the real @capacitor/preferences web path; under some
// jsdom builds localStorage is not a full Storage and the root's load() throws,
// which the catch turns into the error state. Mock it like everything else.
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
vi.mock("../src/unified/UnifiedAboutUpdates", () => ({
  UnifiedAboutUpdates: (p: { onBack: () => void; pendingOfflineWork: () => Promise<boolean> }) => (
    <div data-testid="about">
      <button onClick={p.onBack}>back</button>
      <button onClick={() => void p.pendingOfflineWork().then((value) => { otaProbe.value = value; })}>
        Probe update readiness
      </button>
    </div>
  ),
}));

import { UnifiedRoot } from "../src/screens/UnifiedRoot";
import { claimAttachments, clearAttachments } from "../src/unified/attachment-handoff";

const ME = { id: "u", email: "mike@example.com", name: null, role: "tech", tenantId: "t", capabilities: [] };

afterEach(() => {
  // The handoff is module state; a leftover stash would leak between tests.
  clearAttachments();
  cleanup();
  prefStore.mem.clear();
  otaProbe.value = null;
  otaProbe.activeApiMutation = false;
});

describe("UnifiedRoot", () => {
  it("loads notebooks into a composer-first home, then opens the preferred notebook when the user sends", async () => {
    const onSignOut = vi.fn(async () => {});
    render(<UnifiedRoot me={ME} backRef={{ current: null }} onSignOut={onSignOut} />);

    expect(await waitFor(() => screen.getByTestId("unified-home"))).toBeTruthy();
    expect(screen.queryByTestId("nb")).toBeNull();
    const box = screen.getByRole("textbox", { name: "Ask MIRA" }) as HTMLTextAreaElement;
    fireEvent.input(box, { target: { value: "Why did the conveyor stop?" } });
    fireEvent.submit(screen.getByRole("form", { name: "Composer" }));

    const nb = await waitFor(() => screen.getByTestId("nb"));
    expect(nb.getAttribute("data-id")).toBe("nb-a");
    expect(nb.getAttribute("data-thread-id")).toMatch(/^thrd_/);
    expect(nb.getAttribute("data-chromeless")).toBe("true");
    expect(nb.getAttribute("data-initial-question")).toBe("Why did the conveyor stop?");

    fireEvent.click(screen.getByText("open-b"));
    await waitFor(() => expect(screen.getByTestId("nb").getAttribute("data-id")).toBe("nb-b"));
    expect(screen.getByTestId("nb").getAttribute("data-thread-id")).toBe("thrd-b1");

    expect(screen.getByTestId("footer").textContent).toContain("mike@example.com");
    // The unified shell is the only experience: no classic escape hatch.
    expect(screen.queryByText("Use classic app")).toBeNull();
    fireEvent.click(screen.getByText("Sign out"));
    expect(onSignOut).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("About & updates"));
    expect(await waitFor(() => screen.getByTestId("about"))).toBeTruthy();
  });

  it("New chat from the sidebar creates a clean thread in the selected project without destroying the old one", async () => {
    const backRef = { current: null as (() => boolean) | null };
    render(<UnifiedRoot me={ME} backRef={backRef} onSignOut={async () => {}} />);

    await waitFor(() => screen.getByTestId("unified-home"));
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    fireEvent.click(screen.getAllByRole("button", { name: "New chat" })[0]);
    const nb = await waitFor(() => screen.getByTestId("nb"));
    const firstThread = nb.getAttribute("data-thread-id");
    expect(nb.getAttribute("data-id")).toBe("nb-a");
    expect(firstThread).toMatch(/^thrd_/);

    await act(async () => {
      backRef.current?.();
    });
    await waitFor(() => screen.getByTestId("unified-home"));
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    fireEvent.click(screen.getAllByRole("button", { name: "New chat" })[0]);
    await waitFor(() => expect(screen.getByTestId("nb").getAttribute("data-thread-id")).toMatch(/^thrd_/));
    expect(screen.getByTestId("nb").getAttribute("data-thread-id")).not.toBe(firstThread);
  });

  it("selecting an existing thread restores that thread id under its Project", async () => {
    render(<UnifiedRoot me={ME} backRef={{ current: null }} onSignOut={async () => {}} />);

    await waitFor(() => screen.getByTestId("unified-home"));
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    fireEvent.click(screen.getByRole("button", { name: "Startup checks" }));

    const nb = await waitFor(() => screen.getByTestId("nb"));
    expect(nb.getAttribute("data-id")).toBe("nb-a");
    expect(nb.getAttribute("data-thread-id")).toBe("thrd-a2");
  });

  // These three replace a test that asserted `data-open-add-sources === "true"`
  // after tapping Photo — it encoded the defect as the contract, which is why
  // the composer's "+" menu shipped routing into source management.
  it("home Photo opens the native picker and never routes through Add Sources", async () => {
    nativePick.pickPhoto.mockResolvedValue(new File(["x"], "bearing.jpg", { type: "image/jpeg" }));
    render(<UnifiedRoot me={ME} backRef={{ current: null }} onSignOut={async () => {}} />);

    await waitFor(() => screen.getByTestId("unified-home"));
    fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
    fireEvent.click(screen.getByRole("button", { name: "Photo" }));

    await waitFor(() => expect(nativePick.pickPhoto).toHaveBeenCalledTimes(1));
    // Still on home: picking a photo must not create a thread or open a sheet.
    expect(screen.getByTestId("unified-home")).toBeTruthy();
    expect(screen.queryByTestId("nb")).toBeNull();
    // The chip proves the attachment came back to the COMPOSER, not to a sheet.
    expect(await screen.findByText(/bearing\.jpg/)).toBeTruthy();
  });

  it("home Camera opens the native camera, and File the native document picker", async () => {
    nativePick.capturePhoto.mockResolvedValue(new File(["x"], "shot.jpg", { type: "image/jpeg" }));
    nativePick.pickDocument.mockResolvedValue(new File(["x"], "notes.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }));
    render(<UnifiedRoot me={ME} backRef={{ current: null }} onSignOut={async () => {}} />);

    await waitFor(() => screen.getByTestId("unified-home"));
    fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
    fireEvent.click(screen.getByRole("button", { name: "Camera" }));
    await waitFor(() => expect(nativePick.capturePhoto).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
    fireEvent.click(screen.getByRole("button", { name: "File" }));
    await waitFor(() => expect(nativePick.pickDocument).toHaveBeenCalledTimes(1));

    // A general document, not a PDF gate — and it is NOT the PDF-source door.
    expect(await screen.findByText(/notes\.docx/)).toBeTruthy();
    expect(screen.queryByTestId("nb")).toBeNull();
  });

  it("carries a home attachment into the thread the first send creates", async () => {
    nativePick.pickPhoto.mockResolvedValue(new File(["x"], "bearing.jpg", { type: "image/jpeg" }));
    render(<UnifiedRoot me={ME} backRef={{ current: null }} onSignOut={async () => {}} />);

    await waitFor(() => screen.getByTestId("unified-home"));
    fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
    fireEvent.click(screen.getByRole("button", { name: "Photo" }));
    await screen.findByText(/bearing\.jpg/);

    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "what is leaking here" } });
    fireEvent.keyDown(box, { key: "Enter" });

    const nb = await waitFor(() => screen.getByTestId("nb"));
    expect(nb.getAttribute("data-initial-question")).toBe("what is leaking here");
    expect(nb.getAttribute("data-open-add-sources")).toBe("false");
    // The bytes reached the handoff the notebook's composer claims. Without
    // this the photo is dropped on the floor between home and the thread and
    // the technician is never told.
    const handed = claimAttachments();
    expect(handed.map((h) => h.file.name)).toEqual(["bearing.jpg"]);
  });

  it("gives source management its own drawer entry, separate from the composer", async () => {
    render(<UnifiedRoot me={ME} backRef={{ current: null }} onSignOut={async () => {}} />);

    await waitFor(() => screen.getByTestId("unified-home"));
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    // Drive A has sourceCount 2. Without this entry the Sources panel is
    // unreachable in the unified shell: the notebook appbar overflow that
    // normally holds it is gated behind !chromeless, so the ONLY previous route
    // was the composer's attach handlers setting openAddSources.
    // The row's accessible name is label + kind meta (threads read "...Chat"),
    // so match the label rather than an exact string.
    fireEvent.click(await screen.findByRole("button", { name: /^Sources \(2\)/ }));

    const nb = await waitFor(() => screen.getByTestId("nb"));
    expect(nb.getAttribute("data-id")).toBe("nb-a");
    expect(nb.getAttribute("data-open-add-sources")).toBe("true");
  });

  it("routes home Scan machine into the selected notebook's direct scanner entry", async () => {
    render(<UnifiedRoot me={ME} backRef={{ current: null }} onSignOut={async () => {}} />);

    await waitFor(() => screen.getByTestId("unified-home"));
    fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
    fireEvent.click(await screen.findByRole("button", { name: "Scan machine" }));

    const nb = await waitFor(() => screen.getByTestId("nb"));
    expect(nb.getAttribute("data-id")).toBe("nb-a");
    expect(nb.getAttribute("data-initial-sensor")).toBe("read-scan");
  });

  it("consumes Android Back on About and returns to the unified conversation", async () => {
    const backRef = { current: null as (() => boolean) | null };
    render(
      <UnifiedRoot
        me={ME}
        backRef={backRef}
        onSignOut={async () => {}}
      />,
    );

    await waitFor(() => screen.getByTestId("unified-home"));
    fireEvent.input(screen.getByRole("textbox", { name: "Ask MIRA" }), { target: { value: "open" } });
    fireEvent.submit(screen.getByRole("form", { name: "Composer" }));
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

  it("hardware Back from a conversation root returns to the in-app composer home", async () => {
    const backRef = { current: null as (() => boolean) | null };
    render(<UnifiedRoot me={ME} backRef={backRef} onSignOut={async () => {}} />);

    await waitFor(() => screen.getByTestId("unified-home"));
    fireEvent.input(screen.getByRole("textbox", { name: "Ask MIRA" }), { target: { value: "open" } });
    fireEvent.submit(screen.getByRole("form", { name: "Composer" }));
    await waitFor(() => screen.getByTestId("nb"));

    let consumed = false;
    await act(async () => {
      consumed = backRef.current?.() ?? false;
    });

    expect(consumed).toBe(true);
    expect(await waitFor(() => screen.getByTestId("unified-home"))).toBeTruthy();
  });

  it("hardware Back on the composer home stays inside the unified root", async () => {
    const backRef = { current: null as (() => boolean) | null };
    render(<UnifiedRoot me={ME} backRef={backRef} onSignOut={async () => {}} />);

    await waitFor(() => screen.getByTestId("unified-home"));

    expect(backRef.current?.()).toBe(true);
    expect(screen.getByTestId("unified-home")).toBeTruthy();
  });

  it("reports an in-flight API mutation as busy to the update controller", async () => {
    otaProbe.activeApiMutation = true;
    render(
      <UnifiedRoot
        me={ME}
        backRef={{ current: null }}
        onSignOut={async () => {}}
      />,
    );

    await waitFor(() => screen.getByTestId("unified-home"));
    fireEvent.input(screen.getByRole("textbox", { name: "Ask MIRA" }), { target: { value: "open" } });
    fireEvent.submit(screen.getByRole("form", { name: "Composer" }));
    await waitFor(() => screen.getByTestId("nb"));
    fireEvent.click(screen.getByText("About & updates"));
    fireEvent.click(await screen.findByRole("button", { name: "Probe update readiness" }));

    await waitFor(() => expect(otaProbe.value).toBe(true));
  });

  it("a deep-link tag resolves through resolveScan and opens that machine's notebook", async () => {
    scanApi.getAssetByTag.mockResolvedValue({ id: "asset-b" });
    scanApi.openAssetNotebook.mockResolvedValue({ id: "nb-b" });
    const onDeepLinkConsumed = vi.fn();
    render(
      <UnifiedRoot
        me={ME}
        backRef={{ current: null }}
        onSignOut={async () => {}}
        deepLink={{ tag: "CV-101", raw: "factorylm://m/CV-101" }}
        onDeepLinkConsumed={onDeepLinkConsumed}
      />,
    );

    const nb = await waitFor(() => screen.getByTestId("nb"));
    expect(nb.getAttribute("data-id")).toBe("nb-b");
    expect(scanApi.getAssetByTag).toHaveBeenCalledWith("CV-101");
    expect(scanApi.openAssetNotebook).toHaveBeenCalledWith("asset-b", "qr");
    await waitFor(() => expect(onDeepLinkConsumed).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("an unrecognized deep link surfaces a dismissible notice instead of a dead screen", async () => {
    const onDeepLinkConsumed = vi.fn();
    render(
      <UnifiedRoot
        me={ME}
        backRef={{ current: null }}
        onSignOut={async () => {}}
        deepLink={{ tag: null, raw: "factorylm://bogus" }}
        onDeepLinkConsumed={onDeepLinkConsumed}
      />,
    );

    const notice = await waitFor(() => screen.getByRole("alert"));
    expect(notice.textContent).toContain("Unrecognized link: factorylm://bogus");
    expect(screen.getByTestId("unified-home")).toBeTruthy();
    await waitFor(() => expect(onDeepLinkConsumed).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText("Dismiss"));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
