// Vitest coverage for the Phase 1 FactoryModel -> relationship_proposals writer (Phase 5 PR-2).
//
// Run: cd mira-hub && npx vitest run src/lib/factory-model-relationships
//
// The pure spec transform is DB-free. The resolver+writer is exercised with a mock pg client (for the
// kg_entities/tag_entities lookups) and a mocked canonical upsertInferredProposal — asserting endpoints
// resolve to existing entity ids and unresolved endpoints are reported, never invented.

import { describe, it, expect, vi } from "vitest";
import type { PoolClient } from "pg";

const upsertMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/knowledge-graph/proposals-writer", () => ({
  upsertInferredProposal: upsertMock,
}));

import {
  factoryModelToRelationshipSpecs,
  writeRelationshipProposals,
} from "@/lib/factory-model-relationships";

const LINE = "synthetic_beverage_co.demo_site.bottling.bottlingline1";
const CONV = `${LINE}.conveyor01`;
const CAP = `${LINE}.caploader01`;
const PHOTOEYE = `${CONV}.status.photoeye_blocked_value_value`;

const SAMPLE = {
  source: "synthetic_factory_export.json",
  nodes: [
    { level: "line", uns_path: LINE, name: "BottlingLine1" },
    { level: "asset", uns_path: CONV, name: "Conveyor01" },
    { level: "asset", uns_path: CAP, name: "CapLoader01" },
    {
      level: "signal",
      uns_path: PHOTOEYE,
      name: "Photoeye.Blocked.Value.Value",
      archetype: "live_bool",
      suggestion: { confidence: "medium" },
    },
    { level: "signal", uns_path: "", name: "Counts.Outfeed.Value.NumberFormat", archetype: "static_metadata" },
  ],
  relationships: [
    {
      rel_type: "feeds",
      source_path: CONV,
      target_path: CAP,
      suggestion: { confidence: "low", statement: "Inferred material flow CONV -> CAP." },
    },
    {
      rel_type: "contains",
      source_path: LINE,
      target_path: CONV,
      suggestion: { confidence: "high", statement: "Line contains asset." },
    },
  ],
};

describe("factoryModelToRelationshipSpecs", () => {
  const specs = factoryModelToRelationshipSpecs(SAMPLE);

  it("maps feeds → UPSTREAM_OF (asset→asset)", () => {
    const feeds = specs.find((s) => s.spineType === "feeds");
    expect(feeds).toMatchObject({ sourceUns: CONV, targetUns: CAP, relationshipType: "UPSTREAM_OF" });
    expect(feeds!.confidence).toBeCloseTo(0.35); // low band
  });

  it("maps contains → HAS_COMPONENT (hierarchy)", () => {
    const contains = specs.find((s) => s.spineType === "contains");
    expect(contains).toMatchObject({ sourceUns: LINE, targetUns: CONV, relationshipType: "HAS_COMPONENT" });
  });

  it("derives asset→signal HAS_SIGNAL containment (the 'contains' demo)", () => {
    const hs = specs.find((s) => s.spineType === "has_signal");
    expect(hs).toMatchObject({ sourceUns: CONV, targetUns: PHOTOEYE, relationshipType: "HAS_SIGNAL" });
  });

  it("skips static-metadata signals (no UNS path) and self-loops", () => {
    expect(specs.some((s) => s.targetUns === "")).toBe(false);
    expect(specs.every((s) => s.sourceUns !== s.targetUns)).toBe(true);
  });

  it("returns [] for an empty model", () => {
    expect(factoryModelToRelationshipSpecs({})).toEqual([]);
  });
});

describe("writeRelationshipProposals", () => {
  const TENANT = "11111111-1111-1111-1111-111111111111";
  // Resolver fixtures: assets are verified kg_entities, the photoeye signal is a verified tag_entity,
  // the LINE is NOT (yet) an entity.
  const KG: Record<string, string> = { [CONV]: "kg-conv", [CAP]: "kg-cap" };
  const TAG: Record<string, string> = { [PHOTOEYE]: "tag-photoeye" };

  function mockClient(): PoolClient {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      const uns = (params?.[1] as string) ?? "";
      if (/FROM kg_entities/.test(sql)) {
        const id = KG[uns];
        return { rows: id ? [{ id }] : [], rowCount: id ? 1 : 0 };
      }
      if (/FROM tag_entities/.test(sql)) {
        const id = TAG[uns];
        return { rows: id ? [{ id }] : [], rowCount: id ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    });
    return { query } as unknown as PoolClient;
  }

  it("creates UPSTREAM_OF (feeds) + HAS_SIGNAL (contains-demo); reports line→asset unresolved", async () => {
    upsertMock.mockReset();
    upsertMock.mockImplementation(async (_c: unknown, _t: string, p: { relationshipType: string }) => `rp-${p.relationshipType}`);

    const specs = factoryModelToRelationshipSpecs(SAMPLE);
    const res = await writeRelationshipProposals(mockClient(), TENANT, specs);

    expect(res.created.map((c) => c.relationshipType).sort()).toEqual(["HAS_SIGNAL", "UPSTREAM_OF"]);
    expect(res.unresolved).toEqual([
      { sourceUns: LINE, targetUns: CONV, relationshipType: "HAS_COMPONENT", missing: "source" },
    ]);

    // upsertInferredProposal received resolved entity ids + canonical types + manifest evidence.
    const feedsArg = upsertMock.mock.calls.find((c) => c[2].relationshipType === "UPSTREAM_OF")![2];
    expect(feedsArg).toMatchObject({
      sourceEntityId: "kg-conv",
      sourceEntityType: "equipment",
      targetEntityId: "kg-cap",
      targetEntityType: "equipment",
    });
    const hsArg = upsertMock.mock.calls.find((c) => c[2].relationshipType === "HAS_SIGNAL")![2];
    expect(hsArg).toMatchObject({
      sourceEntityId: "kg-conv",
      targetEntityId: "tag-photoeye",
      targetEntityType: "tag",
    });
    expect(hsArg.evidence[0].evidenceType).toBe("manifest");
  });

  it("records skipped when upsertInferredProposal returns null (already exists)", async () => {
    upsertMock.mockReset();
    upsertMock.mockResolvedValue(null);
    const specs = factoryModelToRelationshipSpecs(SAMPLE).filter((s) => s.spineType === "feeds");
    const res = await writeRelationshipProposals(mockClient(), TENANT, specs);
    expect(res.created).toEqual([]);
    expect(res.skipped[0]).toMatchObject({ relationshipType: "UPSTREAM_OF", reason: "already exists / verified" });
  });
});
