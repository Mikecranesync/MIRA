/**
 * The SimLab bridge: what it reads, what it refuses to read, and what it does
 * when the answer is malformed or absent.
 *
 * The recurring assertion in this file is a negative one — the bridge does not
 * invent. A demo whose telemetry degrades into plausible-looking defaults is
 * indistinguishable from one that works, right up until someone trusts it.
 */
import { describe, expect, it } from "bun:test";
import {
  DEMO_ASSET_IDS,
  JAM_SCENARIO_ID,
  SIMLAB_ENDPOINTS,
  SIMLAB_LINE_PATH,
  SimLabClient,
  SimLabUnavailable,
  UNDRIVEN_TAGS,
  assetPath,
  buildDemoState,
  connectingDemoState,
  demoInspector,
  demoMachines,
  parseAlarms,
  parseDocNames,
  parseHealth,
  parseHistory,
  parseSnapshot,
  parseTagDefs,
  unavailableDemoState,
  type FetchLike,
  type SimLabAlarm,
  type SimLabDemoState,
  type SimLabTagDef,
} from "../simlab";

// --- fixtures mirroring real SimLab responses ------------------------------

const CONVEYOR_TAGS: SimLabTagDef[] = [
  { tag: "run_state", category: "status", unit: "", unsPath: `${SIMLAB_LINE_PATH}.x.status.run_state` },
  { tag: "motor_current_amps", category: "motor", unit: "A", unsPath: `${SIMLAB_LINE_PATH}.x.motor.motor_current_amps` },
  { tag: "speed_fpm", category: "process", unit: "fpm", unsPath: `${SIMLAB_LINE_PATH}.x.process.speed_fpm` },
  { tag: "blocked", category: "status", unit: "", unsPath: `${SIMLAB_LINE_PATH}.x.status.blocked` },
  { tag: "accumulation_percent", category: "process", unit: "%", unsPath: `${SIMLAB_LINE_PATH}.x.process.accumulation_percent` },
  { tag: "fault_code", category: "faults", unit: "", unsPath: `${SIMLAB_LINE_PATH}.x.faults.fault_code` },
];

const PACKER_TAGS: SimLabTagDef[] = [
  { tag: "run_state", category: "status", unit: "", unsPath: `${SIMLAB_LINE_PATH}.casepacker01.status.run_state` },
  { tag: "jam_detected", category: "status", unit: "", unsPath: `${SIMLAB_LINE_PATH}.casepacker01.status.jam_detected` },
  { tag: "case_count", category: "production", unit: "", unsPath: `${SIMLAB_LINE_PATH}.casepacker01.production.case_count` },
  { tag: "glue_temperature", category: "process", unit: "°F", unsPath: `${SIMLAB_LINE_PATH}.casepacker01.process.glue_temperature` },
  { tag: "fault_code", category: "faults", unit: "", unsPath: `${SIMLAB_LINE_PATH}.casepacker01.faults.fault_code` },
];

const TAG_DEFS = {
  conveyorzone01: CONVEYOR_TAGS,
  conveyorzone02: CONVEYOR_TAGS,
  casepacker01: PACKER_TAGS,
};

const DOCS = {
  conveyorzone01: ["troubleshooting.md", "fault_code_table.md"],
  conveyorzone02: ["troubleshooting.md", "fault_code_table.md"],
  casepacker01: ["troubleshooting.md", "fault_code_table.md", "pm_checklist.md"],
};

function tags(overrides: Record<string, number | boolean | string> = {}) {
  const base: Record<string, number | boolean | string> = {};
  for (const assetId of ["conveyorzone01", "conveyorzone02"]) {
    base[`${assetPath(assetId)}.process.speed_fpm`] = 60;
    base[`${assetPath(assetId)}.motor.motor_current_amps`] = 3.2;
    base[`${assetPath(assetId)}.status.blocked`] = false;
    base[`${assetPath(assetId)}.status.run_state`] = "Idle";
    base[`${assetPath(assetId)}.process.accumulation_percent`] = 0;
    base[`${assetPath(assetId)}.faults.fault_code`] = "";
  }
  base[`${assetPath("casepacker01")}.status.jam_detected`] = false;
  base[`${assetPath("casepacker01")}.production.case_count`] = 12;
  base[`${assetPath("casepacker01")}.process.glue_temperature`] = 340;
  base[`${assetPath("casepacker01")}.status.run_state`] = "Idle";
  base[`${assetPath("casepacker01")}.faults.fault_code`] = "";
  return { ...base, ...overrides };
}

const JAM_ALARMS: SimLabAlarm[] = [
  { assetId: "conveyorzone02", code: "C2-BLOCKED", severity: "warn", message: "ConveyorZone02: zone blocked — downstream backup.", sinceTick: 1 },
  { assetId: "casepacker01", code: "CP-JAM", severity: "fault", message: "CasePacker01: infeed jam detected — clear and restart.", sinceTick: 10 },
];

function healthy(now = 1_000): SimLabDemoState {
  return buildDemoState({
    snapshot: { tick: 40, tags: tags() },
    alarms: [],
    tagDefs: TAG_DEFS,
    documents: DOCS,
    observedAt: now,
    now,
    staleAfterMs: 5_000,
  });
}

function jammed(now = 1_000): SimLabDemoState {
  return buildDemoState({
    snapshot: {
      tick: 40,
      tags: tags({
        [`${assetPath("conveyorzone02")}.status.blocked`]: true,
        [`${assetPath("casepacker01")}.status.jam_detected`]: true,
        [`${assetPath("casepacker01")}.faults.fault_code`]: "CP001",
      }),
    },
    alarms: JAM_ALARMS,
    tagDefs: TAG_DEFS,
    documents: DOCS,
    observedAt: now,
    now,
    staleAfterMs: 5_000,
  });
}

// --- the allowlist ---------------------------------------------------------

describe("the endpoint allowlist is the whole vocabulary", () => {
  it("contains neither the rubric nor the evidence endpoint", () => {
    const routes = Object.values(SIMLAB_ENDPOINTS).join(" ");
    expect(routes).not.toContain("rubric");
    expect(routes).not.toContain("evidence");
    expect(routes).not.toContain("eval");
    expect(routes).not.toContain("validation");
  });

  it("every route the client can issue comes from the allowlist", async () => {
    const seen: string[] = [];
    const client = new SimLabClient({
      baseUrl: "http://sim.test",
      fetch: recording(seen, { tick: 0 }),
    });
    await client.health();
    await client.snapshot().catch(() => null);
    await client.alarms().catch(() => null);
    await client.assetDocs("casepacker01").catch(() => null);
    await client.assetTags("casepacker01").catch(() => null);
    await client.history(`${assetPath("casepacker01")}.status.jam_detected`).catch(() => null);
    await client.startScenario(JAM_SCENARIO_ID);
    await client.resetScenario();
    await client.tick(10);

    const templates = Object.values(SIMLAB_ENDPOINTS).map((route) =>
      new RegExp(`^${route.replace(/\{\w+\}/g, "[^/?]+")}(\\?.*)?$`),
    );
    for (const path of seen) {
      const relative = path.replace("http://sim.test", "");
      expect(
        templates.some((template) => template.test(relative)),
        `${relative} is not an allowlisted route`,
      ).toBe(true);
    }
    expect(seen.length).toBe(9);
  });

  it("the scenario id travels out on the start control and nowhere else", async () => {
    const seen: string[] = [];
    const client = new SimLabClient({ baseUrl: "http://sim.test", fetch: recording(seen, { tick: 0 }) });
    await client.startScenario(JAM_SCENARIO_ID);
    await client.snapshot().catch(() => null);
    await client.alarms().catch(() => null);

    const carrying = seen.filter((path) => path.includes(JAM_SCENARIO_ID));
    expect(carrying).toEqual([`http://sim.test/simlab/scenario/${JAM_SCENARIO_ID}/start`]);
  });
});

function recording(seen: string[], body: unknown): FetchLike {
  return async (input) => {
    seen.push(input);
    return { ok: true, status: 200, json: async () => body, text: async () => "" };
  };
}

// --- fail-closed parsing ---------------------------------------------------

describe("parsing is fail-closed", () => {
  it("accepts the real shapes", () => {
    expect(parseHealth({ status: "ok", tick: 7 })).toEqual({ tick: 7 });
    expect(parseSnapshot({ tick: 3, tags: { a: 1 } })?.tick).toBe(3);
    expect(parseAlarms(JAM_ALARMS.map((alarm) => ({
      asset_id: alarm.assetId, code: alarm.code, severity: alarm.severity,
      message: alarm.message, since_tick: alarm.sinceTick,
    })))).toHaveLength(2);
    expect(parseHistory({ history: [{ tick: 1, value: false }] })).toHaveLength(1);
    expect(parseDocNames(["a.md"])).toEqual(["a.md"]);
    expect(parseTagDefs([{ tag: "speed_fpm", category: "process", unit: "fpm", uns_path: "p" }])).toHaveLength(1);
  });

  it("returns null rather than a plausible default", () => {
    expect(parseHealth({})).toBeNull();
    expect(parseHealth({ tick: "7" })).toBeNull();
    expect(parseSnapshot({ tick: 1 })).toBeNull();
    expect(parseSnapshot({ tags: {} })).toBeNull();
    expect(parseSnapshot(null)).toBeNull();
    expect(parseAlarms({})).toBeNull();
    expect(parseHistory({ history: [{ tick: "1", value: 2 }] })).toBeNull();
    expect(parseDocNames([1])).toBeNull();
    expect(parseTagDefs([{ tag: "x" }])).toBeNull();
  });

  it("rejects the whole alarm list when one entry is malformed", () => {
    // A list silently short by one is indistinguishable from a quiet machine.
    // Each shape is covered separately: a mutation that dropped only the
    // not-a-record branch stayed green against an unknown-severity fixture,
    // because both defects live on different lines.
    const good = { asset_id: "casepacker01", code: "CP-JAM", severity: "fault", message: "m", since_tick: 10 };
    const malformed: unknown[] = [
      { ...good, severity: "shouting" },
      { ...good, since_tick: "10" },
      { ...good, asset_id: 7 },
      "conveyorzone02 blocked",
      null,
      42,
      [good],
    ];
    for (const bad of malformed) {
      expect(parseAlarms([good, bad]), `accepted a list containing ${JSON.stringify(bad)}`).toBeNull();
    }
    expect(parseAlarms([good])).toHaveLength(1);
  });

  it("drops a non-scalar tag value instead of coercing it", () => {
    const parsed = parseSnapshot({ tick: 1, tags: { good: 2, bad: { nested: true } } });
    expect(parsed?.tags).toEqual({ good: 2 });
  });

  it("an unreachable or erroring service raises, and never resolves to empty data", async () => {
    const dead: FetchLike = async () => { throw new Error("ECONNREFUSED"); };
    await expect(new SimLabClient({ baseUrl: "http://x", fetch: dead }).snapshot())
      .rejects.toBeInstanceOf(SimLabUnavailable);

    const err: FetchLike = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => "" });
    await expect(new SimLabClient({ baseUrl: "http://x", fetch: err }).alarms())
      .rejects.toBeInstanceOf(SimLabUnavailable);
  });

  it("passes the caller's abort signal through to fetch", async () => {
    let received: AbortSignal | undefined;
    const fetchImpl: FetchLike = async (_input, init) => {
      received = init?.signal;
      return { ok: true, status: 200, json: async () => ({ tick: 1, tags: {} }), text: async () => "" };
    };
    const controller = new AbortController();
    await new SimLabClient({ baseUrl: "http://x", fetch: fetchImpl }).snapshot(controller.signal);
    expect(received).toBe(controller.signal);
  });
});

// --- state derivation ------------------------------------------------------

describe("condition is derived from evidence and says which", () => {
  it("a healthy line reads as running on all three assets", () => {
    const state = healthy();
    expect(state.assets.map((asset) => asset.condition)).toEqual(["running", "running", "running"]);
    expect(state.alarms).toEqual([]);
    expect(state.connection).toBe("live");
    for (const asset of state.assets) expect(asset.conditionReason.length).toBeGreaterThan(0);
  });

  it("the jam reads as a fault on the packer and a block upstream", () => {
    const state = jammed();
    const byId = Object.fromEntries(state.assets.map((asset) => [asset.assetId, asset]));
    expect(byId.casepacker01.condition).toBe("faulted");
    expect(byId.casepacker01.faultCode).toBe("CP001");
    expect(byId.casepacker01.conditionReason).toContain("CP-JAM");
    expect(byId.conveyorzone02.condition).toBe("blocked");
    expect(byId.conveyorzone02.conditionReason).toContain("C2-BLOCKED");
    expect(byId.conveyorzone01.condition).toBe("running");
  });

  it("a fault outranks a block on the same asset", () => {
    const state = buildDemoState({
      snapshot: { tick: 1, tags: tags({ [`${assetPath("conveyorzone02")}.status.blocked`]: true }) },
      alarms: [
        { assetId: "conveyorzone02", code: "C2-BLOCKED", severity: "warn", message: "m", sinceTick: 1 },
        { assetId: "conveyorzone02", code: "C001", severity: "fault", message: "overload", sinceTick: 2 },
      ],
      tagDefs: TAG_DEFS, documents: DOCS, observedAt: 0, now: 0, staleAfterMs: 5_000,
    });
    expect(state.assets.find((a) => a.assetId === "conveyorzone02")?.condition).toBe("faulted");
  });

  it("a zero-speed belt with no alarm is stopped, not running", () => {
    const state = buildDemoState({
      snapshot: { tick: 1, tags: tags({ [`${assetPath("conveyorzone01")}.process.speed_fpm`]: 0 }) },
      alarms: [], tagDefs: TAG_DEFS, documents: DOCS, observedAt: 0, now: 0, staleAfterMs: 5_000,
    });
    expect(state.assets[0].condition).toBe("stopped");
  });

  it("an asset with no readings is unknown, never assumed healthy", () => {
    const state = buildDemoState({
      snapshot: { tick: 1, tags: {} },
      alarms: [], tagDefs: TAG_DEFS, documents: DOCS, observedAt: 0, now: 0, staleAfterMs: 5_000,
    });
    expect(state.assets.map((asset) => asset.condition)).toEqual(["unknown", "unknown", "unknown"]);
    for (const asset of state.assets) expect(asset.signals).toEqual([]);
  });

  it("the case packer has no belt, so speed is null rather than zero", () => {
    const packer = healthy().assets.find((asset) => asset.assetId === "casepacker01");
    expect(packer?.speedFpm).toBeNull();
    expect(packer?.condition).toBe("running");
  });
});

describe("only tags the simulator actually drives are rendered", () => {
  it("omits run_state and accumulation_percent from every asset's signals", () => {
    // Both are present in the snapshot and in the tag definitions; both are
    // constant in every SimLab scenario (asserted on the Python side), so
    // showing them would contradict a belt that is visibly turning, or a zone
    // the same payload calls blocked.
    for (const asset of jammed().assets) {
      const shown = asset.signals.map((signal) => signal.tag);
      for (const undriven of UNDRIVEN_TAGS) expect(shown).not.toContain(undriven);
    }
  });

  it("keeps the signal set small enough to read at a glance", () => {
    for (const asset of healthy().assets) {
      expect(asset.signals.length).toBeGreaterThan(0);
      expect(asset.signals.length).toBeLessThanOrEqual(4);
    }
  });

  it("carries the real unit from the tag definition, never a guessed one", () => {
    const zone = healthy().assets[0];
    expect(zone.signals.find((signal) => signal.tag === "speed_fpm")?.unit).toBe("fpm");
    expect(zone.signals.find((signal) => signal.tag === "motor_current_amps")?.unit).toBe("A");
    // A boolean has no unit, and gets an empty one rather than an invented label.
    expect(zone.signals.find((signal) => signal.tag === "blocked")?.unit).toBe("");
  });

  it("omits a signal whose tag is missing instead of substituting a value", () => {
    const withoutCurrent = tags();
    delete withoutCurrent[`${assetPath("conveyorzone01")}.motor.motor_current_amps`];
    const state = buildDemoState({
      snapshot: { tick: 1, tags: withoutCurrent },
      alarms: [], tagDefs: TAG_DEFS, documents: DOCS, observedAt: 0, now: 0, staleAfterMs: 5_000,
    });
    const shown = state.assets[0].signals.map((signal) => signal.tag);
    expect(shown).not.toContain("motor_current_amps");
    expect(shown).toContain("speed_fpm");
  });
});

// --- freshness -------------------------------------------------------------

describe("freshness is stated, not assumed", () => {
  it("data older than the stale window stops calling itself live", () => {
    const state = buildDemoState({
      snapshot: { tick: 40, tags: tags() }, alarms: [], tagDefs: TAG_DEFS, documents: DOCS,
      observedAt: 1_000, now: 9_000, staleAfterMs: 5_000,
    });
    expect(state.connection).toBe("stale");
    expect(state.ageMs).toBe(8_000);
  });

  it("a failed read keeps the last good readings but relabels them offline", () => {
    const last = healthy(1_000);
    const offline = unavailableDemoState(last, "ECONNREFUSED", 20_000);
    expect(offline.connection).toBe("offline");
    expect(offline.error).toBe("ECONNREFUSED");
    expect(offline.ageMs).toBe(19_000);
    // The machine is still visible — hiding it would be the other kind of lie.
    expect(offline.assets).toEqual(last.assets);
  });

  it("a failure before any successful read shows nothing rather than a healthy line", () => {
    const offline = unavailableDemoState(null, "ECONNREFUSED", 20_000);
    expect(offline.assets).toEqual([]);
    expect(offline.connection).toBe("offline");
    expect(offline.tick).toBe(0);
  });

  it("the pre-connection state is connecting, which is not the same as offline", () => {
    expect(connectingDemoState().connection).toBe("connecting");
    expect(connectingDemoState().error).toBeNull();
  });
});

// --- shell mapping ---------------------------------------------------------

describe("mapping into the shell's own model", () => {
  it("a blocked or faulted asset needs attention in navigation", () => {
    const machines = demoMachines(jammed());
    expect(machines.map((machine) => machine.status)).toEqual(["normal", "attention", "attention"]);
    expect(machines.map((machine) => machine.id)).toEqual([...DEMO_ASSET_IDS]);
    for (const machine of machines) expect(machine.unsPath.startsWith(SIMLAB_LINE_PATH)).toBe(true);
  });

  it("an asset with no readings is unknown in navigation, not normal", () => {
    const state = buildDemoState({
      snapshot: { tick: 1, tags: {} }, alarms: [], tagDefs: TAG_DEFS, documents: DOCS,
      observedAt: 0, now: 0, staleAfterMs: 5_000,
    });
    expect(demoMachines(state).every((machine) => machine.status === "unknown")).toBe(true);
  });

  it("inspector rows state the condition and the evidence for it", () => {
    const rows = demoInspector(jammed());
    expect(rows.some((row) => row.label === "Simulation tick")).toBe(true);
    expect(rows.some((row) => row.value.includes("CP-JAM"))).toBe(true);
  });

  it("no shell-bound payload mentions the scenario", () => {
    const blob = JSON.stringify({ state: jammed(), machines: demoMachines(jammed()), inspector: demoInspector(jammed()) });
    expect(blob).not.toContain(JAM_SCENARIO_ID);
    expect(blob.toLowerCase()).not.toContain("scenario_id");
    expect(blob.toLowerCase()).not.toContain("expected_");
  });

  it("only the three demo assets appear, whatever else the line reports", () => {
    const state = buildDemoState({
      snapshot: { tick: 1, tags: tags({ [`${assetPath("filler01")}.process.fill_level_oz`]: 16 }) },
      alarms: [{ assetId: "filler01", code: "F-LOW-BOWL", severity: "warn", message: "m", sinceTick: 1 }],
      tagDefs: TAG_DEFS, documents: DOCS, observedAt: 0, now: 0, staleAfterMs: 5_000,
    });
    expect(state.assets.map((asset) => asset.assetId)).toEqual([...DEMO_ASSET_IDS]);
    expect(state.alarms).toEqual([]);
  });
});
