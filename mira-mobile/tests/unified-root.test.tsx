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

const notebookApi = vi.hoisted(() => ({
  createNotebook: vi.fn(async (input: { displayName: string }) => ({
    id: "nb-general", displayName: input.displayName, manufacturer: null, model: null, equipmentType: null,
    identityStatus: "unknown", nodeId: "n", sourceCount: 0, createdAt: null, asset: null, threads: [],
  })),
}));
vi.mock("../src/api/resources", async () => {
  const actual = await vi.importActual<typeof import("../src/api/resources")>("../src/api/resources");
  return {
    ...actual,
    getAssetByTag: scanApi.getAssetByTag,
    openAssetNotebook: scanApi.openAssetNotebook,
    createNotebook: notebookApi.createNotebook,
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
    onCreateProject?: () => void;
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
        data-project-names={JSON.stringify((props.unifiedShell?.projects as { name: string }[] | undefined)?.map((p) => p.name) ?? [])}
      >
        {props.unifiedShell ? <button onClick={() => props.unifiedShell?.onOpenItem({ kind: "thread", id: "notebook-nb-b:thread-thrd-b1", label: "General question" })}>open-b</button> : null}
        <button onClick={() => props.onCreateProject?.()}>create-project-from-notebook</button>
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
  it("loads notebooks into a composer-first home; a HOME send opens an UNBOUND notebook, never the last-opened machine one (#3877)", async () => {
    const onSignOut = vi.fn(async () => {});
    render(<UnifiedRoot me={ME} backRef={{ current: null }} onSignOut={onSignOut} />);

    expect(await waitFor(() => screen.getByTestId("unified-home"))).toBeTruthy();
    expect(screen.queryByTestId("nb")).toBeNull();
    const box = screen.getByRole("textbox", { name: "Ask MIRA" }) as HTMLTextAreaElement;
    fireEvent.input(box, { target: { value: "Why did the conveyor stop?" } });
    fireEvent.submit(screen.getByRole("form", { name: "Composer" }));

    const nb = await waitFor(() => screen.getByTestId("nb"));
    // nb-a is the bound Siemens G120 and first in last-opened order; nb-b is
    // the unbound "General notes". A general question must not inherit a drive.
    expect(nb.getAttribute("data-id")).toBe("nb-b");
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

  it("New chat from HOME creates a clean thread in an UNBOUND project (#3877) without destroying the old one", async () => {
    const backRef = { current: null as (() => boolean) | null };
    render(<UnifiedRoot me={ME} backRef={backRef} onSignOut={async () => {}} />);

    await waitFor(() => screen.getByTestId("unified-home"));
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    fireEvent.click(screen.getAllByRole("button", { name: "New chat" })[0]);
    const nb = await waitFor(() => screen.getByTestId("nb"));
    const firstThread = nb.getAttribute("data-thread-id");
    // From HOME, "New chat" is a blank GENERAL chat: nb-b (unbound), not nb-a
    // (the last-opened Siemens G120). Inside a notebook, New chat still stays
    // in that notebook — that path is unchanged.
    expect(nb.getAttribute("data-id")).toBe("nb-b");
    expect(firstThread).toMatch(/^thrd_/);

    // #4188: BACK out of the thread now lands on nb-b's project root, not
    // straight back to HOME — and its own "New chat" (no drawer needed)
    // still starts a fresh thread in the SAME project.
    await act(async () => {
      backRef.current?.();
    });
    await waitFor(() => screen.getByTestId("unified-project-root"));
    fireEvent.click(screen.getByRole("button", { name: "+ New chat" }));
    await waitFor(() => expect(screen.getByTestId("nb").getAttribute("data-thread-id")).toMatch(/^thrd_/));
    expect(screen.getByTestId("nb").getAttribute("data-id")).toBe("nb-b");
    expect(screen.getByTestId("nb").getAttribute("data-thread-id")).not.toBe(firstThread);
  });

  it("New project is reachable from inside a conversation, not only from HOME (#3896)", async () => {
    render(<UnifiedRoot me={ME} backRef={{ current: null }} onSignOut={async () => {}} />);
    await waitFor(() => screen.getByTestId("unified-home"));
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    fireEvent.click(screen.getAllByRole("button", { name: "New chat" })[0]);
    await waitFor(() => screen.getByTestId("nb"));
    fireEvent.click(screen.getByText("create-project-from-notebook"));
    expect(await waitFor(() => screen.getByTestId("unified-create-project"))).toBeTruthy();
  });

  it("a project created from the New-project form is in the drawer's Project list at once, Sources included (#3895)", async () => {
    render(<UnifiedRoot me={ME} backRef={{ current: null }} onSignOut={async () => {}} />);
    await waitFor(() => screen.getByTestId("unified-home"));
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    fireEvent.click(screen.getAllByRole("button", { name: "New project" })[0]);
    await waitFor(() => screen.getByTestId("unified-create-project"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Pixel pre-read" } });
    fireEvent.submit(screen.getByRole("form", { name: "Name the machine" }));

    const nb = await waitFor(() => screen.getByTestId("nb"));
    // The form's createNotebook mock answers with id nb-general and the typed
    // name; the host must land in it AND list it — on the phone the drawer had
    // no row for the new project (and no Sources to upload into) until the app
    // was killed and relaunched.
    expect(nb.getAttribute("data-id")).toBe("nb-general");
    expect(JSON.parse(nb.getAttribute("data-project-names") ?? "[]")).toContain("Pixel pre-read");
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

  // #4188: hardware BACK out of a notebook's chat thread used to fall straight
  // through to the empty global-home composer ("What can I help you with?",
  // titled "FactoryLM"), with no visible way back to the thread just left —
  // only hamburger → project → "… Chat". The four tests below are the fixed
  // BACK ladder: thread → project root (title + the just-left thread, tapping
  // a thread reopens it, New chat stays in the same project) → global home.
  it("hardware Back from a notebook thread lands on that project's root — real title, and the thread just left is listed (#4188)", async () => {
    const backRef = { current: null as (() => boolean) | null };
    const { container } = render(<UnifiedRoot me={ME} backRef={backRef} onSignOut={async () => {}} />);

    await waitFor(() => screen.getByTestId("unified-home"));
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    fireEvent.click(screen.getByRole("button", { name: "Startup checks" }));
    const nb = await waitFor(() => screen.getByTestId("nb"));
    expect(nb.getAttribute("data-id")).toBe("nb-a");
    expect(nb.getAttribute("data-thread-id")).toBe("thrd-a2");

    let consumed = false;
    await act(async () => {
      consumed = backRef.current?.() ?? false;
    });
    expect(consumed).toBe(true);

    const root = await waitFor(() => screen.getByTestId("unified-project-root"));
    // The real project title ("Drive A"), never the HOME composer's "FactoryLM".
    expect(root.querySelector("h1")?.textContent).toBe("Drive A");
    // The thread just left (thrd-a2, "Startup checks") is visible — not only
    // the OTHER thread the project happens to have.
    expect(
      container.querySelector('[data-item-id="notebook-nb-a:thread-thrd-a2"]')?.textContent,
    ).toContain("Startup checks");
    expect(
      container.querySelector('[data-item-id="notebook-nb-a:thread-thrd-a1"]')?.textContent,
    ).toContain("Intermittent fault");
  });

  it("#4188: the thread just left is FIRST in the project root, even when the boot-time list ranked it lower", async () => {
    // The list is loaded once at boot (server updated_at DESC). Chatting in an
    // older thread does not re-rank it, so the root floats the thread just left
    // to the top instead of trusting the stale order.
    const backRef = { current: null as (() => boolean) | null };
    const { container } = render(<UnifiedRoot me={ME} backRef={backRef} onSignOut={async () => {}} />);
    await waitFor(() => screen.getByTestId("unified-home"));
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    fireEvent.click(screen.getByRole("button", { name: "Startup checks" }));
    await waitFor(() => screen.getByTestId("nb"));
    await act(async () => {
      backRef.current?.();
    });
    const root = await waitFor(() => screen.getByTestId("unified-project-root"));
    const rows = Array.from(root.querySelectorAll("[data-item-id]")).map((el) => el.getAttribute("data-item-id"));
    expect(rows).toEqual(["notebook-nb-a:thread-thrd-a2", "notebook-nb-a:thread-thrd-a1"]);
    expect(container).toBeTruthy();
  });

  it("#4188 Codex F1: a chat started this session stays in the project root after it is reopened and left again", async () => {
    // The new chat is not in the boot-time server list. Reopening it from the
    // project root used to clear the only record of it, so the second BACK
    // landed on a list without it — the conversation looked lost again.
    const backRef = { current: null as (() => boolean) | null };
    render(<UnifiedRoot me={ME} backRef={backRef} onSignOut={async () => {}} />);
    await waitFor(() => screen.getByTestId("unified-home"));
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    fireEvent.click(screen.getByRole("button", { name: "Startup checks" }));
    await waitFor(() => screen.getByTestId("nb"));
    await act(async () => {
      backRef.current?.();
    });
    await waitFor(() => screen.getByTestId("unified-project-root"));
    fireEvent.click(screen.getByRole("button", { name: "+ New chat" }));
    const newThreadId = (await waitFor(() => screen.getByTestId("nb"))).getAttribute("data-thread-id") ?? "";
    expect(newThreadId).toMatch(/^thrd_/);
    const newRow = `notebook-nb-a:thread-${newThreadId}`;

    await act(async () => {
      backRef.current?.();
    });
    let root = await waitFor(() => screen.getByTestId("unified-project-root"));
    const row = root.querySelector(`[data-item-id="${newRow}"]`) as HTMLElement | null;
    expect(row).not.toBeNull();
    fireEvent.click(row!);
    expect((await waitFor(() => screen.getByTestId("nb"))).getAttribute("data-thread-id")).toBe(newThreadId);

    await act(async () => {
      backRef.current?.();
    });
    root = await waitFor(() => screen.getByTestId("unified-project-root"));
    expect(root.querySelector(`[data-item-id="${newRow}"]`)).not.toBeNull();
  });

  it("#4188 Codex F4: a notebook with no server threads keeps its original (legacy) conversation listed after a new chat is started", async () => {
    // threadRows() synthesizes the legacy row only while the summaries array
    // is empty, so merging a session chat into it used to hide the original
    // conversation from the drawer and the project root.
    scanApi.getAssetByTag.mockResolvedValue({ id: "asset-empty" });
    scanApi.openAssetNotebook.mockResolvedValue({
      id: "nb-empty", displayName: "Press 4", manufacturer: null, model: null, equipmentType: null,
      identityStatus: "unknown", nodeId: "n", sourceCount: 0, createdAt: null, asset: null, threads: [],
    });
    const backRef = { current: null as (() => boolean) | null };
    render(
      <UnifiedRoot
        me={ME}
        backRef={backRef}
        onSignOut={async () => {}}
        deepLink={{ tag: "PRESS-4", raw: "factorylm://m/PRESS-4" }}
        onDeepLinkConsumed={() => {}}
      />,
    );
    await waitFor(() => screen.getByTestId("nb"));
    await act(async () => {
      backRef.current?.();
    });
    let root = await waitFor(() => screen.getByTestId("unified-project-root"));
    expect(root.querySelector('[data-item-id="notebook-nb-empty:thread-legacy"]')).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "+ New chat" }));
    const newThreadId = (await waitFor(() => screen.getByTestId("nb"))).getAttribute("data-thread-id") ?? "";
    await act(async () => {
      backRef.current?.();
    });
    root = await waitFor(() => screen.getByTestId("unified-project-root"));
    const rows = Array.from(root.querySelectorAll("[data-item-id]")).map((el) => el.getAttribute("data-item-id"));
    expect(rows).toContain("notebook-nb-empty:thread-legacy");
    expect(rows).toContain(`notebook-nb-empty:thread-${newThreadId}`);
    expect(root.querySelector('[data-item-id="notebook-nb-empty:thread-legacy"]')?.textContent).toContain("Press 4");
  });

  it("#4188 Codex F2: a failed deep link that arrives while the project root is showing surfaces its notice there", async () => {
    const backRef = { current: null as (() => boolean) | null };
    const view = render(<UnifiedRoot me={ME} backRef={backRef} onSignOut={async () => {}} />);
    await waitFor(() => screen.getByTestId("unified-home"));
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    fireEvent.click(screen.getByRole("button", { name: "Startup checks" }));
    await waitFor(() => screen.getByTestId("nb"));
    await act(async () => {
      backRef.current?.();
    });
    await waitFor(() => screen.getByTestId("unified-project-root"));

    view.rerender(
      <UnifiedRoot
        me={ME}
        backRef={backRef}
        onSignOut={async () => {}}
        deepLink={{ tag: null, raw: "factorylm://garbage" }}
        onDeepLinkConsumed={() => {}}
      />,
    );
    const alert = await waitFor(() => screen.getByRole("alert"));
    expect(alert.textContent).toContain("Unrecognized link: factorylm://garbage");
    expect(screen.getByTestId("unified-project-root")).toBeTruthy();
  });

  it("tapping a recent thread in the project root reopens that exact thread (#4188)", async () => {
    const backRef = { current: null as (() => boolean) | null };
    render(<UnifiedRoot me={ME} backRef={backRef} onSignOut={async () => {}} />);

    await waitFor(() => screen.getByTestId("unified-home"));
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    fireEvent.click(screen.getByRole("button", { name: "Startup checks" }));
    await waitFor(() => screen.getByTestId("nb"));
    await act(async () => {
      backRef.current?.();
    });
    await waitFor(() => screen.getByTestId("unified-project-root"));

    // Reopen the OTHER thread of the same project — proves the tap reaches
    // the drawer's own open path (host.onOpenItem → open()), not a new one.
    fireEvent.click(screen.getByRole("button", { name: "Intermittent fault" }));
    const nb = await waitFor(() => screen.getByTestId("nb"));
    expect(nb.getAttribute("data-id")).toBe("nb-a");
    expect(nb.getAttribute("data-thread-id")).toBe("thrd-a1");
  });

  it("New chat from the project root starts a new thread in the SAME project (#4188)", async () => {
    const backRef = { current: null as (() => boolean) | null };
    render(<UnifiedRoot me={ME} backRef={backRef} onSignOut={async () => {}} />);

    await waitFor(() => screen.getByTestId("unified-home"));
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    fireEvent.click(screen.getByRole("button", { name: "Startup checks" }));
    await waitFor(() => screen.getByTestId("nb"));
    await act(async () => {
      backRef.current?.();
    });
    await waitFor(() => screen.getByTestId("unified-project-root"));

    fireEvent.click(screen.getByRole("button", { name: "+ New chat" }));
    const nb = await waitFor(() => screen.getByTestId("nb"));
    expect(nb.getAttribute("data-id")).toBe("nb-a");
    expect(nb.getAttribute("data-thread-id")).toMatch(/^thrd_/);
  });

  it("BACK again from the project root goes to the global home (#4188)", async () => {
    const backRef = { current: null as (() => boolean) | null };
    render(<UnifiedRoot me={ME} backRef={backRef} onSignOut={async () => {}} />);

    await waitFor(() => screen.getByTestId("unified-home"));
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    fireEvent.click(screen.getByRole("button", { name: "Startup checks" }));
    await waitFor(() => screen.getByTestId("nb"));

    let consumed = false;
    await act(async () => {
      consumed = backRef.current?.() ?? false;
    });
    expect(consumed).toBe(true);
    await waitFor(() => screen.getByTestId("unified-project-root"));

    await act(async () => {
      consumed = backRef.current?.() ?? false;
    });
    expect(consumed).toBe(true);
    expect(await waitFor(() => screen.getByTestId("unified-home"))).toBeTruthy();
  });

  it("#4188: a QR deep link to a just-created machine notebook gets ITS project root on BACK — the opened notebook joins the list at once, it never waits for the drawer refresh", async () => {
    // openAssetNotebook can create the notebook, and the drawer refresh that
    // would list it may fail or lag (the listNotebooks mock never includes it).
    // The root keeps the notebook openAssetNotebook returned, so BACK lands on
    // that project's real root, not the global home or an empty page.
    scanApi.getAssetByTag.mockResolvedValue({ id: "asset-new" });
    scanApi.openAssetNotebook.mockResolvedValue({
      id: "nb-new", displayName: "Line 7 conveyor", manufacturer: null, model: null, equipmentType: null,
      identityStatus: "unknown", nodeId: "n", sourceCount: 0, createdAt: null, asset: null,
      threads: [{ id: "thrd-n1", notebookId: "nb-new", title: "Belt slipping", createdAt: "", updatedAt: "", turnCount: 1, sharedLegacy: false }],
    });
    const backRef = { current: null as (() => boolean) | null };
    render(
      <UnifiedRoot
        me={ME}
        backRef={backRef}
        onSignOut={async () => {}}
        deepLink={{ tag: "CV-NEW", raw: "factorylm://m/CV-NEW" }}
        onDeepLinkConsumed={() => {}}
      />,
    );
    const nb = await waitFor(() => screen.getByTestId("nb"));
    expect(nb.getAttribute("data-id")).toBe("nb-new");
    // open() runs before the list update lands; it must still open the new
    // notebook's latest thread, not fall back to the legacy one.
    expect(nb.getAttribute("data-thread-id")).toBe("thrd-n1");

    let consumed = false;
    await act(async () => {
      consumed = backRef.current?.() ?? false;
    });
    expect(consumed).toBe(true);
    const root = await waitFor(() => screen.getByTestId("unified-project-root"));
    expect(root.querySelector("h1")?.textContent).toBe("Line 7 conveyor");
    expect(root.querySelector('[data-item-id="notebook-nb-new:thread-thrd-n1"]')?.textContent).toContain("Belt slipping");
  });

  it("#4188 control: a cold start with no notebooks is unchanged — the empty-workspace create prompt, not a project root or home composer", async () => {
    const { listNotebooks } = await import("../src/api/resources");
    vi.mocked(listNotebooks).mockResolvedValueOnce([]);
    render(<UnifiedRoot me={ME} backRef={{ current: null }} onSignOut={async () => {}} />);

    await waitFor(() =>
      expect(screen.getByText("No projects yet. Create one to start a conversation.")).toBeTruthy(),
    );
    expect(screen.queryByTestId("unified-home")).toBeNull();
    expect(screen.queryByTestId("unified-project-root")).toBeNull();
    expect(screen.queryByTestId("nb")).toBeNull();
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

  it("#3851: a cold start resumes the persisted last-viewed thread when the project is opened — not the latest one", async () => {
    // thrd-a1 is the NEWEST thread of nb-a (updatedAt 12:00); the technician was
    // last reading thrd-a2 (11:00). The boot restore reads that id, and opening
    // the project must honour it instead of falling back to the latest thread —
    // and must not overwrite the persisted pointer with the latest id.
    prefStore.mem.set("flm.unified.notebook.v1", "nb-a");
    prefStore.mem.set("flm.unified.thread.v1.nb-a", "thrd-a2");
    render(<UnifiedRoot me={ME} backRef={{ current: null }} onSignOut={vi.fn(async () => {})} />);
    await waitFor(() => screen.getByTestId("unified-home"));
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    fireEvent.click(screen.getByRole("button", { name: "Drive A" }));
    const nb = await waitFor(() => screen.getByTestId("nb"));
    expect(nb.getAttribute("data-id")).toBe("nb-a");
    expect(nb.getAttribute("data-thread-id")).toBe("thrd-a2");
    await waitFor(() => expect(prefStore.mem.get("flm.unified.thread.v1.nb-a")).toBe("thrd-a2"));
  });

  it("#3851 control: opening a DIFFERENT project than the restored one still lands on its latest thread", async () => {
    prefStore.mem.set("flm.unified.notebook.v1", "nb-a");
    prefStore.mem.set("flm.unified.thread.v1.nb-a", "thrd-a2");
    render(<UnifiedRoot me={ME} backRef={{ current: null }} onSignOut={vi.fn(async () => {})} />);
    await waitFor(() => screen.getByTestId("unified-home"));
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    fireEvent.click(screen.getByRole("button", { name: "General notes" }));
    const nb = await waitFor(() => screen.getByTestId("nb"));
    expect(nb.getAttribute("data-id")).toBe("nb-b");
    expect(nb.getAttribute("data-thread-id")).toBe("thrd-b1");
  });

  it("a HOME send with only machine notebooks creates General first, then asks there (#3877)", async () => {
    const { listNotebooks } = await import("../src/api/resources");
    vi.mocked(listNotebooks).mockResolvedValueOnce([
      { id: "nb-a", displayName: "Drive A", manufacturer: "Siemens", model: "G120", equipmentType: null, identityStatus: "user_confirmed", nodeId: "n", sourceCount: 2, createdAt: null, asset: { entityId: "asset-1", selectedVia: null, confirmedBy: null, confirmedAt: null }, threads: [] },
    ] as never);
    render(<UnifiedRoot me={ME} backRef={{ current: null }} onSignOut={vi.fn(async () => {})} />);
    await waitFor(() => screen.getByTestId("unified-home"));
    const box = screen.getByRole("textbox", { name: "Ask MIRA" }) as HTMLTextAreaElement;
    fireEvent.input(box, { target: { value: "What is a VFD?" } });
    fireEvent.submit(screen.getByRole("form", { name: "Composer" }));
    const nb = await waitFor(() => screen.getByTestId("nb"));
    expect(notebookApi.createNotebook).toHaveBeenCalledWith({ displayName: "General", identitySourceType: "user" });
    expect(nb.getAttribute("data-id")).toBe("nb-general");
    expect(nb.getAttribute("data-initial-question")).toBe("What is a VFD?");
  });

  it("#3851: a persisted last-viewed id that is no longer in the notebook's list falls back to the latest thread and the pointer is rewritten", async () => {
    prefStore.mem.set("flm.unified.notebook.v1", "nb-a");
    prefStore.mem.set("flm.unified.thread.v1.nb-a", "thrd-deleted-or-outside-the-window");
    render(<UnifiedRoot me={ME} backRef={{ current: null }} onSignOut={vi.fn(async () => {})} />);
    await waitFor(() => screen.getByTestId("unified-home"));
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    fireEvent.click(screen.getByRole("button", { name: "Drive A" }));
    const nb = await waitFor(() => screen.getByTestId("nb"));
    expect(nb.getAttribute("data-id")).toBe("nb-a");
    expect(nb.getAttribute("data-thread-id")).toBe("thrd-a1");
    await waitFor(() => expect(prefStore.mem.get("flm.unified.thread.v1.nb-a")).toBe("thrd-a1"));
  });

  it("#3851: a selection that went stale AFTER boot (a draft New-chat id not in the server list) is not resumed — open() re-validates against the list", async () => {
    // Boot already normalises a stale PERSISTED id, so open()'s own membership
    // check is only load-bearing for ids that go stale later: HOME "New chat"
    // mints a draft thread that exists only client-side (in nb-b, the unbound
    // notebook). Back to HOME, then tapping that project must land on its real
    // latest thread, not the empty draft.
    const backRef = { current: null as (() => boolean) | null };
    render(<UnifiedRoot me={ME} backRef={backRef} onSignOut={vi.fn(async () => {})} />);
    await waitFor(() => screen.getByTestId("unified-home"));
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    fireEvent.click(screen.getAllByRole("button", { name: "New chat" })[0]);
    const nb = await waitFor(() => screen.getByTestId("nb"));
    expect(nb.getAttribute("data-id")).toBe("nb-b");
    expect(nb.getAttribute("data-thread-id")).toMatch(/^thrd_/);
    // #4188: the first BACK now lands on nb-b's project root, not HOME — a
    // second BACK is the rung that reaches HOME, from which the drawer's
    // "General notes" row re-triggers open() against the server list.
    await act(async () => { backRef.current?.(); });
    await waitFor(() => screen.getByTestId("unified-project-root"));
    await act(async () => { backRef.current?.(); });
    await waitFor(() => screen.getByTestId("unified-home"));
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    fireEvent.click(screen.getByRole("button", { name: "General notes" }));
    await waitFor(() => expect(screen.getByTestId("nb").getAttribute("data-thread-id")).toBe("thrd-b1"));
  });
});
