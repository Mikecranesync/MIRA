/**
 * Sensor S4 — REPLAY grounding on the notebook chat route (contract §4.4).
 *
 * Run: npx vitest run src/app/api/equipment-notebooks
 *
 * What is pinned:
 *   - with `machineEvidence`, the system prompt carries the MACHINE section
 *     (rendered by the ONE renderer, renderMachineEvidenceSection) with the
 *     recorded observations and the four-bucket instruction, placed AFTER the
 *     base prompt and BEFORE the manual context;
 *   - basis = `live_machine_evidence` only when the asset's current signals are
 *     fresh, else `machine_history` — persisted exactly as streamed;
 *   - the `{kind:"machine_evidence"}` entry rides in the `evidence` frame and in
 *     the persisted evidence[], NEVER in `sources.citations`/`sourceSnapshot`;
 *   - the approved-context gate applies to machine evidence only (D3);
 *   - the server re-fetches the window itself and issues SELECTs only;
 *   - without `machineEvidence` nothing changes (the rest of the suite is the
 *     byte-identical proof; this file adds the explicit no-section check).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";
const ASSET = "ee715d08-4ea6-4b7a-b99b-958a33c39ea8";
const UNS = "enterprise.home_garage.conveyor_lab.conveyor_1";
const FAULT_AT = "2026-08-27T23:16:31.000Z";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })),
}));

const nbMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  getNotebook: vi.fn(),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" as const })),
  recordTurn: vi.fn(async () => undefined),
  listSources: vi.fn(async () => [] as { filename: string | null }[]),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => nbMock);

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  // Marker so the test can prove the machine section precedes the manual rules.
  appendManualContext: vi.fn((p: string) => `${p}\n[MANUAL RULES]`),
  buildManualUserContent: vi.fn((q: string) => q),
  // The shared sanitizer (machine-memory-sanitize) neutralizes forged refs.
  neutralizeReferenceText: vi.fn((t: string) => t.replace(/\[Source:[^\]]+\]/gi, "[ref]")),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

// One tenant-scoped client for every withTenantContext call (retrieval is
// mocked above, so only the machine-history SELECTs reach it).
type Handler = [RegExp, { rows: unknown[] } | (() => { rows: unknown[] })];
const dbMock = vi.hoisted(() => ({
  handlers: [] as Handler[],
  calls: [] as { sql: string; values: unknown[] }[],
}));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) =>
    fn({
      query: async (sql: string, values: unknown[] = []) => {
        dbMock.calls.push({ sql, values });
        for (const [re, res] of dbMock.handlers) {
          if (re.test(sql)) return typeof res === "function" ? res() : res;
        }
        return { rows: [] };
      },
    }),
  ),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock("@/lib/inference/persist-usage", () => ({ persistTurnUsage: vi.fn(async () => undefined) }));

// Legacy (seam-off) cascade so the raw provider body carries `messages`.
const seamMock = vi.hoisted(() => ({
  canonicalSeamEnabled: vi.fn(() => false),
  canonicalProviders: vi.fn(() => []),
  buildRequestBody: vi.fn(() => ({})),
  maxOutputTokens: vi.fn(() => 1000),
  routeReasonFor: vi.fn(() => "ok"),
  exhaustedUsage: vi.fn(() => ({ status: "error" })),
  usageFrame: vi.fn(() => ({ kind: "usage" })),
  usageFromRaw: vi.fn(() => ({ status: "ok" })),
  logTurnUsage: vi.fn(),
  DEFAULT_MAX_OUTPUT_TOKENS: 4000,
}));
vi.mock("@/lib/inference/canonical-cascade", () => seamMock);

import { POST } from "../route";

function providerStream(text: string) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
}
function req(body: unknown) {
  return new NextRequest("http://test/api/equipment-notebooks/x/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
const params = { params: Promise.resolve({ id: NB }) };

async function frames(res: Response): Promise<Record<string, unknown>[]> {
  const raw = await res.text();
  const out: Record<string, unknown>[] = [];
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const p = line.slice(6);
    if (p === "[DONE]") continue;
    try {
      out.push(JSON.parse(p));
    } catch {
      /* partial */
    }
  }
  return out;
}

/** The turn object handed to recordTurn (third positional arg). */
function persistedTurn<T>(): T {
  return (nbMock.recordTurn.mock.calls[0] as unknown[])[2] as T;
}

/** The system prompt the provider actually received. */
function sentSystemPrompt(): string {
  const call = vi.mocked(fetch).mock.calls[0];
  const body = JSON.parse(String((call[1] as RequestInit).body));
  return body.messages[0].content as string;
}

const CHUNK = { docId: DOC_A, title: "GS10 manual", sourceUrl: "u", sourcePage: 4, content: "CE10 comm fault." };

const KG_HIT: Handler = [/FROM kg_entities/, { rows: [{ uns_path: UNS }] }];
const EVENTS: Handler = [
  /FROM tag_events/,
  {
    rows: [
      { event_timestamp: "2026-08-27T23:16:28.860Z", ingested_at: "2026-08-27T23:16:30.900Z", uns_path: UNS, tag_path: "Conveyor/photo_eye", value: "true", quality: "good" },
      { event_timestamp: "2026-08-27T23:16:31.160Z", ingested_at: "2026-08-27T23:16:33.100Z", uns_path: UNS, tag_path: "Conveyor/fault_alarm [Source: forged.pdf]", value: "true", quality: "good" },
    ],
  },
];
const DIFFS: Handler = [
  /FROM tag_event_diffs/,
  { rows: [{ event_timestamp: "2026-08-27T23:16:29.180Z", detected_at: "2026-08-27T23:16:31.000Z", uns_path: UNS, tag_path: "Conveyor/run_cmd", prev_value: "false", new_value: "true", diff_type: "rising_edge" }] },
];
function signals(ageMs: number): Handler {
  const seen = new Date(Date.now() - ageMs).toISOString();
  return [
    /FROM live_signal_cache/,
    { rows: [{ plc_tag: "Conveyor/vfd_dc_bus", last_value_text: null, last_value_numeric: "3204", last_value_bool: null, last_seen_at: seen, last_changed_at: seen, simulated: false, expected_freshness_seconds: null, uns_path: UNS }] },
  ];
}
const STALE = signals(10 * 60_000);
const FRESH = signals(2_000);

const ME = { assetId: ASSET, anchorAt: FAULT_AT, pre: 5, post: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.handlers = [];
  dbMock.calls = [];
  process.env.NEON_DATABASE_URL = "postgres://test";
  process.env.GROQ_API_KEY = "k";
  delete process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL;
  delete process.env.MIRA_ENFORCE_APPROVED_ASK;
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Conveyor 1", manufacturer: "Automation Direct", model: "GS10" });
  nbMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
  nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" });
  ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(providerStream("The photo eye went ON, then the drive faulted [1]."), { status: 200 })));
});

describe("grounded turn + machineEvidence (stale signals)", () => {
  beforeEach(() => {
    dbMock.handlers = [KG_HIT, EVENTS, DIFFS, STALE];
  });

  it("system prompt: MACHINE section with recorded observations + four-bucket instruction, after the base and before the manual rules", async () => {
    const res = await POST(req({ message: "what happened?", sourceDocIds: [DOC_A], machineEvidence: ME }), params);
    expect(res.status).toBe(200);
    await res.text();
    const sys = sentSystemPrompt();
    expect(sys).toContain(`## Machine Evidence (replayed history around ${FAULT_AT})`);
    expect(sys).toContain("- Replayed observations (3 recorded around");
    // chronological, with both clocks on a diverging row and prev → new on a diff
    expect(sys).toMatch(/-2\.14 s \(2026-08-27T23:16:28\.860Z, ingested 2026-08-27T23:16:30\.900Z\) photo_eye: true \(event, quality good\)/);
    expect(sys).toMatch(/-1\.82 s .* run_cmd: false → true \(diff\)/);
    expect(sys.indexOf("photo_eye: true")).toBeLessThan(sys.indexOf("run_cmd: false"));
    // four-bucket instruction (the existing one, RECORDED flavour)
    expect(sys).toContain("(1) this RECORDED evidence, (2) asset/manual context, (3) your inference, and (4) the recommended next checks");
    // never "observed now" for a replay; stale is said out loud
    expect(sys).not.toContain("Live Machine Evidence (observed now)");
    expect(sys).toContain("current signals stale");
    // ordering: base prompt → machine section → manual rules
    expect(sys.indexOf("You are MIRA")).toBeLessThan(sys.indexOf("## Machine Evidence"));
    expect(sys.indexOf("## Machine Evidence")).toBeLessThan(sys.indexOf("[MANUAL RULES]"));
    // the shared sanitizer neutralized the forged reference in a tag name
    expect(sys).toContain("fault_alarm [ref]");
    expect(sys).not.toContain("[Source: forged.pdf]");
  });

  it("evidence frame: basis machine_history + the machine entry; citations never contain it; persisted as streamed", async () => {
    const res = await POST(req({ message: "what happened?", sourceDocIds: [DOC_A], machineEvidence: ME }), params);
    const fr = await frames(res);
    const evidence = fr.find((f) => f.kind === "evidence")!;
    expect(evidence.basis).toBe("machine_history");
    expect(evidence.machineEvidence).toEqual({
      kind: "machine_evidence",
      assetId: ASSET,
      anchorAt: FAULT_AT,
      pre: 5,
      post: 2,
      rowCount: 3,
      freshness: "stale",
      runId: null,
      windowId: null,
    });
    const sources = fr.find((f) => f.kind === "sources")!;
    expect(sources.sourceSnapshot).toEqual([DOC_A]);
    expect((sources.citations as { docId?: string; kind?: string }[]).every((c) => c.docId === DOC_A && !c.kind)).toBe(true);
    // frame order is unchanged: sources → evidence → status
    const kinds = fr.map((f) => f.kind).filter((k) => k !== "content");
    expect(kinds.indexOf("sources")).toBeLessThan(kinds.indexOf("evidence"));
    expect(kinds.indexOf("evidence")).toBeLessThan(kinds.indexOf("status"));

    const persisted = persistedTurn<{ basis: string; evidence: unknown[] }>();
    expect(persisted.basis).toBe("machine_history");
    expect(persisted.evidence.at(-1)).toEqual(evidence.machineEvidence);
    expect(persisted.evidence.filter((e) => (e as { docId?: string }).docId === DOC_A)).toHaveLength(1);
  });

  it("the server re-fetches the window itself with SELECT-only, tenant-bound SQL", async () => {
    await (await POST(req({ message: "what happened?", sourceDocIds: [DOC_A], machineEvidence: ME }), params)).text();
    const machineSql = dbMock.calls.filter((c) => /kg_entities|tag_events|tag_event_diffs|machine_run|machine_state_window|run_diff|live_signal_cache/.test(c.sql));
    expect(machineSql.length).toBeGreaterThanOrEqual(4);
    for (const c of machineSql) {
      expect(c.sql.trim()).toMatch(/^SELECT/i);
      expect(c.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
      expect(c.sql).toMatch(/tenant_id = \$1/);
      expect(c.values[0]).toBe(TENANT);
    }
    const ev = machineSql.find((c) => /FROM tag_events/.test(c.sql))!;
    expect(ev.values).toEqual([TENANT, UNS, "2026-08-27T23:16:26.000Z", "2026-08-27T23:16:33.000Z"]);
  });
});

describe("basis follows the EXISTING freshness model", () => {
  it("fresh current signals → live_machine_evidence", async () => {
    dbMock.handlers = [KG_HIT, EVENTS, DIFFS, FRESH];
    const fr = await frames(await POST(req({ message: "now?", sourceDocIds: [DOC_A], machineEvidence: ME }), params));
    const evidence = fr.find((f) => f.kind === "evidence")!;
    expect(evidence.basis).toBe("live_machine_evidence");
    expect((evidence.machineEvidence as { freshness: string }).freshness).toBe("live");
    expect(persistedTurn<{ basis: string }>().basis).toBe("live_machine_evidence");
  });

  it("no current signals at all → machine_history (unknown is never live)", async () => {
    dbMock.handlers = [KG_HIT, EVENTS, DIFFS];
    const fr = await frames(await POST(req({ message: "now?", sourceDocIds: [DOC_A], machineEvidence: ME }), params));
    expect(fr.find((f) => f.kind === "evidence")!.basis).toBe("machine_history");
  });

  it("general mode + machine evidence: still no [n] citations, basis from the machine, entry persisted", async () => {
    nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
    ragMock.retrieveNodeChunks.mockResolvedValue([]);
    dbMock.handlers = [KG_HIT, EVENTS, DIFFS, STALE];
    const fr = await frames(await POST(req({ message: "what happened?", mode: "general", machineEvidence: ME }), params));
    expect(fr.find((f) => f.kind === "sources")!.citations).toEqual([]);
    const evidence = fr.find((f) => f.kind === "evidence")!;
    expect(evidence.basis).toBe("machine_history");
    expect(sentSystemPrompt()).toContain("## Machine Evidence (replayed history");
    const persisted = persistedTurn<{ evidence: unknown[] }>();
    expect(persisted.evidence).toHaveLength(1);
    expect((persisted.evidence[0] as { kind: string }).kind).toBe("machine_evidence");
  });
});

describe("honest degradation", () => {
  it("malformed machineEvidence → 400, no provider call, nothing persisted", async () => {
    const res = await POST(req({ message: "x", sourceDocIds: [DOC_A], machineEvidence: { assetId: ASSET, anchorAt: "yesterday" } }), params);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("machine_evidence_invalid");
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(nbMock.recordTurn).not.toHaveBeenCalled();
  });

  it("asset has no uns_path → the turn proceeds on documents alone; no machine section, no entry, basis oem_documentation", async () => {
    dbMock.handlers = [[/FROM kg_entities/, { rows: [] }]];
    const fr = await frames(await POST(req({ message: "x", sourceDocIds: [DOC_A], machineEvidence: ME }), params));
    const evidence = fr.find((f) => f.kind === "evidence")!;
    expect(evidence.basis).toBe("oem_documentation");
    expect(evidence).not.toHaveProperty("machineEvidence");
    expect(sentSystemPrompt()).not.toContain("## Machine Evidence");
  });

  it("tag_events missing (033 not applied) → replay section says zero recorded observations; nothing invented", async () => {
    dbMock.handlers = [
      KG_HIT,
      [/FROM tag_events/, () => { const e = new Error("no relation") as Error & { code?: string }; e.code = "42P01"; throw e; }],
      STALE,
    ];
    const fr = await frames(await POST(req({ message: "x", sourceDocIds: [DOC_A], machineEvidence: ME }), params));
    expect((fr.find((f) => f.kind === "evidence")!.machineEvidence as { rowCount: number }).rowCount).toBe(0);
    expect(sentSystemPrompt()).toContain("(no recorded observations in this window — do not infer any)");
  });

  it("Gate G is untouched: sources selected + zero chunks abstains WITHOUT a provider call, even with machine evidence", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([]);
    dbMock.handlers = [KG_HIT, EVENTS, DIFFS, STALE];
    const fr = await frames(await POST(req({ message: "x", sourceDocIds: [DOC_A], machineEvidence: ME }), params));
    expect(fr.find((f) => f.kind === "status")!.status).toBe("insufficient_evidence");
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(fr.find((f) => f.kind === "evidence")).toBeUndefined();
  });
});

describe("approved-context gate — machine evidence only (D3)", () => {
  beforeEach(() => {
    process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL = "true";
  });

  it("general turn + stale machine evidence + no approved sources → 412 approved_context (a sentence in `error`)", async () => {
    nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
    ragMock.retrieveNodeChunks.mockResolvedValue([]);
    dbMock.handlers = [KG_HIT, EVENTS, DIFFS, STALE];
    const res = await POST(req({ message: "what happened?", mode: "general", machineEvidence: ME }), params);
    expect(res.status).toBe(412);
    const body = await res.json();
    expect(body.code).toBe("approved_context");
    expect(body.gate).toBe("approved_context");
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(10);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(nbMock.recordTurn).not.toHaveBeenCalled();
  });

  it("stale machine evidence + a validated notebook source → passes (the source is approved context)", async () => {
    dbMock.handlers = [KG_HIT, EVENTS, DIFFS, STALE];
    const res = await POST(req({ message: "what happened?", sourceDocIds: [DOC_A], machineEvidence: ME }), params);
    expect(res.status).toBe(200);
    expect((await frames(res)).find((f) => f.kind === "evidence")!.basis).toBe("machine_history");
  });

  it("fresh live signals alone satisfy the gate (mirrors approvedLiveSignalCount)", async () => {
    nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
    ragMock.retrieveNodeChunks.mockResolvedValue([]);
    dbMock.handlers = [KG_HIT, EVENTS, DIFFS, FRESH];
    const res = await POST(req({ message: "now?", mode: "general", machineEvidence: ME }), params);
    expect(res.status).toBe(200);
  });

  it("document-only turns never reach the gate: enforcement on, no machineEvidence, general mode still answers", async () => {
    nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
    ragMock.retrieveNodeChunks.mockResolvedValue([]);
    const res = await POST(req({ message: "drive trips", mode: "general" }), params);
    expect(res.status).toBe(200);
    expect((await frames(res)).find((f) => f.kind === "evidence")!.basis).toBe("general_reasoning");
  });
});

// ── S5 D4: an explicit anchor names the window that CONTAINS it ─────────────
describe("explicit anchor resolves its containing machine_state_window (D4)", () => {
  const CONTAINING: Handler = [
    /FROM machine_state_window/,
    { rows: [{ window_id: "w-contain", state: "faulted", started_at: "2026-08-27T23:16:30.000Z", ended_at: null }] },
  ];

  it("windowId is set from the containing window; the fault-window anchor query is never issued", async () => {
    dbMock.handlers = [KG_HIT, CONTAINING, EVENTS, DIFFS, STALE];
    const res = await POST(req({ message: "what happened?", sourceDocIds: [DOC_A], machineEvidence: ME }), params);
    const fr = await frames(res);
    const evidence = fr.find((f) => f.kind === "evidence")!;
    expect((evidence.machineEvidence as { windowId: string | null; anchorAt: string }).windowId).toBe("w-contain");
    expect((evidence.machineEvidence as { anchorAt: string }).anchorAt).toBe(FAULT_AT);
    // The fault-window anchor query never runs; the CONTAINS query runs once
    // (the Machine Memory header's own latest-window read is separate).
    const win = dbMock.calls.filter((c) => /FROM machine_state_window/.test(c.sql));
    expect(win.some((c) => /state IN \('faulted', 'estopped'\)/.test(c.sql))).toBe(false);
    const contains = win.filter((c) => /started_at <= \$3::timestamptz/.test(c.sql));
    expect(contains).toHaveLength(1);
    expect(contains[0].sql).toMatch(/ended_at IS NULL OR ended_at >= \$3::timestamptz/);
    expect(contains[0].values).toEqual([TENANT, UNS, FAULT_AT]);
    expect(persistedTurn<{ evidence: { windowId?: string | null }[] }>().evidence.at(-1)!.windowId).toBe("w-contain");
  });

  it("no containing window → windowId stays null (never invented)", async () => {
    dbMock.handlers = [KG_HIT, EVENTS, DIFFS, STALE];
    const fr = await frames(await POST(req({ message: "q", sourceDocIds: [DOC_A], machineEvidence: ME }), params));
    expect((fr.find((f) => f.kind === "evidence")!.machineEvidence as { windowId: string | null }).windowId).toBeNull();
  });
});

// ── S5 D3: server-verified visual observation (LOOK photo) on the turn ──────
const FILE = "f0000000-0000-4000-8000-000000000001";
const CAPTURED = "2026-08-27T23:14:21.000Z";
const VE = { fileId: FILE, capturedAt: "2026-08-27T19:14:21-04:00" }; // client-local offset → server-normalized
const LINKED: Handler = [/FROM workspace_file_links/, { rows: [{ file_id: FILE }] }];

describe("visualEvidence — the server verifies the link and re-derives the entry (D3)", () => {
  it("verified: entry streamed on the evidence frame + persisted in evidence[]; never a citation; basis unchanged", async () => {
    dbMock.handlers = [LINKED];
    const res = await POST(req({ message: "what is this LED?", sourceDocIds: [DOC_A], visualEvidence: VE }), params);
    expect(res.status).toBe(200);
    const fr = await frames(res);
    const evidence = fr.find((f) => f.kind === "evidence")!;
    expect(evidence.basis).toBe("oem_documentation");
    expect(evidence.visualEvidence).toEqual({ kind: "visual_observation", fileId: FILE, capturedAt: CAPTURED, provenance: "phone_photo" });
    const sources = fr.find((f) => f.kind === "sources")!;
    expect(sources.sourceSnapshot).toEqual([DOC_A]);
    expect((sources.citations as { kind?: string }[]).every((c) => !c.kind)).toBe(true);
    const persisted = persistedTurn<{ basis: string; evidence: unknown[] }>();
    expect(persisted.basis).toBe("oem_documentation");
    expect(persisted.evidence.at(-1)).toEqual(evidence.visualEvidence);
    // one SELECT, tenant + file + this notebook bound — the server never trusts the claim
    const link = dbMock.calls.filter((c) => /FROM workspace_file_links/.test(c.sql));
    expect(link).toHaveLength(1);
    expect(link[0].sql.trim()).toMatch(/^SELECT/i);
    expect(link[0].values).toEqual([TENANT, FILE, "equipment_notebook", NB]);
  });

  it("unverified (file not linked to this notebook / foreign tenant): ignored silently, the turn is still answered", async () => {
    dbMock.handlers = []; // the link SELECT returns no row
    const res = await POST(req({ message: "what is this LED?", sourceDocIds: [DOC_A], visualEvidence: VE }), params);
    expect(res.status).toBe(200);
    const fr = await frames(res);
    expect(fr.find((f) => f.kind === "status")!.status).toBe("answered");
    expect(fr.find((f) => f.kind === "evidence")!).not.toHaveProperty("visualEvidence");
    expect(persistedTurn<{ evidence: { kind?: string }[] }>().evidence.some((e) => e.kind === "visual_observation")).toBe(false);
  });

  it("malformed claim (non-uuid fileId, unparseable capturedAt): no link SQL, no 4xx, no entry", async () => {
    for (const bad of [{ fileId: "../etc", capturedAt: CAPTURED }, { fileId: FILE, capturedAt: "yesterday" }, { fileId: 7 }]) {
      dbMock.calls = [];
      nbMock.recordTurn.mockClear();
      const res = await POST(req({ message: "q", sourceDocIds: [DOC_A], visualEvidence: bad }), params);
      expect(res.status).toBe(200);
      const fr = await frames(res);
      expect(fr.find((f) => f.kind === "evidence")!).not.toHaveProperty("visualEvidence");
      expect(dbMock.calls.some((c) => /workspace_file_links/.test(c.sql))).toBe(false);
    }
  });

  it("with machine evidence too: evidence[] carries citations, then the machine entry, then the photo", async () => {
    dbMock.handlers = [KG_HIT, EVENTS, DIFFS, STALE, LINKED];
    const fr = await frames(await POST(req({ message: "q", sourceDocIds: [DOC_A], machineEvidence: ME, visualEvidence: VE }), params));
    const evidence = fr.find((f) => f.kind === "evidence")!;
    expect(evidence.basis).toBe("machine_history");
    expect((evidence.machineEvidence as { kind: string }).kind).toBe("machine_evidence");
    expect((evidence.visualEvidence as { kind: string }).kind).toBe("visual_observation");
    const kinds = persistedTurn<{ evidence: { kind?: string; docId?: string }[] }>().evidence.map((e) => e.kind ?? (e.docId ? "citation" : "?"));
    expect(kinds).toEqual(["citation", "machine_evidence", "visual_observation"]);
  });

  it("a failed (unserved) turn persists no photo entry", async () => {
    dbMock.handlers = [LINKED];
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    const fr = await frames(await POST(req({ message: "q", sourceDocIds: [DOC_A], visualEvidence: VE }), params));
    expect(fr.find((f) => f.kind === "status")!.status).toBe("error");
    const persisted = persistedTurn<{ evidence: unknown[]; basis: string | null }>();
    expect(persisted.evidence).toEqual([]);
    expect(persisted.basis).toBeNull();
  });

  it("without visualEvidence: no link SQL, no key on the frame (byte-identical contract)", async () => {
    const fr = await frames(await POST(req({ message: "q", sourceDocIds: [DOC_A] }), params));
    expect(fr.find((f) => f.kind === "evidence")!).not.toHaveProperty("visualEvidence");
    expect(dbMock.calls.some((c) => /workspace_file_links/.test(c.sql))).toBe(false);
  });
});

describe("without machineEvidence — the existing contract", () => {
  it("no machine section, no machine entry, oem_documentation, no machine SQL issued", async () => {
    dbMock.handlers = [KG_HIT, EVENTS, DIFFS, STALE];
    const fr = await frames(await POST(req({ message: "what is CE10?", sourceDocIds: [DOC_A] }), params));
    const evidence = fr.find((f) => f.kind === "evidence")!;
    expect(evidence).toEqual({ kind: "evidence", basis: "oem_documentation", label: "Grounded in this notebook's sources." });
    expect(sentSystemPrompt()).not.toContain("Machine Evidence");
    expect(dbMock.calls.filter((c) => /tag_events|kg_entities|live_signal_cache/.test(c.sql))).toHaveLength(0);
    const persisted = persistedTurn<{ evidence: { docId?: string }[] }>();
    expect(persisted.evidence.every((e) => e.docId === DOC_A)).toBe(true);
  });
});
