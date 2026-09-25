// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false, convertFileSrc: (p: string) => p },
  CapacitorHttp: { request: vi.fn() }, registerPlugin: () => ({}),
}));
vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: vi.fn(async () => ({ value: null })), set: vi.fn(), remove: vi.fn() },
}));
vi.mock("../src/lib/offline-queue", async (original) => ({
  ...await original<typeof import("../src/lib/offline-queue")>(),
  preferencesStore: { get: async () => null, set: async () => {}, remove: async () => {}, keys: async () => [] },
}));
const chat = vi.hoisted(() => ({ rows: new Map<string, any[]>() }));
const notebook = { id: "nb-source-proof", displayName: "Sources proof", manufacturer: null, model: null,
  equipmentType: null, identityStatus: "unknown", nodeId: "n", sourceCount: 0, createdAt: null, asset: null, threads: [] };
vi.mock("../src/api/resources", async (original) => ({
  ...await original<typeof import("../src/api/resources")>(),
  listNotebooks: vi.fn(async () => [{ ...notebook, id: "existing", displayName: "Existing project" }]),
  createNotebook: vi.fn(async () => notebook),
  getNotebookDetail: vi.fn(async (_id, options) => ({ notebook, sources: [], turns: chat.rows.get(options?.threadId ?? "legacy") ?? [] })),
  askNotebook: vi.fn(async (_id, question, _scope, options) => {
    const thread = options?.threadId ?? "legacy";
    const rows = chat.rows.get(thread) ?? [];
    chat.rows.set(thread, [...rows, { id: `${thread}-${rows.length}`, question, answerText: "Recorded answer", answerStatus: "answered", evidence: [], basis: "general_reasoning" }]);
    return { answer: "Recorded answer", status: "answered", sawStatus: true, citations: [] };
  }),
}));
import { UnifiedRoot } from "../src/screens/UnifiedRoot";
import { closeTopTransientLayer, _resetTransientLayersForTest } from "../src/lib/transient-layer";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
Element.prototype.scrollTo = vi.fn();
afterEach(() => { cleanup(); _resetTransientLayersForTest(); });

it("Sources opens the upload sheet from the same mounted project and can be reopened", async () => {
  render(<UnifiedRoot me={{ id: "u", email: "proof@example.com", name: null, role: "tech", tenantId: "t", capabilities: [] }}
    backRef={{ current: null }} onSignOut={() => {}} />);
  await screen.findByTestId("unified-home");
  fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
  fireEvent.click(await screen.findByRole("button", { name: "New project" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Sources proof" } });
  fireEvent.click(screen.getByRole("button", { name: "Create project" }));
  await screen.findByTestId("unified-root");
  await screen.findByRole("button", { name: "Open navigation" });
  for (let attempt = 0; attempt < 2; attempt++) {
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    fireEvent.click(document.querySelector('[data-item-id="sources-nb-source-proof"]')!);
    await screen.findByRole("button", { name: /Upload a PDF manual/ });
    expect(screen.getByTestId("unified-root").getAttribute("data-notebook-id")).toBe(notebook.id);
    await act(async () => { expect(closeTopTransientLayer()).toBe(true); });
    await waitFor(() => expect(screen.queryByRole("button", { name: /Upload a PDF manual/ })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /Back to chat/ }));
  }
});


it("keeps a fresh legacy and populated named conversation reachable in both directions", async () => {
  chat.rows.clear();
  render(<UnifiedRoot me={{ id: "u", email: "proof@example.com", name: null, role: "tech", tenantId: "t", capabilities: [] }} backRef={{ current: null }} onSignOut={() => {}} />);
  await screen.findByTestId("unified-home");
  fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
  fireEvent.click(await screen.findByRole("button", { name: "New project" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Sources proof" } });
  fireEvent.click(screen.getByRole("button", { name: "Create project" }));
  await screen.findByRole("textbox", { name: "Ask MIRA" });
  const send = async (text: string) => {
    fireEvent.change(screen.getByRole("textbox", { name: "Ask MIRA" }), { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Recorded answer");
  };
  await send("First conversation question");
  fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  await screen.findByRole("textbox", { name: "Ask MIRA" });
  await send("Second conversation question");
  fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
  const legacy = document.querySelector('[data-item-id="notebook-nb-source-proof:thread-legacy"]');
  expect(legacy).not.toBeNull();
  fireEvent.click(legacy!);
  await waitFor(() => expect(document.querySelector('[data-role="user"]')?.textContent).toContain("First conversation question"));
  fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
  const named = document.querySelector('[data-item-id^="notebook-nb-source-proof:thread-thrd_"]');
  expect(named).not.toBeNull();
  fireEvent.click(named!);
  await waitFor(() => expect(document.querySelector('[data-role="user"]')?.textContent).toContain("Second conversation question"));
});
