/**
 * The public machine view.
 *
 * The three-second test is the whole requirement, and it is testable: a visitor
 * must be able to tell running from blocked from faulted from stale without
 * reading a manual — which means every state is a WORD in the DOM, not only a
 * colour in an SVG, and nothing moves when the data underneath stops being
 * worth believing.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  PROFILES,
  buildDemoState,
  connectingDemoState,
  createShellState,
  getFixture,
  unavailableDemoState,
  type ShellState,
  type SimLabAlarm,
  type SimLabDemoState,
  type SimLabTagDef,
  type SurfaceKind,
} from "@factorylm/interaction";
import { MachineView } from "../MachineView";

const shell = readFileSync(new URL("../shell.css", import.meta.url), "utf8");

const LINE = "enterprise.florida_natural_demo.plant1.juice_bottling.line01";

const CONVEYOR_TAGS: SimLabTagDef[] = [
  { tag: "speed_fpm", category: "process", unit: "fpm", unsPath: `${LINE}.x.process.speed_fpm` },
  { tag: "motor_current_amps", category: "motor", unit: "A", unsPath: `${LINE}.x.motor.motor_current_amps` },
  { tag: "blocked", category: "status", unit: "", unsPath: `${LINE}.x.status.blocked` },
  { tag: "fault_code", category: "faults", unit: "", unsPath: `${LINE}.x.faults.fault_code` },
];
const PACKER_TAGS: SimLabTagDef[] = [
  { tag: "jam_detected", category: "status", unit: "", unsPath: `${LINE}.casepacker01.status.jam_detected` },
  { tag: "case_count", category: "production", unit: "", unsPath: `${LINE}.casepacker01.production.case_count` },
  { tag: "glue_temperature", category: "process", unit: "°F", unsPath: `${LINE}.casepacker01.process.glue_temperature` },
  { tag: "fault_code", category: "faults", unit: "", unsPath: `${LINE}.casepacker01.faults.fault_code` },
];
const TAG_DEFS = { conveyorzone01: CONVEYOR_TAGS, conveyorzone02: CONVEYOR_TAGS, casepacker01: PACKER_TAGS };
const DOCS = { conveyorzone01: ["troubleshooting.md"], conveyorzone02: ["troubleshooting.md"], casepacker01: ["troubleshooting.md"] };

function tagMap(overrides: Record<string, number | boolean | string> = {}) {
  const base: Record<string, number | boolean | string> = {};
  for (const id of ["conveyorzone01", "conveyorzone02"]) {
    base[`${LINE}.${id}.process.speed_fpm`] = 60;
    base[`${LINE}.${id}.motor.motor_current_amps`] = 3.2;
    base[`${LINE}.${id}.status.blocked`] = false;
    base[`${LINE}.${id}.faults.fault_code`] = "";
  }
  base[`${LINE}.casepacker01.status.jam_detected`] = false;
  base[`${LINE}.casepacker01.production.case_count`] = 12;
  base[`${LINE}.casepacker01.process.glue_temperature`] = 340;
  base[`${LINE}.casepacker01.faults.fault_code`] = "";
  return { ...base, ...overrides };
}

const JAM_ALARMS: SimLabAlarm[] = [
  { assetId: "conveyorzone02", code: "C2-BLOCKED", severity: "warn", message: "ConveyorZone02: zone blocked — downstream backup.", sinceTick: 1 },
  { assetId: "casepacker01", code: "CP-JAM", severity: "fault", message: "CasePacker01: infeed jam detected — clear and restart.", sinceTick: 10 },
];

function demoState(
  overrides: Record<string, number | boolean | string> = {},
  alarms: SimLabAlarm[] = [],
  clock: { observedAt: number; now: number } = { observedAt: 1_000, now: 1_000 },
): SimLabDemoState {
  return buildDemoState({
    snapshot: { tick: 40, tags: tagMap(overrides) },
    alarms,
    tagDefs: TAG_DEFS,
    documents: DOCS,
    observedAt: clock.observedAt,
    now: clock.now,
    staleAfterMs: 5_000,
  });
}

const HEALTHY = () => demoState();
const JAMMED = () => demoState(
  {
    [`${LINE}.conveyorzone02.status.blocked`]: true,
    [`${LINE}.casepacker01.status.jam_detected`]: true,
    [`${LINE}.casepacker01.faults.fault_code`]: "CP001",
  },
  JAM_ALARMS,
);

interface View {
  readonly container: HTMLDivElement;
  cleanup(): void;
}

const views: View[] = [];
afterEach(() => { views.splice(0).forEach((view) => view.cleanup()); });

function shellState(surface: SurfaceKind): ShellState {
  return createShellState(getFixture("grounded-answer"), PROFILES[surface]);
}

function render(
  demo: SimLabDemoState,
  options: { surface?: SurfaceKind; onInject?: () => void; onReset?: () => void; busy?: boolean } = {},
): View {
  const container = document.createElement("div");
  document.body.append(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(<MachineView
      state={shellState(options.surface ?? "public")}
      demo={demo}
      {...(options.onInject ? { onInject: options.onInject } : {})}
      {...(options.onReset ? { onReset: options.onReset } : {})}
      {...(options.busy !== undefined ? { busy: options.busy } : {})}
    />);
  });
  const view: View = { container, cleanup: () => act(() => { root.unmount(); container.remove(); }) };
  views.push(view);
  return view;
}

function asset(view: View, assetId: string): HTMLElement {
  const el = view.container.querySelector<HTMLElement>(`.fl-machine__asset[data-asset="${assetId}"]`);
  if (!el) throw new Error(`no asset row for ${assetId}`);
  return el;
}

// --- public only -----------------------------------------------------------

describe("the machine view belongs to the public surface only", () => {
  it("renders on a publicDemo profile", () => {
    expect(render(HEALTHY()).container.querySelector(".fl-machine")).not.toBeNull();
  });

  it("renders nothing on web, mobile or hub", () => {
    for (const surface of ["web", "mobile", "hub"] as const) {
      const view = render(HEALTHY(), { surface });
      expect(view.container.querySelector(".fl-machine"), surface).toBeNull();
      expect(view.container.textContent, surface).toBe("");
    }
  });

  it("never renders an inspector, on any surface", () => {
    // The public profile has enterpriseInspector: false; the machine view must
    // not become a back door to an enterprise panel.
    for (const surface of ["public", "hub"] as const) {
      const view = render(JAMMED(), { surface });
      expect(view.container.querySelector('[aria-label="Inspector"]')).toBeNull();
    }
  });
});

// --- the three-second test -------------------------------------------------

describe("every state is a word, not only a colour", () => {
  it("a healthy line says Running on all three assets", () => {
    const view = render(HEALTHY());
    for (const id of ["conveyorzone01", "conveyorzone02", "casepacker01"]) {
      expect(asset(view, id).textContent).toContain("Running");
    }
    expect(view.container.querySelector(".fl-machine__alarms")).toBeNull();
  });

  it("the jam says Faulted on the packer and Blocked upstream, with the evidence", () => {
    const view = render(JAMMED());
    expect(asset(view, "casepacker01").textContent).toContain("Faulted");
    expect(asset(view, "casepacker01").textContent).toContain("CP-JAM");
    expect(asset(view, "conveyorzone02").textContent).toContain("Blocked");
    expect(asset(view, "conveyorzone02").textContent).toContain("C2-BLOCKED");
    expect(asset(view, "conveyorzone01").textContent).toContain("Running");
  });

  it("shows the active PLC fault code verbatim, because that is what gets looked up", () => {
    // Caught by the browser proof: CP001 was read from the snapshot, carried on
    // the demo state, and never rendered. A technician reads the code off the
    // panel and searches the fault-code table for it.
    expect(asset(render(JAMMED()), "casepacker01").textContent).toContain("CP001");
    // Absent when the machine is not publishing one — never an empty badge.
    expect(asset(render(HEALTHY()), "casepacker01").querySelector(".fl-machine__asset-fault")).toBeNull();
  });

  it("lists the active alarms with code, message and onset", () => {
    const alarms = render(JAMMED()).container.querySelectorAll(".fl-machine__alarm");
    expect(alarms).toHaveLength(2);
    const fault = Array.from(alarms).find((node) => node.getAttribute("data-severity") === "fault");
    expect(fault?.textContent).toContain("CP-JAM");
    expect(fault?.textContent).toContain("infeed jam detected");
    expect(fault?.textContent).toContain("since tick 10");
  });

  it("shows each signal with its real unit and no invented ones", () => {
    const zone = asset(render(HEALTHY()), "conveyorzone01").textContent ?? "";
    expect(zone).toContain("60 fpm");
    expect(zone).toContain("3.2 A");
    expect(zone).toContain("Zone blocked");
    expect(zone).toContain("No");
    // Undriven tags are absent: see UNDRIVEN_TAGS in the bridge.
    expect(zone).not.toContain("Idle");
    expect(zone).not.toContain("accumulation");
  });

  it("the diagram is decorative; the meaning is in real DOM", () => {
    const view = render(JAMMED());
    const svg = view.container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("focusable")).toBe("false");
    // Removing the SVG must lose nothing a reader needs.
    svg?.remove();
    const text = view.container.textContent ?? "";
    for (const word of ["Conveyor Zone 01", "Conveyor Zone 02", "Case Packer 01", "Faulted", "Blocked", "Running"]) {
      expect(text, word).toContain(word);
    }
  });

  it("is a bounded strip, so the conversation stays the page", () => {
    expect(shell).toMatch(/\.fl-machine__diagram\s*\{[^}]*max-block-size:\s*7rem/s);
    const mobile = shell.slice(shell.indexOf("@media (max-width: 48rem)"));
    expect(mobile).toMatch(/\.fl-machine__diagram\s*\{[^}]*max-block-size:\s*5rem/s);
    expect(mobile).toMatch(/\.fl-machine__assets\s*\{\s*grid-template-columns:\s*1fr/);
    // On a phone the panel is bounded and scrolls inside itself, so the
    // conversation is never pushed off the bottom of the screen.
    expect(mobile).toMatch(/\.fl-machine\s*\{[^}]*max-block-size:\s*52dvh/s);
    expect(mobile).toMatch(/\.fl-machine\s*\{[^}]*overflow-y:\s*auto/s);
  });
});

// --- motion is evidence ----------------------------------------------------

describe("motion says what the data says, and stops when the data cannot be trusted", () => {
  const zoneOf = (view: View, assetId: string) =>
    view.container.querySelector<SVGElement>(`.fl-machine__zone[data-asset="${assetId}"]`);

  it("a healthy zone runs its belt and advances its product", () => {
    const zone = zoneOf(render(HEALTHY()), "conveyorzone01");
    expect(zone?.getAttribute("data-belt")).toBe("running");
    expect(zone?.getAttribute("data-product")).toBe("moving");
  });

  it("during the jam the belt keeps turning and the product is held", () => {
    // The snapshot says blocked = true AND speed_fpm ≈ 60. Drawing a stopped
    // belt would contradict the number on the same screen; holding the cases is
    // what backpressure actually looks like.
    const zone = zoneOf(render(JAMMED()), "conveyorzone02");
    expect(zone?.getAttribute("data-belt")).toBe("running");
    expect(zone?.getAttribute("data-product")).toBe("held");
  });

  it("a stale reading stops every animation and says the data is stale", () => {
    const view = render(demoState({}, [], { observedAt: 1_000, now: 20_000 }));
    expect(view.container.querySelector(".fl-machine")?.getAttribute("data-connection")).toBe("stale");
    expect(view.container.textContent).toContain("Data is stale");
    for (const id of ["conveyorzone01", "conveyorzone02"]) {
      expect(zoneOf(view, id)?.getAttribute("data-belt")).toBe("stopped");
      expect(zoneOf(view, id)?.getAttribute("data-product")).toBe("stopped");
    }
  });

  it("an unreachable simulator keeps the last readings, stops motion and names the failure", () => {
    const view = render(unavailableDemoState(HEALTHY(), "ECONNREFUSED", 30_000));
    expect(view.container.querySelector(".fl-machine")?.getAttribute("data-connection")).toBe("offline");
    expect(view.container.textContent).toContain("Simulator unreachable");
    expect(view.container.textContent).toContain("ECONNREFUSED");
    expect(zoneOf(view, "conveyorzone01")?.getAttribute("data-belt")).toBe("stopped");
    // The machine is still on screen — hiding it would be the other kind of lie.
    expect(asset(view, "conveyorzone01").textContent).toContain("60 fpm");
  });

  it("before the first read it says connecting and draws no machine", () => {
    const view = render(connectingDemoState());
    expect(view.container.textContent).toContain("Connecting");
    expect(view.container.querySelector("svg")).toBeNull();
    expect(view.container.textContent).toContain("python -m simlab");
  });

  it("belt duration comes from the belt's own speed", () => {
    const fast = zoneOf(render(demoState({ [`${LINE}.conveyorzone01.process.speed_fpm`]: 120 })), "conveyorzone01");
    const slow = zoneOf(render(demoState({ [`${LINE}.conveyorzone01.process.speed_fpm`]: 30 })), "conveyorzone01");
    const read = (node: SVGElement | null) => Number((node?.getAttribute("style") ?? "").match(/([\d.]+)s/)?.[1]);
    expect(read(fast)).toBeLessThan(read(slow));
  });

  it("honours prefers-reduced-motion, including the belt", () => {
    const reduced = shell.slice(shell.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain(".fl-machine__belt-run");
    expect(reduced).toContain(".fl-machine__case");
    expect(reduced).toMatch(/animation:\s*none/);
  });

  it("nothing blinks", () => {
    expect(shell).not.toMatch(/animation:[^;]*blink/i);
    const machineCss = shell.slice(shell.indexOf(".fl-machine {"));
    expect(machineCss).not.toMatch(/@keyframes\s+\w*blink/i);
  });
});

// --- controls --------------------------------------------------------------

describe("the fault-injection controls", () => {
  it("offers inject and reset when the host provides them", () => {
    const calls: string[] = [];
    const view = render(HEALTHY(), { onInject: () => calls.push("inject"), onReset: () => calls.push("reset") });
    const inject = view.container.querySelector<HTMLButtonElement>('[data-action="inject"]');
    const reset = view.container.querySelector<HTMLButtonElement>('[data-action="reset"]');
    expect(inject?.textContent).toContain("Inject case-packer jam");
    expect(reset?.textContent).toContain("Reset to healthy");
    act(() => { inject?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    act(() => { reset?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(calls).toEqual(["inject", "reset"]);
  });

  it("states the limit rather than rendering dead buttons when no host is wired", () => {
    const view = render(HEALTHY());
    expect(view.container.querySelector("button")).toBeNull();
    expect(view.container.textContent).toContain("not wired up in this preview");
  });

  it("disables both while a control is in flight", () => {
    const view = render(HEALTHY(), { onInject: () => {}, onReset: () => {}, busy: true });
    for (const button of view.container.querySelectorAll("button")) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("inherits the shell's 44px touch target", () => {
    // .fl-shell button carries the minimum; the control adds no override that
    // would shrink it below that on a phone.
    expect(shell).toMatch(/\.fl-shell button\s*\{[^}]*min-block-size:\s*max\(2\.75rem,\s*44px\)/s);
    expect(shell).not.toMatch(/\.fl-machine__control\s*\{[^}]*min-block-size/s);
  });
});

// --- no ground truth reaches the screen ------------------------------------

describe("nothing on screen names the scenario", () => {
  it("the rendered text carries no scenario id, rubric wording or expected answer", () => {
    const text = render(JAMMED(), { onInject: () => {}, onReset: () => {} }).container.textContent ?? "";
    expect(text).not.toContain("casepacker_jam_upstream_block");
    expect(text.toLowerCase()).not.toContain("expected_");
    expect(text.toLowerCase()).not.toContain("root cause");
    expect(text.toLowerCase()).not.toContain("upstream backpressure");
  });
});
