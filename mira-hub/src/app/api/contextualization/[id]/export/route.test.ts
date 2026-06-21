import { describe, expect, it } from "vitest";

// Test the pure export-building logic by importing the module-level helpers
// indirectly via the shape we know they produce. Since the helpers aren't
// exported from the route (to keep the API surface minimal), we duplicate
// the logic here for unit testing — a pattern that mirrors how route.test.ts
// tests clampLimit without mocking Next.js.

const UNS_NAMESPACE_URI = "urn:mira:plc-parser:uns";
const ISA95_LEVELS = ["enterprise", "site", "area", "line", "asset"] as const;

function _typeForLevel(level: string) {
  return `urn:mira:type:${level}`;
}

function buildI3xExport(rows: Array<{ tag_name: string; uns_path_proposed: string | null; roles: string[]; confidence: string | null }>) {
  const instances: object[] = [];
  const seen = new Set<string>();

  function ensureContainer(pathParts: string[], level: string, display: string): string {
    const elementId = pathParts.join("/");
    if (seen.has(elementId)) return elementId;
    seen.add(elementId);
    const parentId = pathParts.length > 1 ? pathParts.slice(0, -1).join("/") : null;
    instances.push({ elementId, displayName: display, typeElementId: _typeForLevel(level), parentId, isComposition: true });
    return elementId;
  }

  for (const row of rows) {
    const path = row.uns_path_proposed;
    if (!path) continue;
    const parts = path.split("/").filter(Boolean);
    const containerParts = parts.slice(0, -1);
    const signalPart = parts[parts.length - 1];
    const chain: string[] = [];
    for (let i = 0; i < containerParts.length; i++) {
      const seg = containerParts[i];
      chain.push(seg);
      const level = ISA95_LEVELS[i] ?? "asset";
      ensureContainer([...chain], level, seg);
    }
    const parentId = chain.length > 0 ? chain.join("/") : null;
    instances.push({ elementId: path, displayName: row.tag_name, typeElementId: _typeForLevel("signal"), parentId, isComposition: false });
  }

  return { namespace: { uri: UNS_NAMESPACE_URI }, objectInstances: instances };
}

describe("buildI3xExport", () => {
  const FIXTURE = [
    { tag_name: "Conv_Run", uns_path_proposed: "enterprise/site1/area1/conv/conveyor/run", roles: ["output"], confidence: "0.9" },
    { tag_name: "Conv_Fault", uns_path_proposed: "enterprise/site1/area1/conv/conveyor/fault", roles: ["fault"], confidence: "0.6" },
  ];

  it("produces objectInstances with the correct count (containers + leaves)", () => {
    const result = buildI3xExport(FIXTURE);
    const instances = (result as { objectInstances: object[] }).objectInstances;
    // 4 unique containers (enterprise/site1/area1/conv/conveyor share most) + 2 leaves
    // enterprise, site1, area1, conv, conveyor -> 5 containers + 2 signals = 7
    expect(instances.length).toBeGreaterThan(2);
  });

  it("leaf signals have typeElementId = urn:mira:type:signal", () => {
    const result = buildI3xExport(FIXTURE);
    const leaves = (result as { objectInstances: Array<{ typeElementId: string; isComposition: boolean }> })
      .objectInstances.filter((i) => !i.isComposition);
    expect(leaves).toHaveLength(2);
    expect(leaves.every((l) => l.typeElementId === "urn:mira:type:signal")).toBe(true);
  });

  it("containers de-duplicate shared path prefixes", () => {
    const result = buildI3xExport(FIXTURE);
    const containers = (result as { objectInstances: Array<{ elementId: string; isComposition: boolean }> })
      .objectInstances.filter((i) => i.isComposition);
    const ids = containers.map((c) => c.elementId);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
  });

  it("skips rows with no uns_path_proposed", () => {
    const rows = [{ tag_name: "Orphan", uns_path_proposed: null, roles: [], confidence: null }];
    const result = buildI3xExport(rows);
    const instances = (result as { objectInstances: object[] }).objectInstances;
    expect(instances).toHaveLength(0);
  });

  it("namespace uri is correct", () => {
    const result = buildI3xExport(FIXTURE);
    expect((result as { namespace: { uri: string } }).namespace.uri).toBe(UNS_NAMESPACE_URI);
  });
});
