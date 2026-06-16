import { describe, expect, it } from "vitest";
import { buildTree, isMaintenanceNamespacePath, type NamespaceNode } from "./route";

interface EntityFixture {
  id: string;
  entity_type: string;
  entity_id: string;
  name: string;
  uns_path: string | null;
  created_at: string;
  files_count: string;
  equipment_status: string | null;
}

function entity(p: Partial<EntityFixture> & { id: string }): EntityFixture {
  return {
    entity_type: "equipment",
    entity_id: p.id,
    name: p.name ?? p.id,
    uns_path: null,
    created_at: "2026-05-19T00:00:00Z",
    files_count: "0",
    equipment_status: null,
    ...p,
  };
}

function findByPath(nodes: NamespaceNode[], path: string): NamespaceNode | null {
  for (const n of nodes) {
    if (n.unsPath === path) return n;
    const inChild = findByPath(n.children, path);
    if (inChild) return inChild;
  }
  return null;
}

describe("buildTree — namespace tree", () => {
  it("nests entities under existing parent entities (wizard path)", () => {
    const entities = [
      entity({ id: "site-1", entity_type: "site", name: "Lake Wales", uns_path: "enterprise.lake_wales" }),
      entity({ id: "line-1", entity_type: "line", name: "Line A", uns_path: "enterprise.lake_wales.line_a" }),
      entity({ id: "eq-1", entity_type: "equipment", name: "Pump-01", uns_path: "enterprise.lake_wales.line_a.pump_01" }),
    ];
    const roots = buildTree(entities, []);
    expect(roots).toHaveLength(1);
    const site = findByPath(roots, "enterprise.lake_wales");
    expect(site?.kind).toBe("site");
    expect(site?.children).toHaveLength(1);
    expect(site?.children[0].unsPath).toBe("enterprise.lake_wales.line_a");
    expect(site?.children[0].children[0].unsPath).toBe("enterprise.lake_wales.line_a.pump_01");
  });

  it("synthesizes missing ancestor nodes so orphan leaves nest correctly (#1344)", () => {
    // Real bug shape: a manual row with a deep path but no intermediate parent rows.
    const entities = [
      entity({
        id: "manual-siemens-sinamics",
        entity_type: "manual",
        name: "Siemens SINAMICS Manual",
        uns_path: "enterprise.knowledge_base.siemens.sinamics.manuals",
      }),
    ];
    const roots = buildTree(entities, []);

    // Only one root: the synthesized 'enterprise' namespace.
    expect(roots).toHaveLength(1);
    expect(roots[0].unsPath).toBe("enterprise");
    expect(roots[0].kind).toBe("namespace");
    expect(roots[0].id).toBe("synthetic:enterprise");

    // The full path is reachable through synthesized parents.
    expect(findByPath(roots, "enterprise.knowledge_base")?.kind).toBe("namespace");
    expect(findByPath(roots, "enterprise.knowledge_base.siemens")?.name).toBe("Siemens");
    expect(findByPath(roots, "enterprise.knowledge_base.siemens.sinamics")?.name).toBe("Sinamics");

    const manualNode = findByPath(roots, "enterprise.knowledge_base.siemens.sinamics.manuals");
    expect(manualNode?.kind).toBe("manual");
    expect(manualNode?.id).toBe("manual-siemens-sinamics");
  });

  it("merges multiple orphans under a single synthesized ancestor", () => {
    const entities = [
      entity({
        id: "m1",
        entity_type: "manual",
        name: "Siemens Manual",
        uns_path: "enterprise.knowledge_base.siemens.sinamics.manuals",
      }),
      entity({
        id: "m2",
        entity_type: "manual",
        name: "Allen Manual",
        uns_path: "enterprise.knowledge_base.allen_bradley.powerflex_525.manuals",
      }),
    ];
    const roots = buildTree(entities, []);
    expect(roots).toHaveLength(1);
    const kb = findByPath(roots, "enterprise.knowledge_base");
    expect(kb?.children).toHaveLength(2);
    // Display name title-cases segments split by underscore.
    expect(findByPath(roots, "enterprise.knowledge_base.allen_bradley")?.name).toBe("Allen Bradley");
  });

  it("synthesized parents have zero proposal counts and synthetic id prefix", () => {
    const roots = buildTree(
      [entity({ id: "m1", entity_type: "manual", uns_path: "enterprise.knowledge_base.siemens" })],
      [{ uns_path: "enterprise.knowledge_base", status: "proposed", cnt: "5" }],
    );
    const kb = findByPath(roots, "enterprise.knowledge_base");
    expect(kb?.id).toBe("synthetic:enterprise.knowledge_base");
    // Proposals attach to real entity rows only — synthetic parents stay at zero.
    expect(kb?.counts.proposalsPending).toBe(0);
  });

  it("does not synthesize when all parents already have real rows", () => {
    const entities = [
      entity({ id: "ent", entity_type: "namespace_root", uns_path: "enterprise", name: "Enterprise" }),
      entity({ id: "site", entity_type: "site", uns_path: "enterprise.lake_wales", name: "Lake Wales" }),
      entity({ id: "eq", entity_type: "equipment", uns_path: "enterprise.lake_wales.pump", name: "Pump" }),
    ];
    const roots = buildTree(entities, []);
    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe("ent");
    expect(roots[0].kind).toBe("namespace_root");
  });

  it("entities with null uns_path remain top-level roots", () => {
    const entities = [
      entity({ id: "orphan-1", entity_type: "tag", name: "Loose Tag", uns_path: null }),
      entity({ id: "eq-1", entity_type: "equipment", uns_path: "enterprise.site.eq", name: "EQ" }),
    ];
    const roots = buildTree(entities, []);
    // Loose tag stays as a root; the equipment forms its own synthesized tree.
    expect(roots.length).toBeGreaterThanOrEqual(2);
    expect(roots.some((r) => r.id === "orphan-1")).toBe(true);
  });

  it("excludes stray non-enterprise-rooted rows (audit test areas, #1983)", () => {
    const entities = [
      entity({ id: "site", entity_type: "site", name: "Lake Wales", uns_path: "enterprise.lake_wales" }),
      entity({ id: "orphan", entity_type: "tag", name: "Loose Tag", uns_path: null }),
      // Junk: flat 'audit_<rand>' areas from a historical test harness.
      entity({ id: "a1", entity_type: "area", name: "Audit 0o494d 0O494D", uns_path: "audit_0o494d_0o494d" }),
      entity({ id: "a2", entity_type: "area", name: "Audit 1ldrbh 1LDRBH", uns_path: "audit_1ldrbh_1ldrbh" }),
    ];
    const roots = buildTree(entities, []);
    expect(findByPath(roots, "audit_0o494d_0o494d")).toBeNull();
    expect(roots.some((r) => r.name.startsWith("Audit "))).toBe(false);
    // Real enterprise node + the legitimately-unpathed orphan survive.
    expect(findByPath(roots, "enterprise.lake_wales")?.kind).toBe("site");
    expect(roots.some((r) => r.id === "orphan")).toBe(true);
  });
});

describe("isMaintenanceNamespacePath", () => {
  it("keeps enterprise-rooted and null paths, drops flat non-UNS roots", () => {
    expect(isMaintenanceNamespacePath(null)).toBe(true);
    expect(isMaintenanceNamespacePath("enterprise")).toBe(true);
    expect(isMaintenanceNamespacePath("enterprise.lake_wales.line_a")).toBe(true);
    expect(isMaintenanceNamespacePath("audit_0o494d_0o494d")).toBe(false);
    expect(isMaintenanceNamespacePath("enterprises_fake")).toBe(false);
  });
});
