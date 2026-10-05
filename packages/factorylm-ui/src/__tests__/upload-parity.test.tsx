/**
 * Uploads behave like a modern chat app (owner ask, 2026-10-05: "just like
 * chatgpt grok or any other modern site or app that accepts uploads").
 *
 * Staging before this: the picked photo was a text row ("x.jpg · captured for
 * no machine · attached"), paste and drop did nothing, and tapping a photo
 * left the app for a new tab.
 *
 * Run: cd apps/factorylm-ui-lab && bun test ../../packages/factorylm-ui/src/__tests__/upload-parity.test.tsx
 */
import { afterEach, describe, expect, it } from "bun:test";
import { act } from "react";
import type { Attachment, InteractionPart, PlatformAdapter, ShellFixture } from "@factorylm/interaction";
import { BACK_EVENT } from "../FactoryLMShell";
import { fakeAdapter, renderHarness, type HarnessView } from "./harness";

const views: HarnessView[] = [];
afterEach(() => { views.splice(0).forEach((v) => v.cleanup()); });

const BLOB = "blob:https://app.factorylm.com/5f0c";
const PHOTO: Attachment = { id: "a-photo", name: "nameplate.jpg", mediaType: "image/jpeg", kind: "photo", status: "ready", previewUrl: BLOB };
const PDF: Attachment = { id: "a-pdf", name: "drive-manual.pdf", mediaType: "application/pdf", kind: "pdf", status: "ready" };
const hooks = { onSend: () => {} };

function render(adapter: PlatformAdapter, fixture: "machine-ask" | "attachments" = "machine-ask", transformFixture?: (f: ShellFixture) => ShellFixture): HarnessView {
  const view = renderHarness({ surface: "web", fixture, adapter, hooks, ...(transformFixture ? { transformFixture } : {}) });
  views.push(view);
  return view;
}

async function pick(view: HarnessView, label: "Photo" | "File") {
  view.click(view.buttonNamed("Add attachment") ?? (null as never));
  view.click(view.buttonNamed(label) ?? (null as never));
  await view.flush();
}

const chips = (view: HarnessView) => Array.from(view.container.querySelectorAll<HTMLLIElement>('[aria-label="Pending attachments"] li'));

/** A paste/drop event carrying files, the way a browser builds one. */
function fileEvent(type: "paste" | "drop" | "dragover", files: File[]): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const data = { files, types: files.length ? ["Files"] : ["text/plain"], items: [] };
  Object.defineProperty(event, type === "paste" ? "clipboardData" : "dataTransfer", { value: data });
  return event;
}

/** An adapter with the optional web intake; records what it was handed. */
function intakeAdapter(): PlatformAdapter & { adopted: string[]; released: string[] } {
  const adopted: string[] = [];
  const released: string[] = [];
  return {
    ...fakeAdapter({ photo: PHOTO, file: PDF }),
    adopted,
    released,
    adoptFiles: (files) => files.filter((f) => f.type.startsWith("image/")).map((f, i) => {
      adopted.push(f.name);
      return { id: `adopted-${i}-${f.name}`, name: f.name, mediaType: f.type, kind: "photo", status: "ready", previewUrl: BLOB };
    }),
    release: (id) => { released.push(id); },
  };
}

describe("pending chip", () => {
  it("shows a thumbnail of a picked photo, and its name on one line", async () => {
    const view = render(fakeAdapter({ photo: PHOTO }));
    await pick(view, "Photo");
    const [chip] = chips(view);
    expect(chip?.querySelector("img.fl-composer__pending-thumb")?.getAttribute("src")).toBe(BLOB);
    expect(chip?.querySelector(".fl-composer__pending-name")?.textContent).toBe("nameplate.jpg");
  });

  it("drops the noise: no 'attached', no 'captured for no machine'", async () => {
    const view = render(fakeAdapter({ photo: PHOTO }), "machine-ask", (f) => ({ ...f, activeContext: { ...f.activeContext, machineId: undefined } }));
    await pick(view, "Photo");
    const text = chips(view)[0]?.textContent ?? "";
    expect(text).not.toContain("attached");
    expect(text).not.toContain("captured for");
  });

  it("still warns when the photo was captured for another machine", async () => {
    const view = render(fakeAdapter({ photo: PHOTO }));
    await pick(view, "Photo");
    view.dispatch({ type: "select-machine", machineId: "machine-drive-b" });
    expect(chips(view)[0]?.textContent ?? "").toContain("not the active machine");
  });

  it("shows a type badge, not a thumbnail, for a PDF", async () => {
    const view = render(fakeAdapter({ file: PDF }));
    await pick(view, "File");
    const [chip] = chips(view);
    expect(chip?.querySelector("img")).toBeNull();
    expect(chip?.querySelector(".fl-composer__pending-badge")?.textContent).toBe("PDF");
  });

  it("falls back to the badge when the browser can't decode the preview", async () => {
    const view = render(fakeAdapter({ photo: PHOTO }));
    await pick(view, "Photo");
    const img = chips(view)[0]?.querySelector("img");
    act(() => { img?.dispatchEvent(new Event("error")); });
    expect(chips(view)[0]?.querySelector("img")).toBeNull();
    expect(chips(view)[0]?.querySelector(".fl-composer__pending-badge")?.textContent).toBe("IMG");
  });

  it("refuses a javascript: preview (no image, badge instead)", async () => {
    const view = render(fakeAdapter({ photo: { ...PHOTO, previewUrl: "javascript:alert(1)" } }));
    await pick(view, "Photo");
    expect(chips(view)[0]?.querySelector("img")).toBeNull();
  });

  it("removing a chip tells the host to release its bytes", async () => {
    const adapter = intakeAdapter();
    const view = render(adapter);
    await pick(view, "Photo");
    view.click(view.buttonNamed("Remove nameplate.jpg") ?? (null as never));
    expect(adapter.released).toEqual(["a-photo"]);
    expect(chips(view)).toHaveLength(0);
  });
});

describe("paste and drop", () => {
  const jpeg = () => new File([new Uint8Array([1])], "pasted.jpg", { type: "image/jpeg" });

  it("pasting an image attaches it through the host's intake", () => {
    const adapter = intakeAdapter();
    const view = render(adapter);
    const box = view.container.querySelector("textarea") as HTMLTextAreaElement;
    const event = fileEvent("paste", [jpeg()]);
    act(() => { box.dispatchEvent(event); });
    expect(adapter.adopted).toEqual(["pasted.jpg"]);
    expect(event.defaultPrevented).toBe(true);
    expect(chips(view)).toHaveLength(1);
  });

  it("pasting text is left alone", () => {
    const adapter = intakeAdapter();
    const view = render(adapter);
    const box = view.container.querySelector("textarea") as HTMLTextAreaElement;
    const event = fileEvent("paste", []);
    act(() => { box.dispatchEvent(event); });
    expect(adapter.adopted).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it("dropping a file onto the composer attaches it; dragging over shows the drop state", () => {
    const adapter = intakeAdapter();
    const view = render(adapter);
    const form = view.container.querySelector('form[aria-label="Composer"]') as HTMLFormElement;
    act(() => { form.dispatchEvent(fileEvent("dragover", [jpeg()])); });
    expect(form.getAttribute("data-drag-over")).toBe("true");
    act(() => { form.dispatchEvent(fileEvent("drop", [jpeg()])); });
    expect(form.getAttribute("data-drag-over")).toBeNull();
    expect(adapter.adopted).toEqual(["pasted.jpg"]);
    expect(chips(view)).toHaveLength(1);
  });

  it("a refused file type says so instead of vanishing", () => {
    const adapter = intakeAdapter();
    const view = render(adapter);
    const form = view.container.querySelector('form[aria-label="Composer"]') as HTMLFormElement;
    act(() => { form.dispatchEvent(fileEvent("drop", [new File(["x"], "setup.exe", { type: "application/x-msdownload" })])); });
    expect(chips(view)).toHaveLength(0);
    expect(view.container.querySelector('[aria-label="Attachment error"]')?.textContent).toMatch(/can't be attached/);
  });

  it("a host without adoptFiles (mobile today) keeps paste and drop as they were", () => {
    const view = render(fakeAdapter());
    const box = view.container.querySelector("textarea") as HTMLTextAreaElement;
    const paste = fileEvent("paste", [jpeg()]);
    act(() => { box.dispatchEvent(paste); });
    const form = view.container.querySelector('form[aria-label="Composer"]') as HTMLFormElement;
    act(() => { form.dispatchEvent(fileEvent("dragover", [jpeg()])); });
    expect(paste.defaultPrevented).toBe(false);
    expect(form.getAttribute("data-drag-over")).toBeNull();
    expect(chips(view)).toHaveLength(0);
  });
});

describe("in-app photo viewer", () => {
  const withPreview = (url: string) => (f: ShellFixture): ShellFixture => ({
    ...f,
    thread: { ...f.thread, turns: f.thread.turns.map((t) => ({ ...t, parts: t.parts.map((p): InteractionPart =>
      p.type === "attachment" && p.attachment.kind === "photo" ? { ...p, attachment: { ...p.attachment, previewUrl: url } } : p) })) },
  });

  it("an attachment part with a picture renders a thumbnail; without one, the old name row", () => {
    const view = render(fakeAdapter(), "attachments", withPreview("/api/namespace/files/file-nameplate/"));
    const parts = Array.from(view.container.querySelectorAll('[data-part-type="attachment"]'));
    expect(parts[0]?.querySelector("a.fl-photo img")?.getAttribute("src")).toBe("/api/namespace/files/file-nameplate/");
    expect(parts[1]?.querySelector(".fl-attachment__name")?.textContent).toBe("g120-manual.pdf");
  });

  it("tapping the thumbnail opens the photo in a dialog, and Close closes it", () => {
    const view = render(fakeAdapter(), "attachments", withPreview("/api/namespace/files/file-nameplate/"));
    const link = view.container.querySelector<HTMLAnchorElement>("a.fl-photo");
    const dialog = view.container.querySelector<HTMLDialogElement>("dialog.fl-photo-viewer");
    expect(dialog?.open).toBe(false);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    act(() => { link?.dispatchEvent(click); });
    expect(click.defaultPrevented).toBe(true);
    expect(dialog?.open).toBe(true);
    expect(dialog?.querySelector("img")?.getAttribute("src")).toBe("/api/namespace/files/file-nameplate/");
    view.click(Array.from(dialog?.querySelectorAll("button") ?? []).find((b) => b.textContent === "Close") ?? (null as never));
    expect(dialog?.open).toBe(false);
  });

  it("a modifier-click still opens a new tab (the link is not hijacked)", () => {
    const view = render(fakeAdapter(), "attachments", withPreview("/api/namespace/files/file-nameplate/"));
    const link = view.container.querySelector<HTMLAnchorElement>("a.fl-photo");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, metaKey: true });
    act(() => { link?.dispatchEvent(click); });
    expect(click.defaultPrevented).toBe(false);
    expect(view.container.querySelector<HTMLDialogElement>("dialog.fl-photo-viewer")?.open).toBe(false);
  });

  it("a javascript: preview on an attachment part renders no link and no picture", () => {
    const view = render(fakeAdapter(), "attachments", withPreview("javascript:alert(1)"));
    expect(view.container.querySelector('[data-part-type="attachment"] a')).toBeNull();
    expect(view.container.querySelector('[data-part-type="attachment"] img')).toBeNull();
  });
});

describe("the photo viewer sits above every shell layer (#4288 Codex r1 F1)", () => {
  const withPreview = (f: ShellFixture): ShellFixture => ({
    ...f,
    thread: { ...f.thread, turns: f.thread.turns.map((t) => ({ ...t, parts: t.parts.map((p): InteractionPart =>
      p.type === "attachment" && p.attachment.kind === "photo" ? { ...p, attachment: { ...p.attachment, previewUrl: "/api/namespace/files/file-nameplate/" } } : p) })) },
  });
  function openViewer() {
    const adapter = fakeAdapter();
    const view = render(adapter, "attachments", withPreview);
    const link = view.container.querySelector<HTMLAnchorElement>("a.fl-photo");
    act(() => { link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })); });
    const dialog = view.container.querySelector<HTMLDialogElement>("dialog.fl-photo-viewer");
    expect(dialog?.open).toBe(true);
    return { adapter, dialog: dialog! };
  }

  it("Escape is left to the browser: the shell neither cancels it nor calls the host's Back", () => {
    const { adapter } = openViewer();
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => { document.dispatchEvent(escape); });
    expect(escape.defaultPrevented).toBe(false);
    expect(adapter.calls).not.toContain("onBack");
  });

  it("Back closes the photo first, without reaching the host", () => {
    const { adapter, dialog } = openViewer();
    act(() => { document.dispatchEvent(new Event(BACK_EVENT, { cancelable: true })); });
    expect(dialog.open).toBe(false);
    expect(adapter.calls).not.toContain("onBack");
  });

  it("control: with no photo open, Back still goes to the host", () => {
    const adapter = fakeAdapter();
    render(adapter, "attachments", withPreview);
    act(() => { document.dispatchEvent(new Event(BACK_EVENT, { cancelable: true })); });
    expect(adapter.calls).toContain("onBack");
  });
});

describe("unsent attachments are released when the composer goes away (#4288 Codex r2 F3)", () => {
  it("unmounting with a pending photo releases it; a removed or sent one is not released twice", async () => {
    const adapter = intakeAdapter();
    const sent: string[] = [];
    const view = renderHarness({ surface: "web", fixture: "machine-ask", adapter, hooks: { onSend: (_t: string, a: readonly Attachment[] = []) => { sent.push(...a.map((x) => x.id)); } } });
    const box = view.container.querySelector("textarea") as HTMLTextAreaElement;
    const jpeg = (name: string) => new File([new Uint8Array([1])], name, { type: "image/jpeg" });
    act(() => { box.dispatchEvent(fileEvent("paste", [jpeg("sent.jpg")])); });
    view.submit(view.container.querySelector('form[aria-label="Composer"]') as HTMLFormElement);
    expect(sent).toHaveLength(1);
    act(() => { box.dispatchEvent(fileEvent("paste", [jpeg("left.jpg")])); });
    expect(adapter.released).toEqual([]);
    view.cleanup();
    expect(adapter.adopted).toEqual(["sent.jpg", "left.jpg"]);
    expect(adapter.released).toEqual(["adopted-0-left.jpg"]);
  });
});
