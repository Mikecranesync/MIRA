import { afterEach, describe, expect, it } from "bun:test";
import { getFixture } from "@factorylm/interaction";
import { fakeAdapter, renderHarness, type HarnessView } from "./harness";

const views: HarnessView[] = [];

afterEach(() => {
  views.splice(0).forEach((view) => view.cleanup());
});

function render(...args: Parameters<typeof renderHarness>): HarnessView {
  const view = renderHarness(...args);
  views.push(view);
  return view;
}

function composer(view: HarnessView): { form: HTMLFormElement; textarea: HTMLTextAreaElement } {
  const form = view.container.querySelector<HTMLFormElement>('form[aria-label="Composer"]');
  const textarea = form?.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask MIRA"]') ?? null;
  if (!form || !textarea) throw new Error("the universal composer must render a labelled message field");
  return { form, textarea };
}

describe("universal composer", () => {
  for (const surface of ["public", "web", "mobile", "hub"] as const) {
    it(`renders the same labelled controls in ${surface}`, () => {
      const view = render({ surface, fixture: "machine-ask" });
      composer(view);

      expect(view.buttonNamed("Add attachment")).not.toBeNull();
      expect(view.buttonNamed("Voice")).not.toBeNull();
      expect(view.buttonNamed("Send")).not.toBeNull();
      expect(view.container.querySelector('[aria-label="Machine"]')).not.toBeNull();
      expect(view.container.querySelectorAll('form[aria-label="Composer"]')).toHaveLength(1);
    });
  }

  it("keeps the draft in the reducer and appends a mock user turn on send", () => {
    const view = render({ surface: "web", fixture: "general-ask" });
    const { form, textarea } = composer(view);
    const send = view.buttonNamed("Send");
    if (!send) throw new Error("Send is required");

    expect(send.disabled).toBe(true);
    view.type(textarea, "How is preload measured?");
    expect(view.outputs().draft).toBe("How is preload measured?");
    expect(send.disabled).toBe(false);
    view.submit(form);
    expect(view.outputs().turnCount).toBe(3);
    expect(view.outputs().draft).toBe("");
    const last = Array.from(view.container.querySelectorAll<HTMLElement>("[data-turn-id]")).at(-1);
    expect(last?.dataset.role).toBe("user");
    expect(last?.textContent).toContain("How is preload measured?");
  });

  it("uses the prototype placeholder and names the active machine", () => {
    const machine = render({ surface: "web", fixture: "machine-ask" });
    const general = render({ surface: "web", fixture: "general-ask" });

    expect(composer(machine).textarea.placeholder).toBe("Ask MIRA about this machine…");
    expect(machine.container.querySelector('[aria-label="Machine"]')?.textContent).toContain("Drive A");
    expect(machine.container.querySelector('[aria-label="Machine"]')?.textContent).toMatch(/confirmed/i);
    expect(composer(general).textarea.placeholder).toBe("Ask MIRA…");
    expect(general.container.querySelector('[aria-label="Machine"]')?.textContent).toMatch(/no machine/i);
  });

  it("opens the attachment menu through the reducer and routes photo/file to the adapter", async () => {
    const adapter = fakeAdapter({
      photo: { id: "file-new-photo", name: "terminal-block.jpg", mediaType: "image/jpeg", kind: "photo", status: "ready" },
    });
    const view = render({ surface: "mobile", fixture: "machine-ask", adapter });
    const add = view.buttonNamed("Add attachment");
    if (!add) throw new Error("Add attachment is required");

    expect(view.container.querySelector('[aria-label="Attachment menu"]')).toBeNull();
    view.click(add);
    expect(add.getAttribute("aria-expanded")).toBe("true");
    const photo = view.buttonNamed("Photo");
    const file = view.buttonNamed("File");
    if (!photo || !file) throw new Error("Photo and File must be offered");
    view.click(photo);
    await view.flush();
    expect(adapter.calls).toEqual(["attachPhoto"]);
    expect(view.container.querySelector('[aria-label="Attachment menu"]')).toBeNull();
    expect(view.container.querySelector('[aria-label="Pending attachments"]')?.textContent).toContain("terminal-block.jpg");
    expect(view.container.querySelector('[aria-label="Pending attachments"]')?.textContent).toMatch(/not sent/i);
  });

  it("keeps native-only capabilities honest and disabled off-device", () => {
    const web = render({ surface: "web", fixture: "machine-ask" });
    const mobile = render({ surface: "mobile", fixture: "machine-ask" });
    for (const view of [web, mobile]) {
      const add = view.buttonNamed("Add attachment");
      if (!add) throw new Error("Add attachment is required");
      view.click(add);
    }

    expect(web.buttonNamed("Camera")?.disabled).toBe(true);
    expect(web.buttonNamed("Camera")?.title).toMatch(/device/i);
    expect(web.buttonNamed("Scan machine")?.disabled).toBe(true);
    expect(mobile.buttonNamed("Camera")?.disabled).toBe(false);
    expect(mobile.buttonNamed("Scan machine")?.disabled).toBe(false);
    expect(web.buttonNamed("Voice")?.disabled).toBe(true);
    expect(mobile.buttonNamed("Voice")?.disabled).toBe(true);
    expect(mobile.buttonNamed("Voice")?.title).toMatch(/not available/i);
  });

  it("scans a machine through the adapter and selects it only through the reducer", async () => {
    const adapter = fakeAdapter({ scannedMachineId: "machine-drive-b" });
    const view = render({ surface: "mobile", fixture: "machine-ask", adapter });
    const add = view.buttonNamed("Add attachment");
    if (!add) throw new Error("Add attachment is required");
    view.click(add);
    const scan = view.buttonNamed("Scan machine");
    if (!scan) throw new Error("Scan machine is required on a native device");

    expect(view.activeContext().machineId).toBe("machine-drive-a");
    view.click(scan);
    await view.flush();
    expect(adapter.calls).toEqual(["scanMachine"]);
    expect(view.activeContext().machineId).toBe("machine-drive-b");
    expect(view.container.querySelector('[aria-label="Machine"]')?.textContent).toContain("Drive B");
    expect(view.container.querySelector('[aria-label="Machine"]')?.textContent).toMatch(/unconfirmed/i);
  });

  it("opens navigation to change the machine when the surface cannot scan", () => {
    const view = render({ surface: "web", fixture: "machine-ask" });
    const shell = view.container.querySelector<HTMLElement>(".fl-shell");
    const close = view.buttonNamed("Close navigation");
    const machine = view.container.querySelector<HTMLButtonElement>('button[aria-label="Machine"]');
    if (!shell || !close || !machine) throw new Error("machine control must be a button");

    view.click(close);
    expect(shell.dataset.navigationVisible).toBe("false");
    view.click(machine);
    expect(shell.dataset.navigationVisible).toBe("true");
  });

  it("keeps a pending attachment labelled with the machine it was captured for", async () => {
    const adapter = fakeAdapter({
      photo: { id: "file-new-photo", name: "terminal-block.jpg", mediaType: "image/jpeg", kind: "photo", status: "ready" },
      scannedMachineId: "machine-drive-b",
    });
    const view = render({ surface: "mobile", fixture: "machine-ask", adapter });
    const add = view.buttonNamed("Add attachment");
    if (!add) throw new Error("Add attachment is required");
    view.click(add);
    view.click(view.buttonNamed("Photo") ?? new Error("Photo is required") as never);
    await view.flush();
    const before = view.container.querySelector<HTMLElement>('[aria-label="Pending attachments"] li');
    expect(before?.dataset.capturedMachineId).toBe("machine-drive-a");
    expect(before?.dataset.contextMismatch).toBe("false");

    view.click(add);
    view.click(view.buttonNamed("Scan machine") ?? new Error("Scan machine is required") as never);
    await view.flush();
    expect(view.activeContext().machineId).toBe("machine-drive-b");
    const after = view.container.querySelector<HTMLElement>('[aria-label="Pending attachments"] li');
    expect(after?.dataset.capturedMachineId).toBe("machine-drive-a");
    expect(after?.dataset.contextMismatch).toBe("true");
    expect(after?.textContent).toContain("captured for Launch 2 Drive A");
    expect(after?.textContent).toMatch(/not the active machine/i);
  });

  it("does not carry pending attachments into a newly loaded thread", async () => {
    const adapter = fakeAdapter({
      photo: { id: "file-new-photo", name: "terminal-block.jpg", mediaType: "image/jpeg", kind: "photo", status: "ready" },
    });
    const view = render({ surface: "mobile", fixture: "machine-ask", adapter });
    view.click(view.buttonNamed("Add attachment") ?? new Error("Add attachment is required") as never);
    view.click(view.buttonNamed("Photo") ?? new Error("Photo is required") as never);
    await view.flush();
    expect(view.container.querySelector('[aria-label="Pending attachments"]')).not.toBeNull();

    view.dispatch({ type: "load-fixture", fixture: getFixture("general-ask") });
    expect(view.container.querySelector('[aria-label="Pending attachments"]')).toBeNull();
  });

  it("surfaces adapter rejections as an accessible error and allows retry", async () => {
    const adapter = fakeAdapter({ reject: new Error("permission denied") });
    const view = render({ surface: "mobile", fixture: "machine-ask", adapter });
    const add = view.buttonNamed("Add attachment");
    if (!add) throw new Error("Add attachment is required");

    view.click(add);
    view.click(view.buttonNamed("Photo") ?? new Error("Photo is required") as never);
    await view.flush();
    const error = view.container.querySelector('[aria-label="Attachment error"]');
    expect(error?.getAttribute("role")).toBe("alert");
    expect(error?.textContent).toMatch(/photo capture failed/i);
    expect(error?.textContent).toContain("permission denied");
    expect(add.getAttribute("aria-busy")).toBe("false");
    expect(view.container.querySelector('[aria-label="Pending attachments"]')).toBeNull();

    view.click(add);
    const scan = view.buttonNamed("Scan machine");
    if (!scan) throw new Error("Scan machine is required");
    expect(scan.disabled).toBe(false);
    view.click(scan);
    await view.flush();
    expect(adapter.calls).toEqual(["attachPhoto", "scanMachine"]);
    expect(view.container.querySelector('[aria-label="Attachment error"]')?.textContent).toMatch(/machine scan failed/i);
    expect(view.activeContext().machineId).toBe("machine-drive-a");
    expect(view.container.querySelector<HTMLButtonElement>('button[aria-label="Machine"]')?.disabled).toBe(false);
  });

  it("ignores duplicate activation while an adapter operation is pending", async () => {
    let resolvePhoto: ((value: null) => void) | null = null;
    const adapter = { ...fakeAdapter(), attachPhoto: () => new Promise<null>((resolve) => { resolvePhoto = resolve; }) };
    const view = render({ surface: "mobile", fixture: "machine-ask", adapter });
    const add = view.buttonNamed("Add attachment");
    if (!add) throw new Error("Add attachment is required");

    view.click(add);
    view.click(view.buttonNamed("Photo") ?? new Error("Photo is required") as never);
    expect(add.getAttribute("aria-busy")).toBe("true");
    view.click(add);
    expect(view.buttonNamed("Photo")?.disabled).toBe(true);
    expect(view.buttonNamed("Scan machine")?.disabled).toBe(true);
    if (!resolvePhoto) throw new Error("photo picker must be pending");
    (resolvePhoto as (value: null) => void)(null);
    await view.flush();
    expect(add.getAttribute("aria-busy")).toBe("false");
  });

  it("routes send, stop, retry, and citations to host hooks when a live host provides them", () => {
    const calls: string[] = [];
    const hooks = {
      onSend: (text: string) => calls.push(`send:${text}`),
      onStop: () => calls.push("stop"),
      onRetry: (turnId: string) => calls.push(`retry:${turnId}`),
      onSource: (source: { id: string }) => calls.push(`source:${source.id}`),
      busy: false,
    };
    const view = render({ surface: "mobile", fixture: "grounded-answer", hooks });
    const { form, textarea } = composer(view);
    view.type(textarea, "real question");
    view.submit(form);
    expect(calls).toEqual(["send:real question"]);
    expect(view.outputs().draft).toBe("");
    expect(view.outputs().turnCount).toBe(1);

    view.click(view.container.querySelector('button[data-part-type="source"]') ?? new Error("citation is required") as never);
    expect(calls).toContain("source:source-f30001-manual");
    expect(view.container.querySelector('[aria-label="Source viewer"]')).toBeNull();

    const failed = render({ surface: "mobile", fixture: "error-retry", hooks });
    view.click(failed.buttonNamed("Retry") ?? new Error("Retry is required") as never);
    expect(calls).toContain("retry:turn-error-retry");
    expect(failed.outputs().retryTarget).toBe("");

    const busy = render({ surface: "mobile", fixture: "grounded-answer", hooks: { ...hooks, busy: true } });
    expect(busy.buttonNamed("Send")).toBeNull();
    view.click(busy.buttonNamed("Stop") ?? new Error("Stop is required") as never);
    expect(calls).toContain("stop");
  });
});
