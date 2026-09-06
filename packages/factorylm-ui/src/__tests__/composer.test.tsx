import { afterEach, describe, expect, it } from "bun:test";
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
  const textarea = form?.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]') ?? null;
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
});
