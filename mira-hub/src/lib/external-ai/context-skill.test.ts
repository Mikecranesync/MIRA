import { describe, expect, it, vi } from "vitest";
import { createFactoryLmContextSkill, type FactoryLmToolCall } from "./context-skill";
import type { DbClient } from "@/lib/i3x/data-access";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

function mockClient(handlers: Array<[RegExp, unknown[]]>): DbClient & { calls: Array<{ sql: string; params?: unknown[] }> } {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const query: DbClient["query"] = async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    const hit = handlers.find(([pattern]) => pattern.test(sql));
    if (!hit) throw new Error(`unhandled query: ${sql}`);
    return { rows: hit[1] as T[] };
  };
  return {
    calls,
    query,
  };
}

function skillFor(client: DbClient) {
  return createFactoryLmContextSkill({
    runWithTenant: async (tenantId, fn) => {
      expect(tenantId).toBe(TENANT_ID);
      return fn(client);
    },
  });
}

function call(tool: string, input: Record<string, unknown> = {}): FactoryLmToolCall {
  return { tool, input, context: { tenantId: TENANT_ID } };
}

describe("FactoryLM external AI context skill", () => {
  it("refuses unsupported/write-like tools before touching the database", async () => {
    const runWithTenant = vi.fn();
    const skill = createFactoryLmContextSkill({ runWithTenant });

    const res = await skill.call(call("write_tag", { tag: "pump01.speed", value: 100 }));

    expect(res.ok).toBe(false);
    expect(res.found).toBe(false);
    expect(res.refusedReason).toMatch(/read-only/i);
    expect(runWithTenant).not.toHaveBeenCalled();
  });

  it("find_asset returns verified structured asset candidates with evidence", async () => {
    const client = mockClient([
      [/FROM kg_entities[\s\S]*approval_state = 'verified'[\s\S]*ORDER BY/, [
        {
          id: "asset-1",
          entity_id: "filler01",
          entity_type: "equipment",
          name: "Filler 01",
          approval_state: "verified",
          uns_path: "enterprise.demo.plant.line01.filler01",
          properties: { manufacturer: "Acme", model: "F100" },
        },
      ]],
    ]);

    const res = await skillFor(client).call(call("find_asset", { query: "filler" }));

    expect(res.ok).toBe(true);
    expect(res.found).toBe(true);
    expect(res.approvalState).toBe("verified");
    expect(res.data).toMatchObject({
      query: "filler",
      results: [
        {
          assetId: "asset-1",
          entityId: "filler01",
          unsPath: "enterprise.demo.plant.line01.filler01",
          approvalState: "verified",
        },
      ],
    });
    expect(res.evidence[0]).toMatchObject({
      sourceType: "kg_entity",
      sourceId: "asset-1",
      approvalState: "verified",
    });
  });

  it("get_live_value is fail-closed behind approved_tags and projects an i3X current value", async () => {
    const client = mockClient([
      [/FROM approved_tags[\s\S]*LIMIT 1/, [
        {
          uns_path: "enterprise.demo.line01.filler01.bowl_pressure",
          source_system: "ignition",
          source_tag_path: "Line01/Filler01/BowlPressure",
          normalized_tag_path: "line01.filler01.bowl_pressure",
          enabled: true,
        },
      ]],
      [/FROM live_signal_cache/, [
        {
          uns_path: "enterprise.demo.line01.filler01.bowl_pressure",
          last_value_text: null,
          last_value_numeric: 5.2,
          last_value_bool: null,
          latest_quality: "good",
          freshness_status: "live",
          last_seen_at: "2026-06-24T12:00:00.000Z",
        },
      ]],
    ]);

    const res = await skillFor(client).call(call("get_live_value", {
      tag_or_uns_path: "enterprise.demo.line01.filler01.bowl_pressure",
    }));

    expect(res.ok).toBe(true);
    expect(res.approvalState).toBe("approved");
    expect(res.data).toMatchObject({
      unsPath: "enterprise.demo.line01.filler01.bowl_pressure",
      currentValue: {
        value: 5.2,
        quality: "Good",
        timestamp: "2026-06-24T12:00:00.000Z",
      },
    });
    expect(res.evidence.map((e) => e.sourceType)).toEqual(["approved_tag", "live_signal_cache"]);
  });

  it("get_live_value returns a clear not-found when a tag is not approved", async () => {
    const client = mockClient([[/FROM approved_tags[\s\S]*LIMIT 1/, []]]);

    const res = await skillFor(client).call(call("get_live_value", { tag_or_uns_path: "raw.plc.secret" }));

    expect(res.ok).toBe(true);
    expect(res.found).toBe(false);
    expect(res.notFoundReason).toMatch(/approved/i);
  });

  it("search_approved_evidence defaults to verified chunks only", async () => {
    const client = mockClient([
      [/FROM kg_entities[\s\S]*entity_type IN/, [
        {
          id: "asset-1",
          entity_id: "filler01",
          entity_type: "equipment",
          name: "Filler 01",
          approval_state: "verified",
          uns_path: "enterprise.demo.line01.filler01",
          properties: {},
        },
      ]],
      [/FROM knowledge_entries/, [
        {
          id: "chunk-1",
          content: "F010 indicates low filler bowl pressure.",
          source_url: "manuals/filler.pdf",
          source_page: 42,
          page_start: null,
          title: "Filler troubleshooting",
          filename: "troubleshooting.md",
          verified: true,
          rank: 1,
        },
      ]],
    ]);

    const res = await skillFor(client).call(call("search_approved_evidence", {
      asset_id: "asset-1",
      query: "F010 bowl pressure",
    }));

    expect(res.ok).toBe(true);
    expect(res.approvalState).toBe("verified");
    expect(res.data).toMatchObject({
      results: [{ content: "F010 indicates low filler bowl pressure.", approvalState: "verified" }],
    });
    const evidenceQuery = client.calls.find((c) => /FROM knowledge_entries/.test(c.sql));
    expect(evidenceQuery?.params?.[4]).toBe(false);
    expect(evidenceQuery?.sql).toMatch(/verified = true/);
  });

  it("get_asset_context returns asset metadata, verified components, and approved tags", async () => {
    const client = mockClient([
      [/FROM kg_entities[\s\S]*entity_type IN/, [
        {
          id: "asset-1",
          entity_id: "filler01",
          entity_type: "equipment",
          name: "Filler 01",
          approval_state: "verified",
          uns_path: "enterprise.demo.line01.filler01",
          properties: { model_number: "F100" },
        },
      ]],
      [/FROM kg_relationships r[\s\S]*relationship_type IN/, [
        {
          id: "component-1",
          entity_id: "filler01_regulator",
          entity_type: "component",
          name: "Bowl Pressure Regulator",
          approval_state: "verified",
          uns_path: "enterprise.demo.line01.filler01.regulator",
          properties: {},
          relationship_type: "has_component",
        },
      ]],
      [/FROM approved_tags[\s\S]*uns_path <@/, [
        {
          uns_path: "enterprise.demo.line01.filler01.bowl_pressure",
          source_system: "ignition",
          source_tag_path: "Line01/Filler01/BowlPressure",
          normalized_tag_path: "line01.filler01.bowl_pressure",
          enabled: true,
        },
      ]],
    ]);

    const res = await skillFor(client).call(call("get_asset_context", { asset_id: "asset-1" }));

    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({
      asset: { assetId: "asset-1", unsPath: "enterprise.demo.line01.filler01", model: "F100" },
      components: [{ assetId: "component-1", relationshipType: "has_component" }],
      approvedTags: [{ unsPath: "enterprise.demo.line01.filler01.bowl_pressure" }],
    });
    expect(res.evidence.some((e) => e.sourceType === "approved_tag")).toBe(true);
  });

  it("list_related_assets uses verified i3X relationship helpers", async () => {
    const client = mockClient([
      [/FROM kg_entities[\s\S]*entity_type IN/, [
        {
          id: "asset-1",
          entity_id: "casepacker01",
          entity_type: "equipment",
          name: "Case Packer 01",
          approval_state: "verified",
          uns_path: "enterprise.demo.line01.casepacker01",
          properties: {},
        },
      ]],
      [/FROM kg_relationships[\s\S]*source_id = \$1 OR target_id = \$1/, [
        {
          source_id: "asset-1",
          target_id: "asset-2",
          relationship_type: "feeds",
          approval_state: "verified",
        },
      ]],
      [/WHERE id = ANY/, [
        {
          id: "asset-2",
          entity_type: "equipment",
          name: "Palletizer 01",
          approval_state: "verified",
          uns_path: "enterprise.demo.line01.palletizer01",
          properties: {},
        },
      ]],
    ]);

    const res = await skillFor(client).call(call("list_related_assets", { asset_id: "casepacker01" }));

    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({
      related: [
        {
          relationship: "feeds",
          assetId: "asset-2",
          name: "Palletizer 01",
          unsPath: "enterprise.demo.line01.palletizer01",
        },
      ],
    });
    expect(res.evidence).toContainEqual(expect.objectContaining({
      sourceType: "kg_relationship",
      approvalState: "verified",
    }));
  });

  it("get_diagnostic_context returns verified fault context without prose generation", async () => {
    const client = mockClient([
      [/FROM kg_entities e[\s\S]*entity_type IN \('fault'/, [
        {
          id: "fault-1",
          entity_id: "F010",
          entity_type: "fault_code",
          name: "Low Bowl Pressure",
          approval_state: "verified",
          uns_path: "enterprise.demo.line01.filler01.fault_codes.f010",
          properties: { expected_action: "Inspect bowl pressure regulator" },
          relationship_type: "had_fault",
        },
      ]],
    ]);

    const res = await skillFor(client).call(call("get_diagnostic_context", { fault_code: "F010" }));

    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({
      faultCode: "F010",
      results: [
        {
          id: "fault-1",
          entityId: "F010",
          entityType: "fault_code",
          approvalState: "verified",
        },
      ],
    });
    expect(JSON.stringify(res.data)).not.toMatch(/you should/i);
  });

  it("search_simlab_scenarios reads local deterministic scenario fixtures", async () => {
    const skill = createFactoryLmContextSkill({
      readDir: vi.fn(async () => ["juice_filler_underfill_01.yaml"] as never),
      readTextFile: vi.fn(async () => `id: juice_filler_underfill_01
name: "Filler 01 - Underfill from Low Bowl Pressure"
machine_type: rotary_filler
tags: [underfill, bowl_pressure, juice_bottling]
simlab_scenario_id: filler_underfill_low_bowl_pressure
simlab_asset_id: filler01
machine_context:
  uns_path: "enterprise.demo.line01"
fault:
  root_cause: low_filler_bowl_pressure
  root_cause_component: filler01
` as never),
    });

    const res = await skill.call(call("search_simlab_scenarios", { query: "bowl pressure underfill" }));

    expect(res.ok).toBe(true);
    expect(res.approvalState).toBe("internal");
    expect(res.data).toMatchObject({
      results: [
        {
          scenarioId: "juice_filler_underfill_01",
          simlabScenarioId: "filler_underfill_low_bowl_pressure",
          simlabAssetId: "filler01",
          rootCause: "low_filler_bowl_pressure",
          rootCauseComponent: "filler01",
          citation: "juice_filler_underfill_01.yaml",
        },
      ],
    });
    expect(res.evidence[0]).toMatchObject({
      sourceType: "simlab_scenario",
      approvalState: "internal",
    });
  });
});
