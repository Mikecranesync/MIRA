/**
 * POST /api/equipment-notebooks/[id]/components/[componentId]/revisions: a saved identity answers with the
 * repeated-serial advisory beside the existing fields. The advisory is a warning only: it never changes the
 * status code or the existing values, a failing lookup never turns a committed save into an error, and a
 * refused save never runs the lookup.
 *
 * Run: npx vitest run src/capabilities/bench-components/__tests__/revisions-route.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const COMPONENT = "44444444-4444-4444-8444-444444444444";
const REQUEST = "55555555-5555-4555-8555-555555555555";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })) }));
const store = vi.hoisted(() => ({ reviseComponent: vi.fn(), getSelection: vi.fn(), advanceSelectionRevision: vi.fn() }));
vi.mock("@/capabilities/bench-components/store", () => store);
const lookup = vi.hoisted(() => ({
  sameSerialAdvisory: vi.fn(),
  SAME_SERIAL_LOOKUP_FAILED: { status: "not_checked", reason: "lookup_failed" },
}));
vi.mock("@/capabilities/bench-components/same-serial", () => lookup);

import { POST } from "@/app/api/equipment-notebooks/[id]/components/[componentId]/revisions/route";

const post = (body: Record<string, unknown>) =>
  POST(
    new NextRequest(`http://hub.test/api/equipment-notebooks/${NB}/components/${COMPONENT}/revisions`, { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: NB, componentId: COMPONENT }) },
  );
const save = (over: Record<string, unknown> = {}) => ({
  clientRequestId: REQUEST,
  expectedRevision: 1,
  confirm: true,
  rawLabel: "GS11N-20P2",
  manufacturer: "AutomationDirect",
  catalogNumber: "GS11N-20P2",
  serialNumber: "SN-0077A",
  localTag: "VFD1",
  ...over,
});

const revision = (over: Record<string, unknown> = {}) => ({
  componentId: COMPONENT,
  revision: 2,
  rawLabel: "GS11N-20P2",
  inputKind: "typed",
  manufacturer: "AutomationDirect",
  family: null,
  catalogNumber: "GS11N-20P2",
  serialNumber: "SN-0077A",
  hardwareRevision: null,
  localTag: "VFD1",
  identityStatus: "user_confirmed",
  unresolved: [],
  evidenceFileId: null,
  evidenceNote: null,
  confirmedAt: "2026-11-19T10:00:00.000Z",
  createdAt: "2026-11-19T10:00:00.000Z",
  ...over,
});
const component = { id: COMPONENT, notebookId: NB, position: 0, kind: "drive", origin: "technician", createdAt: "2026-11-01T00:00:00.000Z", retiredAt: null, current: revision() };
const checked = {
  status: "checked",
  candidates: [{ componentId: "66666666-6666-4666-8666-666666666666", notebookId: NB, notebookName: "Line 2", label: "VFD2 · Siemens 6SL3210", retired: false }],
  truncated: false,
};
const LOOKUP_FAILED = { status: "not_checked", reason: "lookup_failed" };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  store.reviseComponent.mockReset();
  store.reviseComponent.mockResolvedValue({ status: "created", component, previous: revision({ revision: 1, serialNumber: null, identityStatus: "candidate", confirmedAt: null }) });
  lookup.sameSerialAdvisory.mockReset();
  lookup.sameSerialAdvisory.mockResolvedValue(checked);
});

describe("same serial: revisions POST", () => {
  it("same serial: a confirm that creates a revision answers 201 with exactly the old fields plus the advisory as the lookup returned it", async () => {
    const res = await post(save());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      status: "created",
      current: component.current,
      changed: ["serialNumber"],
      selection: null,
      sameSerial: checked,
    });
  });

  it("same serial: the lookup is asked once, with the caller's tenant and the component the store returned", async () => {
    await post(save());
    expect(lookup.sameSerialAdvisory).toHaveBeenCalledTimes(1);
    expect(lookup.sameSerialAdvisory.mock.calls[0]).toHaveLength(2);
    expect(lookup.sameSerialAdvisory.mock.calls[0][0]).toBe(TENANT);
    expect(lookup.sameSerialAdvisory.mock.calls[0][1]).toBe(component);
  });

  it.each([["existing"], ["unchanged"]])("same serial: a save the store reports as %s answers 200 and still carries the advisory", async (status) => {
    store.reviseComponent.mockResolvedValue({ status, component, previous: null });
    const res = await post(save());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status, current: component.current, changed: [], selection: null, sameSerial: checked });
    expect(lookup.sameSerialAdvisory).toHaveBeenCalledTimes(1);
    expect(lookup.sameSerialAdvisory.mock.calls[0][1]).toBe(component);
  });

  it("same serial: a lookup that was not run is passed through as it is", async () => {
    const notChecked = { status: "not_checked", reason: "not_confirmed" };
    lookup.sameSerialAdvisory.mockResolvedValue(notChecked);
    const res = await post(save());
    expect(res.status).toBe(201);
    expect((await res.json()).sameSerial).toEqual(notChecked);
  });

  it.each([
    ["rejects", () => lookup.sameSerialAdvisory.mockRejectedValue(new Error("db down"))],
    ["throws at once", () => lookup.sameSerialAdvisory.mockImplementation(() => { throw new Error("boom"); })],
  ])("same serial: a lookup that %s still leaves the committed save answering 201 with lookup_failed", async (_name, arrange) => {
    arrange();
    const res = await post(save());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      status: "created",
      current: component.current,
      changed: ["serialNumber"],
      selection: null,
      sameSerial: LOOKUP_FAILED,
    });
  });

  it.each([
    ["a component that is not there is a 404", { status: "component_not_found" }, 404],
    ["a reused request id is a 409", { status: "request_id_conflict" }, 409],
    ["a save against an older view is a 409", { status: "stale_revision", component }, 409],
  ])("same serial: control: %s and the lookup is not run", async (_name, result, status) => {
    store.reviseComponent.mockResolvedValue(result);
    expect((await post(save())).status).toBe(status);
    expect(lookup.sameSerialAdvisory).not.toHaveBeenCalled();
  });

  it("same serial: control: an invalid body is a 400 and neither the save nor the lookup runs", async () => {
    expect((await post(save({ clientRequestId: "nope" }))).status).toBe(400);
    expect(store.reviseComponent).not.toHaveBeenCalled();
    expect(lookup.sameSerialAdvisory).not.toHaveBeenCalled();
  });

  it("same serial: control: a save that fails in the store is not turned into an answer and the lookup is not run", async () => {
    store.reviseComponent.mockRejectedValue(new Error("connection reset"));
    await expect(post(save())).rejects.toThrow("connection reset");
    expect(lookup.sameSerialAdvisory).not.toHaveBeenCalled();
  });
});
