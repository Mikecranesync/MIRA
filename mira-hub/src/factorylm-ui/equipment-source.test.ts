import { describe, expect, it } from "vitest";
import {
  browserItemOf,
  createHubEquipmentSource,
  equipmentNavAvailable,
  resolveFailureOf,
  resolveQuery,
  type ApiItem,
} from "./equipment-source";

const BASE = "/api/equipment-browser/";

function recorder(respond: (url: string) => Response | Promise<Response>) {
  const urls: string[] = [];
  const fetchImpl = async (url: string) => {
    urls.push(url);
    return respond(url);
  };
  return { urls, fetchImpl };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const component: ApiItem = {
  kind: "notebook_component",
  id: "c1",
  name: "VFD1",
  parent: { kind: "notebook", id: "n1" },
  childrenCount: 0,
  component: {
    retiredAt: null,
    kind: "drive",
    current: { revision: 3, localTag: "VFD1", rawLabel: "drive", manufacturer: "AutomationDirect", family: "GS10", catalogNumber: null },
  },
};

describe("browserItemOf", () => {
  it("maps a component row: tag, detail, revision, parent", () => {
    expect(browserItemOf(component)).toEqual({
      kind: "notebook_component",
      id: "c1",
      label: "VFD1",
      parent: { kind: "notebook", id: "n1" },
      childCount: 0,
      tag: "VFD1",
      detail: "AutomationDirect GS10",
      retiredAt: null,
      revision: 3,
    });
  });

  it("a component without a current record has revision 0", () => {
    expect(browserItemOf({ ...component, component: { retiredAt: null, kind: "drive", current: null } }).revision).toBe(0);
  });

  it("a root row has no parent", () => {
    const row: ApiItem = { kind: "namespace", id: "ns", name: "Plant", parent: { kind: "root", id: null }, childrenCount: 2 };
    expect(browserItemOf(row).parent).toBeNull();
  });

  it("an installed instance is visible but marked not linked", () => {
    const row: ApiItem = { kind: "installed_instance", id: "i1", name: "Pump", parent: { kind: "asset", id: "a1" }, childrenCount: 0 };
    expect(browserItemOf(row).resolution).toEqual({ status: "unmapped", reason: "no_link" });
  });
});

describe("resolveQuery", () => {
  const request = { kind: "notebook_component" as const, notebookId: "n1", componentId: "c1" };

  it("no selection: neither version nor thread is sent", () => {
    const q = resolveQuery(request);
    expect(q.has("selectionVersion")).toBe(false);
    expect(q.has("threadKey")).toBe(false);
  });

  it("a never-selected thread sends version none with the thread", () => {
    const q = resolveQuery({ ...request, expectedRevision: 3, selection: { threadKey: "t1", version: null } });
    expect(q.get("selectionVersion")).toBe("none");
    expect(q.get("threadKey")).toBe("t1");
    expect(q.get("expectedRevision")).toBe("3");
  });

  it("a numeric version is sent as a number", () => {
    expect(resolveQuery({ ...request, selection: { threadKey: "t1", version: 4 } }).get("selectionVersion")).toBe("4");
  });
});

describe("resolveFailureOf", () => {
  it.each([
    [409, "stale_revision", "stale_revision"],
    [409, "selection_changed", "selection_changed"],
    [409, "component_retired", "retired"],
    [404, "not_found", "not_found"],
    [404, "equipment_nav_disabled", "error"],
    [500, "internal", "error"],
  ])("%i %s → %s", (status, code, reason) => {
    expect(resolveFailureOf(status, code)).toBe(reason);
  });
});

describe("createHubEquipmentSource", () => {
  it("root children read and cursor", async () => {
    const { urls, fetchImpl } = recorder(() => json({ items: [component], counts: { total: 1 }, hasMore: true, nextCursor: "k2" }));
    const page = await createHubEquipmentSource(fetchImpl, BASE).children(null, { cursor: "k1" });
    expect(urls[0]).toBe(`${BASE}children/?parentKind=root&cursor=k1`);
    expect(page).toMatchObject({ total: 1, hasMore: true, nextCursor: "k2" });
    expect(page.items[0].id).toBe("c1");
  });

  it("a failed read throws the server's code instead of returning an empty page", async () => {
    const { fetchImpl } = recorder(() => json({ error: "equipment_nav_disabled" }, 404));
    await expect(createHubEquipmentSource(fetchImpl, BASE).search("vfd", null, {})).rejects.toThrow("equipment_nav_disabled");
  });

  it("resolve success names the notebook and component", async () => {
    const { urls, fetchImpl } = recorder(() => json({
      status: "resolved",
      notebook: { id: "n1", displayName: "Conveyor 1", locationLabel: "Garage" },
      component: { id: "c1", kind: "drive", current: { localTag: "VFD1", rawLabel: "drive" } },
    }));
    const result = await createHubEquipmentSource(fetchImpl, BASE).resolve(
      { kind: "notebook_component", notebookId: "n1", componentId: "c1", expectedRevision: 3 }, {});
    expect(urls[0].startsWith(`${BASE}resolve/?`)).toBe(true);
    expect(result).toEqual({
      ok: true,
      target: { machineId: "n1", machineLabel: "Conveyor 1", componentId: "c1", componentLabel: "VFD1", location: "Garage" },
    });
  });

  it("resolve 409 stale_revision is a refusal, not a target", async () => {
    const { fetchImpl } = recorder(() => json({ error: "stale_revision" }, 409));
    const result = await createHubEquipmentSource(fetchImpl, BASE).resolve(
      { kind: "notebook_component", notebookId: "n1", componentId: "c1", expectedRevision: 2 }, {});
    expect(result).toEqual({ ok: false, reason: "stale_revision" });
  });

  it("an unmapped answer is no_link", async () => {
    const { fetchImpl } = recorder(() => json({ status: "unmapped", reason: "no_link" }));
    const result = await createHubEquipmentSource(fetchImpl, BASE).resolve(
      { kind: "notebook_component", notebookId: "n1", componentId: "c1" }, {});
    expect(result).toEqual({ ok: false, reason: "no_link" });
  });
});

describe("equipmentNavAvailable", () => {
  it("true when the smallest read succeeds", async () => {
    const { urls, fetchImpl } = recorder(() => json({ items: [], counts: { total: 0 }, hasMore: false, nextCursor: null }));
    expect(await equipmentNavAvailable(fetchImpl, BASE)).toBe(true);
    expect(urls[0]).toBe(`${BASE}children/?parentKind=root&limit=1`);
  });

  it("false when the flag is off (404)", async () => {
    const { fetchImpl } = recorder(() => json({ error: "equipment_nav_disabled" }, 404));
    expect(await equipmentNavAvailable(fetchImpl, BASE)).toBe(false);
  });

  it("false when the network fails", async () => {
    expect(await equipmentNavAvailable(async () => { throw new Error("offline"); }, BASE)).toBe(false);
  });
});
