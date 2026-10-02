/**
 * The demo's polling loop.
 *
 * The properties that matter here are the ones that only fail in the wild: a
 * cycle that overlaps the previous one and advances the simulation twice, a
 * timer that keeps firing after the component is gone, a control that races the
 * poll it was meant to reset.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  SimLabClient,
  SimLabUnavailable,
  type FetchLike,
} from "@factorylm/interaction";
import { pollOnce, readStatics, useSimLabDemo, type SimLabDemoController } from "../useSimLabDemo";

const LINE = "enterprise.florida_natural_demo.plant1.juice_bottling.line01";

const TAGS = [
  { tag: "speed_fpm", category: "process", unit: "fpm", uns_path: `${LINE}.x.process.speed_fpm` },
  { tag: "motor_current_amps", category: "motor", unit: "A", uns_path: `${LINE}.x.motor.motor_current_amps` },
  { tag: "blocked", category: "status", unit: "", uns_path: `${LINE}.x.status.blocked` },
  { tag: "jam_detected", category: "status", unit: "", uns_path: `${LINE}.x.status.jam_detected` },
  { tag: "case_count", category: "production", unit: "", uns_path: `${LINE}.x.production.case_count` },
  { tag: "glue_temperature", category: "process", unit: "°F", uns_path: `${LINE}.x.process.glue_temperature` },
  { tag: "fault_code", category: "faults", unit: "", uns_path: `${LINE}.x.faults.fault_code` },
];

/** A tiny in-memory SimLab: enough tick/alarm behaviour to exercise the loop. */
class FakeSim {
  tick = 0;
  jam = false;
  readonly calls: string[] = [];
  /**
   * Every request the loop ATTEMPTED, aborted ones included.
   *
   * `calls` counts what a server would see, and an aborted fetch never reaches
   * one — so a loop still spinning against a dead component is invisible there.
   * The leak is the loop running at all, so that is what gets counted.
   */
  attempts = 0;
  failWith: string | null = null;
  delayMs = 0;
  /** Applies only to start/reset, so a control window can outlast a cycle. */
  controlDelayMs = 0;
  /**
   * Concurrent TICK requests, and the total tick count.
   *
   * Counting concurrent requests of any kind was the first attempt and it
   * measured the wrong thing: one cycle legitimately issues `snapshot` and
   * `alarms` together via `Promise.all`, so the metric read 2 on a loop that
   * was behaving perfectly. A cycle is bracketed by its tick, so ticks are what
   * distinguish cycles from the requests inside one.
   */
  maxConcurrentTicks = 0;
  tickCalls = 0;
  private ticksInFlight = 0;

  readonly fetch: FetchLike = async (input, init) => {
    const path = input.replace("http://sim.test", "");
    // Honour the abort signal, because real `fetch` does. Ignoring it was the
    // first version of this fake, and it made a genuine guard look broken: at
    // unmount the in-flight cycle carried on issuing its snapshot and alarms
    // reads, which a browser would have cancelled.
    this.attempts += 1;
    if (init?.signal?.aborted) throw new Error("aborted");
    this.calls.push(`${init?.method ?? "GET"} ${path}`);
    const isTick = path.startsWith("/simlab/scenario/tick");
    if (isTick) {
      this.tickCalls += 1;
      this.ticksInFlight += 1;
      this.maxConcurrentTicks = Math.max(this.maxConcurrentTicks, this.ticksInFlight);
    }
    try {
      const isControl = path.endsWith("/start") || path.endsWith("/reset");
      const delay = isControl ? this.controlDelayMs || this.delayMs : this.delayMs;
      if (delay) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, delay);
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
          });
        });
      }
      if (this.failWith) throw new Error(this.failWith);
      if (path.startsWith("/simlab/scenario/tick")) {
        this.tick += Number(new URL(`http://x${path}`).searchParams.get("n") ?? 1);
      } else if (path.endsWith("/start")) {
        this.tick = 0;
        this.jam = true;
      } else if (path.endsWith("/reset")) {
        this.tick = 0;
        this.jam = false;
      }
      return { ok: true, status: 200, json: async () => this.body(path), text: async () => "" };
    } finally {
      if (isTick) this.ticksInFlight -= 1;
    }
  };

  private body(path: string): unknown {
    if (path.includes("/tags")) return TAGS;
    if (path.includes("/docs")) return ["troubleshooting.md"];
    if (path.startsWith("/simlab/alarms")) {
      return this.jam
        ? [{ asset_id: "casepacker01", code: "CP-JAM", severity: "fault", message: "jam", since_tick: 10 }]
        : [];
    }
    if (path.startsWith("/simlab/snapshot")) {
      const tags: Record<string, number | boolean | string> = {};
      for (const id of ["conveyorzone01", "conveyorzone02"]) {
        tags[`${LINE}.${id}.process.speed_fpm`] = 60;
        tags[`${LINE}.${id}.motor.motor_current_amps`] = 3.2;
        tags[`${LINE}.${id}.status.blocked`] = this.jam && id === "conveyorzone02";
        tags[`${LINE}.${id}.faults.fault_code`] = "";
      }
      tags[`${LINE}.casepacker01.status.jam_detected`] = this.jam;
      tags[`${LINE}.casepacker01.production.case_count`] = 3;
      tags[`${LINE}.casepacker01.process.glue_temperature`] = 340;
      tags[`${LINE}.casepacker01.faults.fault_code`] = this.jam ? "CP001" : "";
      return { tick: this.tick, tags };
    }
    return { tick: this.tick };
  }

  client(): SimLabClient {
    return new SimLabClient({ baseUrl: "http://sim.test", fetch: this.fetch });
  }
}

interface Harness {
  readonly controller: () => SimLabDemoController;
  cleanup(): void;
}

const harnesses: Harness[] = [];
afterEach(() => { harnesses.splice(0).forEach((harness) => harness.cleanup()); });

function mount(client: SimLabClient, options: { pollMs?: number; ticksPerPoll?: number; now?: () => number } = {}): Harness {
  const container = document.createElement("div");
  document.body.append(container);
  let latest: SimLabDemoController | null = null;
  function Probe() {
    latest = useSimLabDemo({ client, pollMs: options.pollMs ?? 5, ticksPerPoll: options.ticksPerPoll ?? 2, ...(options.now ? { now: options.now } : {}) });
    return null;
  }
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(<Probe />);
  });
  const harness: Harness = {
    controller: () => {
      if (!latest) throw new Error("hook did not render");
      return latest;
    },
    cleanup: () => act(() => { root.unmount(); container.remove(); }),
  };
  harnesses.push(harness);
  return harness;
}

/**
 * Let the loop run for a while.
 *
 * Deliberately NOT wrapped in `act`. `act` waits for React to have no further
 * scheduled work, and this loop schedules its next cycle forever by design, so
 * an `act`-wrapped sleep never resolves — every timing test here hung for the
 * full 5 s timeout until the wrapper came off. Updates therefore land outside
 * `act` and React logs its warning; the alternative is a loop that stops
 * rescheduling, which would be changing the product to suit the harness.
 */
async function settle(ms = 60) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// --- the pure cycle --------------------------------------------------------

describe("one poll cycle", () => {
  const statics = { tagDefs: {}, documents: {} };

  it("advances the simulation, then reads it", async () => {
    const sim = new FakeSim();
    await pollOnce(sim.client(), statics, { ticks: 3, now: 0, staleAfterMs: 5000 });
    expect(sim.tick).toBe(3);
    const order = sim.calls.map((call) => call.split(" ")[1].split("?")[0]);
    expect(order[0]).toBe("/simlab/scenario/tick");
    expect(order.slice(1).sort()).toEqual(["/simlab/alarms", "/simlab/snapshot"]);
  });

  it("does not advance when asked for zero ticks", async () => {
    const sim = new FakeSim();
    await pollOnce(sim.client(), statics, { ticks: 0, now: 0, staleAfterMs: 5000 });
    expect(sim.tick).toBe(0);
    expect(sim.calls.some((call) => call.includes("/tick"))).toBe(false);
  });

  it("reports the failure rather than a state it did not read", async () => {
    const sim = new FakeSim();
    sim.failWith = "ECONNREFUSED";
    const result = await pollOnce(sim.client(), statics, { ticks: 1, now: 0, staleAfterMs: 5000 });
    expect(result).toEqual({ ok: false, error: "ECONNREFUSED" });
  });

  it("treats an unreadable payload as not knowing, not as an empty machine", async () => {
    const client = new SimLabClient({
      baseUrl: "http://x",
      fetch: async (input) => ({
        ok: true,
        status: 200,
        json: async () => (input.includes("alarms") ? [] : { nonsense: true }),
        text: async () => "",
      }),
    });
    const result = await pollOnce(client, statics, { ticks: 0, now: 0, staleAfterMs: 5000 });
    expect(result).toEqual({ ok: false, error: "unreadable response from SimLab" });
  });

  it("reads each demo asset's tag definitions and documents once", async () => {
    const sim = new FakeSim();
    const statics2 = await readStatics(sim.client());
    expect(Object.keys(statics2.tagDefs).sort()).toEqual(["casepacker01", "conveyorzone01", "conveyorzone02"]);
    expect(statics2.documents.casepacker01).toEqual(["troubleshooting.md"]);
  });
});

// --- the loop --------------------------------------------------------------

describe("the polling loop", () => {
  it("survives a StrictMode remount without a stale cycle resurrecting itself", async () => {
    /**
     * The browser-only defect, reproduced.
     *
     * StrictMode mounts, tears down, and mounts again. Liveness used to be a
     * `useRef` shared by both runs, so the first run's cleanup set it false, the
     * second run's body set it true, and the first run's still-in-flight cycle
     * then saw `true` and scheduled a SECOND loop — one holding the controller
     * that had just been aborted. Every read on it threw "signal is aborted
     * without reason", and the view flapped to `offline` against a healthy
     * simulator while the good loop kept repairing it.
     *
     * The tell is the error text, so that is what this asserts: no reading on
     * screen may be attributed to an abort we caused ourselves.
     */
    const sim = new FakeSim();
    sim.delayMs = 8; // a cycle must still be in flight when the first cleanup runs
    const container = document.createElement("div");
    document.body.append(container);
    let latest: SimLabDemoController | null = null;
    function Probe() {
      latest = useSimLabDemo({ client: sim.client(), pollMs: 4 });
      return null;
    }
    let root: Root;
    act(() => {
      root = createRoot(container);
      root.render(<StrictMode><Probe /></StrictMode>);
    });
    harnesses.push({ controller: () => latest!, cleanup: () => act(() => { root.unmount(); container.remove(); }) });

    await settle(150);
    expect(latest!.state.error).toBeNull();
    expect(latest!.state.connection).toBe("live");
  });

  it("resets the line once before the first read, so the visitor starts healthy", async () => {
    // SimLab is a stateful process and keeps whatever scenario was last loaded.
    // Without this the demo inherits it and opens on a jam nobody injected —
    // which is exactly how the first browser proof failed, against a SimLab
    // still jammed from the run before.
    const sim = new FakeSim();
    sim.jam = true;
    const harness = mount(sim.client(), { pollMs: 4 });
    await settle(60);
    expect(sim.calls.filter((call) => call.includes("/scenario/reset"))).toHaveLength(1);
    expect(harness.controller().state.alarms).toEqual([]);
    expect(harness.controller().state.assets.every((a) => a.condition === "running")).toBe(true);
  });

  it("leaves the line alone when told not to reset", async () => {
    const sim = new FakeSim();
    sim.jam = true;
    const container = document.createElement("div");
    document.body.append(container);
    let latest: SimLabDemoController | null = null;
    function Probe() {
      latest = useSimLabDemo({ client: sim.client(), pollMs: 4, resetOnStart: false });
      return null;
    }
    let root: Root;
    act(() => { root = createRoot(container); root.render(<Probe />); });
    harnesses.push({ controller: () => latest!, cleanup: () => act(() => { root.unmount(); container.remove(); }) });
    await settle(60);
    expect(sim.calls.some((call) => call.includes("/scenario/reset"))).toBe(false);
    expect(latest!.state.alarms.length).toBeGreaterThan(0);
  });

  it("starts in connecting and reaches live", async () => {
    const sim = new FakeSim();
    const harness = mount(sim.client());
    expect(harness.controller().state.connection).toBe("connecting");
    await settle();
    expect(harness.controller().state.connection).toBe("live");
    expect(harness.controller().state.assets).toHaveLength(3);
  });

  it("never runs two cycles at once, even when reads are slower than the interval", async () => {
    // Each cycle costs at least two 12 ms round trips (tick, then
    // snapshot+alarms), so ~140 ms of wall clock allows roughly five sequential
    // cycles however small the poll interval is. A `setInterval` firing every
    // 1 ms would overlap and advance the simulation dozens of times — which is
    // the defect: the demo's tick counter is its clock, and a loop that
    // double-advances makes the visitor's timeline untrue.
    const sim = new FakeSim();
    sim.delayMs = 12;
    mount(sim.client(), { pollMs: 1 });
    await settle(140);
    expect(sim.maxConcurrentTicks).toBeLessThanOrEqual(1);
    expect(sim.tickCalls).toBeLessThanOrEqual(8);
  });

  it("stops polling on unmount and issues no further requests", async () => {
    const sim = new FakeSim();
    const harness = mount(sim.client(), { pollMs: 2 });
    await settle(40);
    const before = sim.calls.length;
    expect(before).toBeGreaterThan(2);
    harness.cleanup();
    harnesses.length = 0;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(sim.calls.length).toBe(before);
  });

  it("stops even when unmounted mid-cycle, with no timer pending to cancel", async () => {
    // The case the previous test cannot reach. With a request in flight there
    // IS no pending timer, so `clearTimeout` cancels nothing; the only thing
    // stopping the in-flight cycle from scheduling its successor is the live
    // flag. Removing it leaves a loop polling forever against an unmounted
    // component — invisible in the common path, and exactly the leak this
    // asserts.
    const sim = new FakeSim();
    sim.delayMs = 20;
    const harness = mount(sim.client(), { pollMs: 1 });
    await settle(25); // mid-cycle: a request is in flight, no timer waiting
    harness.cleanup();
    harnesses.length = 0;
    const atUnmount = sim.attempts;
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(sim.attempts).toBe(atUnmount);
  });

  it("degrades to offline with the reason, keeps the last readings, and recovers on its own", async () => {
    const sim = new FakeSim();
    const harness = mount(sim.client(), { pollMs: 2 });
    await settle(40);
    expect(harness.controller().state.connection).toBe("live");
    const lastGood = harness.controller().state.assets;

    sim.failWith = "ECONNREFUSED";
    await settle(40);
    expect(harness.controller().state.connection).toBe("offline");
    expect(harness.controller().state.error).toBe("ECONNREFUSED");
    expect(harness.controller().state.assets).toEqual(lastGood);

    sim.failWith = null;
    await settle(60);
    expect(harness.controller().state.connection).toBe("live");
    expect(harness.controller().state.error).toBeNull();
  });

  it("a failure before the first successful read shows no machine at all", async () => {
    const sim = new FakeSim();
    sim.failWith = "ECONNREFUSED";
    const harness = mount(sim.client(), { pollMs: 2 });
    await settle(40);
    expect(harness.controller().state.connection).toBe("offline");
    expect(harness.controller().state.assets).toEqual([]);
  });

  it("calls the injected clock rather than reading Date directly", async () => {
    let calls = 0;
    const sim = new FakeSim();
    mount(sim.client(), { pollMs: 3, now: () => { calls += 1; return 1_000; } });
    await settle(40);
    expect(calls).toBeGreaterThan(0);
  });
});

// --- the controls ----------------------------------------------------------

describe("inject and reset", () => {
  it("injecting loads the jam scenario and advances past its onset", async () => {
    const sim = new FakeSim();
    const harness = mount(sim.client(), { pollMs: 4 });
    await settle(40);
    await harness.controller().injectJam();
    await settle(40);

    expect(sim.calls.some((call) => call.includes("/simlab/scenario/casepacker_jam_upstream_block/start"))).toBe(true);
    const packer = harness.controller().state.assets.find((asset) => asset.assetId === "casepacker01");
    expect(packer?.condition).toBe("faulted");
    expect(packer?.faultCode).toBe("CP001");
    expect(harness.controller().state.assets.find((a) => a.assetId === "conveyorzone02")?.condition).toBe("blocked");
  });

  it("reset returns the line to healthy with no alarms", async () => {
    const sim = new FakeSim();
    const harness = mount(sim.client(), { pollMs: 4 });
    await settle(40);
    await harness.controller().injectJam();
    await settle(40);
    expect(harness.controller().state.alarms.length).toBeGreaterThan(0);

    await harness.controller().reset();
    await settle(40);
    expect(harness.controller().state.alarms).toEqual([]);
    expect(harness.controller().state.assets.every((asset) => asset.condition === "running")).toBe(true);
  });

  it("the loop does not advance the simulation while a control is running", async () => {
    // Otherwise a poll landing mid-reset ticks the engine past the baseline and
    // the "healthy" state the visitor was promised is already drifting.
    const sim = new FakeSim();
    const harness = mount(sim.client(), { pollMs: 5 });
    await settle(40);

    // Baseline taken BEFORE the control starts. Sampling after it has begun was
    // the first version of this test, and it counted a tick issued at the top of
    // the window as if it had preceded the control — so a loop that ticked
    // right through the reset still passed.
    const before = sim.tickCalls;
    // Only the CONTROL is slow. Slowing every read instead was the earlier
    // version, and it made each cycle longer than the control window — so at
    // most one tick could land either way and a loop that ignored the control
    // entirely still passed.
    sim.controlDelayMs = 60;
    const resetting = harness.controller().reset();
    await resetting;

    // At most one tick: a cycle already in flight when the control began is not
    // a violation. A loop that ignored the control would fire ~8 in this window.
    expect(sim.tickCalls).toBeLessThanOrEqual(before + 1);
    expect(sim.tick).toBe(0);
  });

  it("a failed control reports the failure instead of pretending it worked", async () => {
    const sim = new FakeSim();
    const harness = mount(sim.client(), { pollMs: 50 });
    await settle(30);
    sim.failWith = "ECONNREFUSED";
    await harness.controller().injectJam();
    await settle(5); // let the state update render before reading it
    expect(harness.controller().state.connection).toBe("offline");
    expect(harness.controller().state.error).toBe("ECONNREFUSED");
  });

  it("reports busy while a control is in flight and clears it after", async () => {
    const sim = new FakeSim();
    sim.delayMs = 15;
    const harness = mount(sim.client(), { pollMs: 200 });
    await settle(60);
    const injecting = harness.controller().injectJam();
    await settle(5);
    const seenBusy = harness.controller().busy;
    await injecting;
    await settle(5); // let the cleared flag render before reading it
    expect(seenBusy).toBe(true);
    expect(harness.controller().busy).toBe(false);
  });
});

describe("transport failures surface as SimLabUnavailable", () => {
  it("names the cause rather than a generic message", async () => {
    const client = new SimLabClient({
      baseUrl: "http://x",
      fetch: async () => { throw new Error("getaddrinfo ENOTFOUND"); },
    });
    await expect(client.health()).rejects.toBeInstanceOf(SimLabUnavailable);
    const result = await pollOnce(client, { tagDefs: {}, documents: {} }, { ticks: 0, now: 0, staleAfterMs: 1 });
    expect(result).toEqual({ ok: false, error: "getaddrinfo ENOTFOUND" });
  });
});
