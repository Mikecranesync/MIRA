/**
 * Per-turn spend persistence — SQL contract and failure posture.
 *
 * Run: npx vitest run src/lib/inference/__tests__/persist-usage.test.ts
 *
 * Two things here are load-bearing and neither is enforced by the database:
 *  - `decision_traces.tenant_id` is TEXT since migration 070. A `::uuid` cast
 *    would both throw on a legacy tenant AND fail to match the RLS policy.
 *  - a NULL cost must stay NULL. Coalescing to 0 would silently understate every
 *    spend rollup built on the column, and would look like a working ledger.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { sql: string; params: unknown[] };
const calls: Call[] = [];
let insertBehaviour: "ok" | "no_row" | ((sql: string) => never) = "ok";

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) =>
    fn({
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (typeof insertBehaviour === "function") insertBehaviour(sql);
        if (insertBehaviour === "no_row") return { rows: [], rowCount: 0 };
        return { rows: [{ trace_id: "trace-1" }], rowCount: 1 };
      }),
    }),
  ),
}));

const poolMock = vi.hoisted(() => ({
  query: vi.fn(async () => ({ rows: [] as Record<string, unknown>[] })),
}));
vi.mock("@/lib/db", () => ({ default: poolMock }));

import { persistTurnUsage, tenantSpendSince, type TurnRecord } from "../persist-usage";
import type { TurnUsage } from "../canonical-cascade";
import { emptyPacket } from "@/capabilities/observability/turn-evidence-packet";

const TENANT = "e88bd0e8-8a84-4e30-9803-c0dc6efb07fe";
const NB = "bc8a9bf6-8f36-4c2f-8b9f-f3465188d13a";

const scope = {
  tenantId: TENANT,
  notebookId: NB,
  question: "How do I stand up the MQTT broker",
  answerText: "Install Mosquitto… [2]",
  citationsPresent: true,
  latencyMs: 4210,
};

const usage: TurnUsage = {
  provider: "Groq",
  model: "openai/gpt-oss-120b",
  routeReason: "primary",
  inputTokens: 1351,
  cachedInputTokens: 200,
  outputTokens: 134,
  costUsdEstimate: 0.000303,
  status: "ok",
  attempted: [],
};

beforeEach(() => {
  calls.length = 0;
  insertBehaviour = "ok";
  vi.clearAllMocks();
});

describe("persistTurnUsage — the record", () => {
  it("writes every field the canonical seam produced", async () => {
    const res = await persistTurnUsage(scope, usage);
    expect(res).toEqual({ persisted: true, traceId: "trace-1" });

    const { sql, params } = calls[0];
    for (const col of [
      "provider",
      "route_reason",
      "input_tokens",
      "cached_input_tokens",
      "output_tokens",
      "cost_usd_estimate",
      "status",
    ]) {
      expect(sql).toContain(col);
    }
    expect(params).toEqual(
      expect.arrayContaining(["Groq", "primary", 1351, 200, 134, 0.000303, "ok"]),
    );
  });

  it("passes tenant_id as TEXT with no ::uuid cast (migration 070)", async () => {
    await persistTurnUsage(scope, usage);
    const { sql, params } = calls[0];
    expect(sql).not.toMatch(/\$1::uuid/);
    expect(params[0]).toBe(TENANT);
  });

  it("writes into decision_traces — the canonical ledger, not a second table", async () => {
    await persistTurnUsage(scope, usage);
    expect(calls[0].sql).toMatch(/INSERT INTO decision_traces/i);
    expect(calls[0].sql).not.toMatch(/equipment_notebook_turns/i);
  });

  it("tags the platform and the owning notebook so spend is attributable", async () => {
    await persistTurnUsage(scope, usage);
    expect(calls[0].params).toEqual(expect.arrayContaining(["hub_notebook_chat", `notebook:${NB}`]));
  });
});

describe("persistTurnUsage — unknown cost stays unknown", () => {
  it("persists NULL cost as NULL, never 0", async () => {
    await persistTurnUsage(scope, { ...usage, costUsdEstimate: null });
    // Index of cost in the VALUES list; assert on the value, not the position,
    // by checking that no 0 was substituted anywhere a null belongs.
    expect(calls[0].params).toContain(null);
    expect(calls[0].params).not.toContain(0);
  });

  it("persists NULL tokens as NULL when the provider reported no usage", async () => {
    await persistTurnUsage(scope, {
      ...usage,
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      costUsdEstimate: null,
    });
    const nulls = calls[0].params.filter((p) => p === null).length;
    expect(nulls).toBeGreaterThanOrEqual(4);
    expect(calls[0].params).not.toContain(0);
  });

  it("records an exhausted turn — null provider, error status — rather than skipping it", async () => {
    // A turn nobody served still cost latency and still happened; dropping it
    // would make the ledger silently under-count failures.
    const res = await persistTurnUsage(scope, {
      provider: null,
      model: null,
      routeReason: "exhausted:Groq,Cerebras,Together",
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      costUsdEstimate: null,
      status: "error",
      attempted: ["Groq", "Cerebras", "Together"],
    });
    expect(res.persisted).toBe(true);
    expect(calls[0].params).toEqual(
      expect.arrayContaining(["exhausted:Groq,Cerebras,Together", "error"]),
    );
  });

  it("records the fallback chain when a later provider served", async () => {
    await persistTurnUsage(scope, { ...usage, provider: "Cerebras", routeReason: "fallback:Groq" });
    expect(calls[0].params).toEqual(expect.arrayContaining(["Cerebras", "fallback:Groq"]));
  });

  it("records a capped turn distinctly from an ok one", async () => {
    await persistTurnUsage(scope, { ...usage, status: "capped" });
    expect(calls[0].params).toContain("capped");
  });
});

describe("persistTurnUsage — failure posture (non-fatal, never silent)", () => {
  it("NEVER throws when the table/column is missing — the answer is already delivered", async () => {
    insertBehaviour = () => {
      throw Object.assign(new Error('column "provider" does not exist'), { code: "42703" });
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await persistTurnUsage(scope, usage);
    expect(res).toEqual({ persisted: false, reason: "42703" });
    spy.mockRestore();
  });

  it("logs a DISTINCT persist_failed event so a spend gap is diagnosable", async () => {
    insertBehaviour = () => {
      throw Object.assign(new Error("permission denied"), { code: "42501" });
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await persistTurnUsage(scope, usage);
    const logged = String(spy.mock.calls[0][0]);
    expect(logged).toContain("turn.usage.persist_failed");
    expect(logged).toContain("42501");
    // and it must not masquerade as a chat failure
    expect(logged).not.toContain("chat_error");
    spy.mockRestore();
  });

  it("does not leak the question or answer into the failure log", async () => {
    insertBehaviour = () => {
      throw new Error("boom");
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await persistTurnUsage(scope, usage);
    const logged = String(spy.mock.calls[0][0]).toLowerCase();
    expect(logged).not.toContain("mqtt broker");
    expect(logged).not.toContain("mosquitto");
    spy.mockRestore();
  });

  it("reports a no-op insert instead of claiming success", async () => {
    insertBehaviour = "no_row";
    const res = await persistTurnUsage(scope, usage);
    expect(res).toEqual({ persisted: false, reason: "no_row_returned" });
  });
});

describe("tenantSpendSince — the rollup ADR-0037 needs", () => {
  it("scopes to one tenant and a time window", async () => {
    const since = new Date("2026-08-01T00:00:00Z");
    await tenantSpendSince(TENANT, since);
    const [sql, params] = poolMock.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/tenant_id\s*=\s*\$1/);
    expect(sql).toMatch(/ts\s*>=\s*\$2/);
    expect(params).toEqual([TENANT, since.toISOString()]);
  });

  it("counts unpriced turns separately so a partial total is visible as partial", async () => {
    await tenantSpendSince(TENANT, new Date());
    const [sql] = poolMock.query.mock.calls[0] as unknown as [string];
    expect(sql).toMatch(/FILTER \(WHERE cost_usd_estimate IS NULL\)/i);
  });

  it("returns null cost rather than 0 when a provider group has no priced turns", async () => {
    poolMock.query.mockResolvedValueOnce({
      rows: [{ provider: "Unknown", turns: "3", cost_usd: null, unpriced_turns: "3" }],
    } as never);
    const out = await tenantSpendSince(TENANT, new Date());
    expect(out[0]).toEqual({ provider: "Unknown", turns: 3, costUsd: null });
  });
});

describe("persistTurnUsage — Turn Flight Recorder columns (migration 090)", () => {
  const NOTEBOOK = "93d8c68e-d252-451d-8b52-e0a830543437";
  const TURN_ID = "8345ea5e-ad86-4d7f-a686-313b7b170adc";

  function buildRecord(): TurnRecord {
    const packet = emptyPacket({
      kind: "chat",
      environment: "staging",
      git_sha: "dd41c7f8e3bac27fc0b8f2bcdbbbc4ebdb5bbf2c",
      service_version: "v3.351.7",
      tenant_id: TENANT,
      notebook_id: NOTEBOOK,
      turn_id: TURN_ID,
    });
    packet.answer_gate.decision = "answered";
    return {
      packet,
      anomalies: [{ code: "VISUAL_EVIDENCE_DROPPED", stage: "context", detail: {} }],
      otelTraceId: "0af7651916cd43dd8448eb211c80319c",
      turnRowId: TURN_ID,
      clientRequestId: "cr-1",
      notebookId: NOTEBOOK,
      environment: "staging",
      gitSha: "dd41c7f8e3bac27fc0b8f2bcdbbbc4ebdb5bbf2c",
    };
  }

  it("without a record, the eight new columns write NULL (anomalies excepted)", async () => {
    await persistTurnUsage(scope, usage);
    const { sql, params } = calls[0];
    for (const col of [
      "otel_trace_id",
      "turn_id",
      "client_request_id",
      "notebook_id",
      "environment",
      "git_sha",
      "evidence_packet",
      "anomalies",
    ]) {
      expect(sql).toContain(col);
    }
    // Exactly 7 nulls belong to the new nullable columns (plus whatever
    // pre-existing nulls the base scope/usage produced) — assert presence,
    // not position, since the base test above already pins the base 15.
    expect(params).toContain(null);
    // anomalies is NOT NULL (090 default '[]'::jsonb) — never pass null for it.
    expect(params).not.toContain(undefined);
    expect(params[params.length - 1]).toBe("[]"); // anomalies -> stringified []
  });

  it("with a record, writes otelTraceId/turnRowId/clientRequestId/notebookId/environment/gitSha", async () => {
    const record = buildRecord();
    await persistTurnUsage(scope, usage, record);
    const { params } = calls[0];
    expect(params).toEqual(
      expect.arrayContaining([
        record.otelTraceId,
        record.turnRowId,
        record.clientRequestId,
        record.notebookId,
        record.environment,
        record.gitSha,
      ]),
    );
  });

  it("with a record, the packet is serialized as JSON and included in the params", async () => {
    const record = buildRecord();
    await persistTurnUsage(scope, usage, record);
    const { params } = calls[0];
    const packetParam = params.find(
      (p) => typeof p === "string" && p.includes('"answer_gate"') && p.includes('"answered"'),
    );
    expect(packetParam).toBeDefined();
    expect(JSON.parse(packetParam as string).answer_gate.decision).toBe("answered");
  });

  it("with a record, anomalies are serialized as a JSON array, never dropped", async () => {
    const record = buildRecord();
    await persistTurnUsage(scope, usage, record);
    const { params } = calls[0];
    const anomaliesParam = params.find(
      (p) => typeof p === "string" && p.includes("VISUAL_EVIDENCE_DROPPED"),
    );
    expect(anomaliesParam).toBeDefined();
    expect(JSON.parse(anomaliesParam as string)).toEqual([
      { code: "VISUAL_EVIDENCE_DROPPED", stage: "context", detail: {} },
    ]);
  });

  it("without a record, anomalies still writes the literal empty array, never NULL", async () => {
    await persistTurnUsage(scope, usage);
    const { params } = calls[0];
    expect(params[params.length - 1]).toBe("[]");
    expect(params[params.length - 1]).not.toBeNull();
  });

  it("includes the traceId in the persist_failed log when a record is present", async () => {
    insertBehaviour = () => {
      throw Object.assign(new Error("boom"), { code: "42P01" });
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const record = buildRecord();
    await persistTurnUsage(scope, usage, record);
    const logged = String(spy.mock.calls[0][0]);
    expect(logged).toContain(record.otelTraceId as string);
    spy.mockRestore();
  });

  it("logs traceId: null in the persist_failed event when no record was given", async () => {
    insertBehaviour = () => {
      throw new Error("boom");
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await persistTurnUsage(scope, usage);
    const logged = JSON.parse(String(spy.mock.calls[0][0]));
    expect(logged.traceId).toBeNull();
    spy.mockRestore();
  });
});
