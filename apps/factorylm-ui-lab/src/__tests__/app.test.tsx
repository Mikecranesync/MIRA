import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FIXTURE_IDS } from "@factorylm/interaction";
import { App, LAB_VIEWPORTS, parseLabState } from "../App";
import { createLabAdapter } from "../fake-adapter";

interface AppView {
  readonly container: HTMLDivElement;
  /** The most recent query string the lab mirrored (history.replaceState in a browser). */
  search(): string;
  buttonNamed(name: string): HTMLButtonElement | null;
  selectNamed(name: string): HTMLSelectElement | null;
  choose(select: HTMLSelectElement, value: string): void;
  click(element: Element): void;
  type(element: HTMLTextAreaElement, value: string): void;
  submit(element: HTMLFormElement): void;
  cleanup(): void;
}

const views: AppView[] = [];

afterEach(() => {
  views.splice(0).forEach((view) => view.cleanup());
});

function renderApp(search = ""): AppView {
  const container = document.createElement("div");
  document.body.append(container);
  let mirrored = "";
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(<App search={search} onSearch={(next) => { mirrored = next; }} />);
  });
  const view: AppView = {
    container,
    search: () => mirrored,
    buttonNamed: (name) => Array.from(container.querySelectorAll("button"))
      .find((button) => (button.getAttribute("aria-label") ?? button.textContent ?? "").trim() === name) ?? null,
    selectNamed: (name) => container.querySelector<HTMLSelectElement>(`select[aria-label="${name}"]`),
    choose: (select, value) => act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      if (!setter) throw new Error("select value setter is required");
      setter.call(select, value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }),
    click: (element) => act(() => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }),
    type: (element, value) => act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      if (!setter) throw new Error("textarea value setter is required");
      setter.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }),
    submit: (element) => act(() => {
      element.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    }),
    cleanup: () => act(() => {
      root.unmount();
      container.remove();
    }),
  };
  views.push(view);
  return view;
}

function must<T>(value: T | null | undefined, what: string): T {
  if (!value) throw new Error(`${what} is required`);
  return value;
}

describe("lab state from the URL", () => {
  it("defaults to the web surface, grounded answer, light theme, fluid viewport", () => {
    expect(parseLabState("")).toEqual({ surface: "web", scenario: "grounded-answer", theme: "light", viewport: "fluid", embed: false, thread: "classic", nav: "projects" });
  });

  it("reads every control from the query string and rejects unknown values", () => {
    expect(parseLabState("?surface=hub&scenario=work-run&theme=dark&viewport=412x915&embed=1"))
      .toEqual({ surface: "hub", scenario: "work-run", theme: "dark", viewport: "412x915", embed: true, thread: "classic", nav: "projects" });
    expect(parseLabState("?thread=assistant").thread).toBe("assistant");
    expect(parseLabState("?thread=nope").thread).toBe("classic");
    expect(parseLabState("?surface=nope&scenario=nope&theme=nope&viewport=nope"))
      .toEqual({ surface: "web", scenario: "grounded-answer", theme: "light", viewport: "fluid", embed: false, thread: "classic", nav: "projects" });
  });

  it("offers exactly the plan's viewport set", () => {
    expect(LAB_VIEWPORTS).toEqual(["fluid", "390x844", "412x915", "768x1024", "1440x900", "1720x1000"]);
  });
});

describe("disconnected lab", () => {
  it("renders the shared shell with labelled surface, scenario, theme, and viewport controls", () => {
    const view = renderApp();

    expect(view.container.querySelector(".fl-shell")).not.toBeNull();
    expect(view.selectNamed("Surface")).not.toBeNull();
    expect(view.selectNamed("Scenario")).not.toBeNull();
    expect(view.selectNamed("Viewport")).not.toBeNull();
    expect(view.buttonNamed("Theme: light")).not.toBeNull();
    const scenarios = Array.from(must(view.selectNamed("Scenario"), "scenario select").options).map((option) => option.value);
    expect(scenarios).toEqual([...FIXTURE_IDS]);
  });

  it("switches surface, scenario, and theme through the reducer and mirrors them into the URL", () => {
    const view = renderApp();
    const shell = () => must(view.container.querySelector<HTMLElement>(".fl-shell"), "shell");

    view.choose(must(view.selectNamed("Surface"), "surface"), "hub");
    expect(shell().dataset.surface).toBe("hub");
    view.choose(must(view.selectNamed("Scenario"), "scenario"), "work-run");
    expect(view.container.querySelector('[aria-label="Diagnostic Run"]')).not.toBeNull();
    view.click(must(view.buttonNamed("Theme: light"), "theme toggle"));
    expect(shell().dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(view.search()).toBe("?surface=hub&scenario=work-run&theme=dark");
  });

  it("frames a fixed viewport in a same-origin embed and renders shell-only in embed mode", () => {
    const framed = renderApp("?surface=mobile&scenario=machine-ask&viewport=412x915");
    const frame = must(framed.container.querySelector<HTMLIFrameElement>("iframe"), "viewport frame");
    expect(frame.getAttribute("width")).toBe("412");
    expect(frame.getAttribute("height")).toBe("915");
    expect(frame.getAttribute("src")).toBe("/?surface=mobile&scenario=machine-ask&theme=light&embed=1");
    expect(framed.container.querySelector(".fl-shell")).toBeNull();

    expect(framed.search()).toBe("?surface=mobile&scenario=machine-ask&theme=light&viewport=412x915");

    const embed = renderApp("?surface=mobile&scenario=machine-ask&embed=1");
    expect(embed.container.querySelector(".fl-shell")).not.toBeNull();
    expect(embed.search()).toBe("");
    expect(embed.selectNamed("Surface")).toBeNull();
    expect(embed.container.querySelector("iframe")).toBeNull();
  });

  it("uses only in-memory actions", () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = ((() => {
      calls += 1;
      throw new Error("network forbidden");
    }) as unknown) as typeof fetch;
    try {
      const view = renderApp("?scenario=general-ask");
      const textarea = must(view.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask MIRA"]'), "Ask MIRA");
      view.type(textarea, "What is bearing preload?");
      view.submit(must(view.container.querySelector<HTMLFormElement>('form[aria-label="Composer"]'), "composer"));
      expect(calls).toBe(0);
      expect(view.container.querySelectorAll("[data-turn-id]")).toHaveLength(3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("resets the scenario to its fixture without a reload", () => {
    const view = renderApp("?scenario=general-ask");
    const textarea = must(view.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask MIRA"]'), "Ask MIRA");
    view.type(textarea, "What is bearing preload?");
    view.submit(must(view.container.querySelector<HTMLFormElement>('form[aria-label="Composer"]'), "composer"));
    expect(view.container.querySelectorAll("[data-turn-id]")).toHaveLength(3);

    view.click(must(view.buttonNamed("Reset scenario"), "reset"));
    expect(view.container.querySelectorAll("[data-turn-id]")).toHaveLength(2);
  });
});

describe("lab adapter", () => {
  it("revokes a dropped photo's preview when its chip is removed, once (#4288 Codex r1 F3)", () => {
    const created: string[] = [];
    const revoked: string[] = [];
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = () => { created.push(`blob:lab/${created.length + 1}`); return created[created.length - 1]; };
    URL.revokeObjectURL = (u: string) => { revoked.push(u); };
    try {
      const adapter = createLabAdapter(() => ({ machineIds: [] }));
      const taken = adapter.adoptFiles!([
        new File([new Uint8Array([1])], "a.jpg", { type: "image/jpeg" }),
        new File([new Uint8Array([1])], "a.jpg", { type: "image/jpeg" }),
        new File(["%PDF"], "m.pdf", { type: "application/pdf" }),
      ]);
      for (const t of taken) adapter.release!(t.id);
      adapter.release!(taken[0].id);
      expect(created).toHaveLength(2);
      expect(revoked.sort()).toEqual([...created].sort());
    } finally {
      URL.createObjectURL = original.create;
      URL.revokeObjectURL = original.revoke;
    }
  });

  it("returns deterministic fixture attachments and the next in-scope machine, with no transport", async () => {
    const adapter = createLabAdapter(() => ({
      activeMachineId: "machine-drive-a",
      machineIds: ["machine-drive-a", "machine-drive-b"],
    }));

    const photo = await adapter.attachPhoto();
    const file = await adapter.attachFile();
    expect(photo).toEqual({ id: "lab-photo-1", name: "drive-a-nameplate.jpg", mediaType: "image/jpeg", kind: "photo", status: "ready" });
    expect(file).toEqual({ id: "lab-file-1", name: "g120-manual.pdf", mediaType: "application/pdf", kind: "pdf", status: "ready" });
    expect((await adapter.attachPhoto())?.id).toBe("lab-photo-2");
    expect(await adapter.scanMachine()).toBe("machine-drive-b");
    expect(await adapter.shareArtifact("artifact-handoff")).toBe("shared");
    expect(adapter.onBack()).toBe("handled");
    expect(adapter.log()).toEqual(["attachPhoto", "attachFile", "attachPhoto", "scanMachine", "shareArtifact:artifact-handoff", "onBack"]);

    const source = readFileSync(new URL("../fake-adapter.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/fetch\(|XMLHttpRequest|EventSource|WebSocket|https?:\/\/|localStorage|sessionStorage|indexedDB/);
  });
});

describe("built document", () => {
  it("denies every connection in the CSP and loads only the local entry", () => {
    const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
    const csp = must(html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1], "CSP meta");

    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(html).toMatch(/<script type="module" src="\.\/src\/main\.tsx"><\/script>/);
    expect(html).not.toMatch(/https?:\/\//);
  });
});

describe("equipment-first navigation (nav=equipment)", () => {
  const target = (view: AppView) => must(view.container.querySelector('[data-testid="question-target"]'), "question target").textContent;
  const row = (view: AppView, id: string, scope = '[role="tree"]') =>
    must(view.container.querySelector<HTMLButtonElement>(`${scope} [data-equipment-id="${id}"]`), `row ${id}`);
  const log = (view: AppView) => Array.from(view.container.querySelectorAll('[aria-label="Adapter log"] li')).map((li) => li.textContent);
  const send = (view: AppView, text: string) => {
    view.type(must(view.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask MIRA"]'), "Ask MIRA"), text);
    view.submit(must(view.container.querySelector<HTMLFormElement>('form[aria-label="Composer"]'), "composer"));
  };

  it("is addressable from the URL and mirrored back", () => {
    expect(parseLabState("?nav=equipment").nav).toBe("equipment");
    expect(parseLabState("?nav=nope").nav).toBe("projects");
    const view = renderApp("?nav=equipment");
    expect(view.search()).toContain("nav=equipment");
    expect(view.container.querySelector('[role="tree"][aria-label="Equipment"]')).not.toBeNull();
    // The project tree is replaced, not shown beside it.
    expect(view.container.querySelector("#fl-nav-projects")).toBeNull();
  });

  it("control: the default lab still shows the project tree and no target bar", () => {
    const view = renderApp();
    expect(view.container.querySelector("#fl-nav-projects")).not.toBeNull();
    expect(view.container.querySelector('[aria-label="Question target"]')).toBeNull();
  });

  it("starts with the bench drive as the target and its row marked", () => {
    const view = renderApp("?nav=equipment");
    expect(target(view)).toBe("VFD1 on GS10 bench");
    expect(row(view, "c-vfd1-bench").dataset.target).toBe("true");
    // The target bar lives inside the composer, so it stays with the sticky composer on a phone.
    expect(view.container.querySelector('form[aria-label="Composer"] [aria-label="Question target"]')).not.toBeNull();
  });

  it("browsing another component does NOT change the target; the bar says where questions go", () => {
    const view = renderApp("?nav=equipment");
    view.click(row(view, "c-plc1-bench"));
    expect(row(view, "c-plc1-bench").dataset.browsing).toBe("true");
    expect(target(view)).toBe("VFD1 on GS10 bench");
    // Exactly one "Ask about" in the tree: on the row being browsed, nowhere else.
    const treeAsks = Array.from(view.container.querySelectorAll('[role="tree"] .fl-equip__ask')).map((b) => b.textContent);
    expect(treeAsks).toEqual(["Ask about PLC1"]);
    const status = must(view.container.querySelector('.fl-qtarget__browsing'), "browsing notice").textContent ?? "";
    expect(status).toContain("Browsing PLC1 on GS10 bench. Questions still go to VFD1 on GS10 bench.");
    // A send while browsing still goes to the old target.
    send(view, "What is the fault code?");
    expect(log(view)).toContain("send:target=m-gs10-bench/c-vfd1-bench");
  });

  it("an explicit Ask about moves the target, and the next send carries it", () => {
    const view = renderApp("?nav=equipment");
    view.click(row(view, "c-plc1-bench"));
    view.click(must(view.buttonNamed("Ask about PLC1"), "Ask about PLC1"));
    expect(target(view)).toBe("PLC1 on GS10 bench");
    expect(log(view)).toContain("askAbout:m-gs10-bench/c-plc1-bench");
    expect(view.container.querySelector('.fl-qtarget__browsing')).toBeNull();
    send(view, "What is the fault code?");
    expect(log(view)).toContain("send:target=m-gs10-bench/c-plc1-bench");
  });

  // #5561 review F1: the send line is read back from the turn the send made, so
  // these prove the turn itself carries the target, not just the bar.
  const lastSend = (view: AppView) => log(view).filter((entry) => entry?.startsWith("send:")).at(-1);

  it("the sent turn records the target, not the scenario's own machine", () => {
    const view = renderApp("?nav=equipment&scenario=machine-ask");
    view.click(row(view, "c-plc1-bench"));
    view.click(must(view.buttonNamed("Ask about PLC1"), "Ask about PLC1"));
    send(view, "What does the RUN light mean?");
    expect(lastSend(view)).toBe("send:target=m-gs10-bench/c-plc1-bench");
  });

  it("browsing the other VFD1 and sending again still sends to PLC1; asking about it moves the next send", () => {
    const view = renderApp("?nav=equipment");
    view.click(row(view, "c-plc1-bench"));
    view.click(must(view.buttonNamed("Ask about PLC1"), "Ask about PLC1"));
    send(view, "First question");
    view.click(row(view, "line-2"));
    view.click(row(view, "m-conveyor-2"));
    view.click(row(view, "c-vfd1-line2"));
    send(view, "Second question");
    expect(lastSend(view)).toBe("send:target=m-gs10-bench/c-plc1-bench");
    view.click(must(view.buttonNamed("Ask about VFD1"), "Ask about VFD1"));
    send(view, "Third question");
    expect(lastSend(view)).toBe("send:target=m-conveyor-2/c-vfd1-line2");
    expect(log(view).filter((entry) => entry?.startsWith("send:"))).toHaveLength(3);
  });

  it("expanding a line or a machine never changes the target", () => {
    const view = renderApp("?nav=equipment");
    view.click(row(view, "area-garage"));
    view.click(row(view, "area-garage"));
    view.click(row(view, "line-2"));
    view.click(row(view, "m-conveyor-2"));
    expect(target(view)).toBe("VFD1 on GS10 bench");
    expect(log(view).some((entry) => entry?.startsWith("askAbout:"))).toBe(false);
  });

  it("the two VFD1 rows show where they are", () => {
    const view = renderApp("?nav=equipment");
    view.click(row(view, "line-2"));
    view.click(row(view, "m-conveyor-2"));
    expect(row(view, "c-vfd1-bench").querySelector(".fl-equip__place")?.textContent).toBe("Bench line › GS10 bench");
    expect(row(view, "c-vfd1-line2").querySelector(".fl-equip__place")?.textContent).toBe("Line 2 › Conveyor 2");
    // The full path stays available as the row's tooltip.
    expect(row(view, "c-vfd1-line2").querySelector(".fl-equip__place")?.getAttribute("title")).toBe("Lake Wales plant › Garage › Line 2 › Conveyor 2");
    // Control: a unique tag stays compact.
    expect(row(view, "c-plc1-bench").querySelector(".fl-equip__place")).toBeNull();
  });

  it("search bypasses the tree; asking from a result targets that exact VFD1", () => {
    const view = renderApp("?nav=equipment");
    const input = must(view.container.querySelector<HTMLInputElement>('input[aria-label="Search equipment"]'), "search");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "vfd1");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const results = '[aria-label="Equipment search results"]';
    expect(view.container.querySelectorAll(`${results} [data-equipment-id]`).length).toBe(2);
    view.click(row(view, "c-vfd1-line2", results));
    view.click(must(view.buttonNamed("Ask about VFD1"), "Ask about VFD1"));
    expect(target(view)).toBe("VFD1 on Conveyor 2");
  });

  it("a targeted row joins Recent, and Recent rows show their place", () => {
    const view = renderApp("?nav=equipment");
    view.click(row(view, "c-plc1-bench"));
    view.click(must(view.buttonNamed("Ask about PLC1"), "Ask about PLC1"));
    const recent = row(view, "c-plc1-bench", '[aria-label="Recent equipment"]');
    expect(recent.textContent).toContain("GS10 bench");
  });

  it("site, area and line rows offer no Ask about", () => {
    const view = renderApp("?nav=equipment");
    view.click(row(view, "line-bench"));
    expect(Array.from(view.container.querySelectorAll(".fl-equip__ask")).length).toBe(0);
  });
});
