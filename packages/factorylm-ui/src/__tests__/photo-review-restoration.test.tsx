import { afterEach, describe, expect, it } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createShellState, getFixture, PROFILES, type ShellState } from "@factorylm/interaction";
import { PartRenderer, type HostHooks } from "../parts";
import { fakeAdapter } from "./harness";

type Reading = Awaited<ReturnType<NonNullable<HostHooks["onReviewPhoto"]>>>;
const reading = (reviewed: boolean): Reading => ({ observationId: "stored-reading", text: "Motor ratings, not measured values", reviewed });
const base = createShellState(getFixture("machine-evidence"), PROFILES.web);
const turn = base.thread.turns.find((t) => t.parts.some((p) => p.type === "visual_observation"))!;
const part = turn.parts.find((p) => p.type === "visual_observation")!;
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); });
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

function mount(hooks: HostHooks) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (state: ShellState = base) => act(() => {
    root.render(<PartRenderer part={part} turn={turn} state={state} adapter={fakeAdapter()} dispatch={() => {}} hooks={hooks} />);
  });
  render();
  const dispose = () => act(() => { root.unmount(); container.remove(); });
  cleanups.push(dispose);
  return {
    container, render,
    status: () => container.querySelector('[role="status"]')?.textContent ?? "",
    click: (name: string) => act(() => {
      const button = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === name);
      if (!button) throw Error(`Missing button: ${name}`);
      button.click();
    }),
  };
}

describe("cold photo-review restoration", () => {
  it.each([true, false])("restores persisted reviewed=%s without opening an editor or saving", async (reviewed) => {
    const reads: string[] = [];
    let writes = 0;
    const view = mount({
      isPhotoKept: () => true,
      onReviewPhoto: async (file) => { reads.push(file); return reading(reviewed); },
      onKeepPhoto: async () => { writes++; },
    });
    await settle();
    expect(reads).toEqual(["file-nameplate"]);
    expect(writes).toBe(0);
    expect(view.container.querySelector("textarea")).toBeNull();
    expect(view.status()).toContain("Kept on this machine");
    expect(view.status()).toContain(reviewed ? "Technician-reviewed reading" : "still unconfirmed");
    expect(view.status()).not.toContain(reviewed ? "still unconfirmed" : "Technician-reviewed reading");
  });

  it("does not claim unconfirmed or reviewed while the persisted status is loading", () => {
    const view = mount({ isPhotoKept: () => true, onKeepPhoto: async () => {}, onReviewPhoto: () => new Promise(() => {}) });
    expect(view.status()).toContain("Checking saved review status");
    expect(view.status()).not.toContain("still unconfirmed");
    expect(view.status()).not.toContain("Technician-reviewed reading");
  });

  it.each(["offline", "unavailable"])("keeps an unknown review status honest: %s", async (mode) => {
    const view = mount({
      isPhotoKept: () => true, onKeepPhoto: async () => {},
      ...(mode === "offline" ? { onReviewPhoto: async () => { throw Error("offline"); } } : {}),
    });
    await settle();
    expect(view.status()).toContain("Review status unavailable");
    expect(view.status()).not.toContain("Technician-reviewed reading");
    expect(view.status()).not.toContain("still unconfirmed");
  });

  it("does not load saved review status for an unkept photo", async () => {
    let reads = 0;
    const view = mount({ isPhotoKept: () => false, onKeepPhoto: async () => {}, onReviewPhoto: async () => { reads++; return reading(true); } });
    await settle();
    expect(reads).toBe(0);
    expect(view.status()).toBe("");
    expect(view.container.textContent).not.toContain("Technician-reviewed reading");
  });

  it("loads status when the host learns about the kept source after mount", async () => {
    let kept = false;
    const view = mount({ isPhotoKept: () => kept, onKeepPhoto: async () => {}, onReviewPhoto: async () => reading(true) });
    kept = true;
    view.render();
    await settle();
    expect(view.status()).toContain("Technician-reviewed reading");
  });

  it.each(["editor-first", "restoration-first", "no-host-change"])("keeps an active editor usable during host discovery: %s", async (order) => {
    let kept = false;
    let writes = 0;
    const pending: ((value: Reading) => void)[] = [];
    const view = mount({
      isPhotoKept: () => kept,
      onKeepPhoto: async () => { writes++; },
      onReviewPhoto: () => new Promise((resolve) => { pending.push(resolve); }),
    });
    expect(pending).toHaveLength(0);
    view.click("Keep on this machine");
    expect(pending).toHaveLength(1);
    if (order !== "no-host-change") {
      kept = true;
      view.render();
      expect(pending).toHaveLength(2);
      if (order === "restoration-first") await act(async () => { pending[1](reading(true)); });
    }
    await act(async () => { pending[0](reading(false)); });
    if (order === "editor-first") await act(async () => { pending[1](reading(true)); });
    expect(view.container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(reading(false).text);
    expect(view.container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
    const buttons = Array.from(view.container.querySelectorAll("button"));
    expect(buttons.find((button) => button.textContent === "Cancel review")?.disabled).toBe(false);
    expect(buttons.find((button) => button.textContent === "Save reviewed reading")?.disabled).toBe(true);
    expect(writes).toBe(0);
  });

  it("a restoration started during saving cannot downgrade the completed review", async () => {
    let kept = false;
    let reads = 0;
    let writes = 0;
    let finishSave!: () => void;
    let finishRestoration!: (value: Reading) => void;
    const view = mount({
      isPhotoKept: () => kept,
      onReviewPhoto: () => ++reads === 1 ? Promise.resolve(reading(false))
        : new Promise((resolve) => { finishRestoration = resolve; }),
      onKeepPhoto: () => { writes++; return new Promise<void>((resolve) => { finishSave = resolve; }); },
    });
    view.click("Keep on this machine");
    await settle();
    act(() => view.container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    view.click("Save reviewed reading");
    kept = true;
    view.render();
    expect(reads).toBe(2);
    await act(async () => { finishSave(); });
    expect(view.status()).toContain("Technician-reviewed reading");
    await act(async () => { finishRestoration(reading(false)); });
    expect(view.status()).toContain("Technician-reviewed reading");
    expect(view.status()).not.toContain("still unconfirmed");
    expect(writes).toBe(1);
  });

  it("opening an unreviewed reading still requires acknowledgement and does not save", async () => {
    let writes = 0;
    const view = mount({ isPhotoKept: () => true, onKeepPhoto: async () => { writes++; }, onReviewPhoto: async () => reading(false) });
    await settle();
    view.click("Review reading");
    await settle();
    expect(view.container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
    expect(Array.from(view.container.querySelectorAll("button")).find((b) => b.textContent === "Save reviewed reading")?.disabled).toBe(true);
    view.click("Cancel review");
    expect(view.status()).toContain("still unconfirmed");
    expect(writes).toBe(0);
  });

  it("a late restoration cannot downgrade a just-saved technician review", async () => {
    let finish!: (value: Reading) => void;
    let reads = 0;
    const view = mount({
      isPhotoKept: () => true, onKeepPhoto: async () => {},
      onReviewPhoto: () => ++reads === 1 ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve(reading(false)),
    });
    view.click("Review reading");
    await settle();
    act(() => view.container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    view.click("Save reviewed reading");
    await settle();
    expect(reads).toBe(2);
    expect(view.status()).toContain("Technician-reviewed reading");
    await act(async () => { finish(reading(false)); });
    expect(view.status()).toContain("Technician-reviewed reading");
    expect(view.status()).not.toContain("still unconfirmed");
  });

  it.each(["tenant", "project", "machine", "thread"])("does not carry trust across a changed %s or accept its delayed reading", async (scope) => {
    let finish!: (value: Reading) => void;
    let reads = 0;
    const view = mount({
      isPhotoKept: () => true, onKeepPhoto: async () => {},
      onReviewPhoto: () => ++reads === 1 ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve(reading(false)),
    });
    const state = scope === "thread"
      ? { ...base, thread: { ...base.thread, id: "other-thread" } }
      : { ...base, activeContext: { ...base.activeContext, [`${scope}Id`]: `other-${scope}` } };
    view.render(state);
    await settle();
    expect(reads).toBe(2);
    expect(view.status()).toContain("still unconfirmed");
    await act(async () => { finish(reading(true)); });
    expect(view.status()).toContain("still unconfirmed");
    expect(view.status()).not.toContain("Technician-reviewed reading");
  });
});
