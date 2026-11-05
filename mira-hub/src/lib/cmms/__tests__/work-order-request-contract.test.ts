/**
 * Shared conformance suite for `createWorkOrder` / `readBackWorkOrder`
 * (#5020 TASK-OUTBOX-CREATE-WO), run against BOTH the in-memory mock and the
 * Atlas adapter (mocked `AtlasWorkOrderApi`) — same discipline as
 * `write-provider-contract.test.ts`'s `runWriteProviderContract`. Idempotent
 * on `marker`: a double create never produces a second order; `outcome_unknown`
 * is reconciled by read-back only.
 */
import { describe, expect, it } from "vitest";

import { AtlasWriteProvider, atlasWriteProviderFromClient, type AtlasWorkOrderApi } from "../atlas-write-provider";
import { MockCmmsWriteProvider } from "../mock-write-provider";
import { type CmmsWriteProvider, type WorkOrderRequest, markerFor } from "../write-contract";

function makeRequest(eventId: string, over: Partial<WorkOrderRequest> = {}): WorkOrderRequest {
  return {
    idempotencyKey: `idem-${eventId}`,
    marker: markerFor(eventId),
    title: "PM — Pump 07",
    description: "Technician-confirmed work order request from the living sheet.",
    priority: "MEDIUM",
    externalAssetId: null,
    attributionLabel: "Mike via MIRA",
    occurredAt: "2026-11-04T12:00:00.000Z",
    sourceRef: `work_sheet_jobs:${eventId}`,
    ...over,
  };
}

// ── FakeAtlasWorkOrderApi — in-memory stand-in for AtlasClient's WO methods ──

interface FakeWorkOrder {
  id: number;
  description: string;
}

class FakeAtlasWorkOrderApi implements AtlasWorkOrderApi {
  private readonly orders: FakeWorkOrder[] = [];
  private nextId = 1;
  private pendingCreateFailure: "throw5xx" | "throw4xx" | null = null;
  /** The `priority` string Atlas actually received on the last create call —
   *  lets a test confirm Hub-shaped priority ("medium") reaches Atlas
   *  already converted to its uppercase enum, never passed through raw. */
  lastPriority: string | null = null;

  failNextCreate(kind: "throw5xx" | "throw4xx"): void {
    this.pendingCreateFailure = kind;
  }

  async createWorkOrder(payload: { title: string; description: string; priority: string }): Promise<{ id: number }> {
    this.lastPriority = payload.priority;
    if (this.pendingCreateFailure === "throw5xx") {
      this.pendingCreateFailure = null;
      const { AtlasHttpError } = await import("@/lib/atlas/client");
      throw new AtlasHttpError(503, "atlas down", "/work-orders");
    }
    if (this.pendingCreateFailure === "throw4xx") {
      this.pendingCreateFailure = null;
      const { AtlasHttpError } = await import("@/lib/atlas/client");
      throw new AtlasHttpError(422, "bad request", "/work-orders");
    }
    const order: FakeWorkOrder = { id: this.nextId++, description: payload.description };
    this.orders.push(order);
    return { id: order.id };
  }

  async searchWorkOrders(payload: { pageSize?: number; pageNum?: number }): Promise<{ content: FakeWorkOrder[] }> {
    const pageSize = payload.pageSize ?? 25;
    const pageNum = payload.pageNum ?? 0;
    return { content: this.orders.slice(pageNum * pageSize, (pageNum + 1) * pageSize) };
  }

  count(): number {
    return this.orders.length;
  }
}

type Factory = () => { provider: CmmsWriteProvider; creates: () => number };

function mockFactory(): { provider: CmmsWriteProvider; creates: () => number } {
  const mock = new MockCmmsWriteProvider();
  return { provider: mock, creates: () => mock.creates };
}

function atlasFactory(): { provider: CmmsWriteProvider; creates: () => number } {
  const fakeComments = {
    countComments: async () => ({ count: 0 }),
    createComment: async () => {
      throw new Error("not used in this suite");
    },
    searchComments: async () => [],
  };
  const fakeWorkOrders = new FakeAtlasWorkOrderApi();
  const provider = new AtlasWriteProvider(fakeComments, { workOrders: fakeWorkOrders });
  return { provider, creates: () => fakeWorkOrders.count() };
}

function runCreateWorkOrderContract(label: string, factory: Factory) {
  describe(`createWorkOrder/readBackWorkOrder contract — ${label}`, () => {
    it("creates exactly once for a fresh marker", async () => {
      const { provider, creates } = factory();
      const req = makeRequest("evt-1");
      const result = await provider.createWorkOrder(req);
      expect(["verified_by_readback", "accepted_pending_verification"]).toContain(result.kind);
      expect(creates()).toBe(1);
    });

    it("double create (same marker) never creates a second order", async () => {
      const { provider, creates } = factory();
      const req = makeRequest("evt-2");
      await provider.createWorkOrder(req);
      const second = await provider.createWorkOrder(req);
      expect(second.kind).toBe("verified_by_readback");
      expect(creates()).toBe(1);
    });

    it("readBackWorkOrder finds a created order by marker", async () => {
      const { provider } = factory();
      const req = makeRequest("evt-3");
      const created = await provider.createWorkOrder(req);
      if (created.kind !== "verified_by_readback" && created.kind !== "accepted_pending_verification") {
        throw new Error(`unexpected create kind: ${created.kind}`);
      }
      const readBack = await provider.readBackWorkOrder(req.marker);
      expect(readBack.kind).toBe("found");
    });

    it("readBackWorkOrder reports not_found for an unknown marker", async () => {
      const { provider } = factory();
      const readBack = await provider.readBackWorkOrder(markerFor("nonexistent"));
      expect(readBack.kind).toBe("not_found");
    });
  });
}

runCreateWorkOrderContract("mock", mockFactory);
runCreateWorkOrderContract("atlas", atlasFactory);

describe("createWorkOrder/readBackWorkOrder — mock-specific failure injection", () => {
  it("lost_response: order IS created, outcome reported unknown; a retry with the same marker finds it (no second create)", async () => {
    const mock = new MockCmmsWriteProvider();
    const req = makeRequest("evt-lost");
    mock.failNextCreate("lost_response");
    const first = await mock.createWorkOrder(req);
    expect(first.kind).toBe("outcome_unknown");
    expect(mock.creates).toBe(1);

    const retry = await mock.createWorkOrder(req);
    expect(retry.kind).toBe("verified_by_readback");
    expect(mock.creates).toBe(1);
  });

  it("retryable_failure does not create an order", async () => {
    const mock = new MockCmmsWriteProvider();
    const req = makeRequest("evt-retry");
    mock.failNextCreate("retryable_failure");
    const result = await mock.createWorkOrder(req);
    expect(result.kind).toBe("retryable_failure");
    expect(mock.creates).toBe(0);
  });
});

describe("createWorkOrder — atlas-specific error mapping", () => {
  it("a 5xx on create maps to outcome_unknown (ambiguous, never re-created blindly)", async () => {
    const fakeComments = {
      countComments: async () => ({ count: 0 }),
      createComment: async () => {
        throw new Error("not used");
      },
      searchComments: async () => [],
    };
    const fakeWorkOrders = new FakeAtlasWorkOrderApi();
    fakeWorkOrders.failNextCreate("throw5xx");
    const provider = new AtlasWriteProvider(fakeComments, { workOrders: fakeWorkOrders });
    const result = await provider.createWorkOrder(makeRequest("evt-5xx"));
    expect(result.kind).toBe("outcome_unknown");
  });

  it("a 4xx on create maps to a closed-set failure, never outcome_unknown", async () => {
    const fakeComments = {
      countComments: async () => ({ count: 0 }),
      createComment: async () => {
        throw new Error("not used");
      },
      searchComments: async () => [],
    };
    const fakeWorkOrders = new FakeAtlasWorkOrderApi();
    fakeWorkOrders.failNextCreate("throw4xx");
    const provider = new AtlasWriteProvider(fakeComments, { workOrders: fakeWorkOrders });
    const result = await provider.createWorkOrder(makeRequest("evt-4xx"));
    expect(result.kind).not.toBe("outcome_unknown");
  });

  it("Hub-shaped priority (lowercase) reaches Atlas already converted to its uppercase enum", async () => {
    const fakeComments = {
      countComments: async () => ({ count: 0 }),
      createComment: async () => {
        throw new Error("not used");
      },
      searchComments: async () => [],
    };
    const fakeWorkOrders = new FakeAtlasWorkOrderApi();
    const provider = new AtlasWriteProvider(fakeComments, { workOrders: fakeWorkOrders });
    await provider.createWorkOrder(makeRequest("evt-priority", { priority: "medium" }));
    expect(fakeWorkOrders.lastPriority).toBe("MEDIUM");
  });

  it("without a workOrders API, createWorkOrder reports unsupported — never throws", async () => {
    const fakeComments = {
      countComments: async () => ({ count: 0 }),
      createComment: async () => {
        throw new Error("not used");
      },
      searchComments: async () => [],
    };
    const provider = new AtlasWriteProvider(fakeComments);
    const result = await provider.createWorkOrder(makeRequest("evt-unwired"));
    expect(result.kind).toBe("unsupported");
    const readBack = await provider.readBackWorkOrder(markerFor("evt-unwired"));
    expect(readBack.kind).toBe("unsupported");
  });
});

describe("createWorkOrder — composition and pre-create lookup (Codex #5207 F1/F2)", () => {
  function combinedClient(searchError?: Error) {
    const wo = new FakeAtlasWorkOrderApi();
    return {
      wo,
      client: {
        countComments: async () => ({ count: 0 }),
        createComment: async () => {
          throw new Error("not used");
        },
        searchComments: async () => [],
        createWorkOrder: (p: { title: string; description: string; priority: string }) => wo.createWorkOrder(p),
        searchWorkOrders: async (p: { pageSize?: number; pageNum?: number }) => {
          if (searchError) throw searchError;
          return wo.searchWorkOrders(p);
        },
      },
    };
  }

  it("a provider built from one client has the create path wired", async () => {
    const { client, wo } = combinedClient();
    const provider = atlasWriteProviderFromClient(client);
    const result = await provider.createWorkOrder(makeRequest("evt-compose"));
    expect(result.kind).not.toBe("unsupported");
    expect(wo.count()).toBe(1);
  });

  it("a pre-create lookup network error is retryable, never outcome_unknown, and creates nothing", async () => {
    const { client, wo } = combinedClient(new Error("ECONNRESET"));
    const result = await atlasWriteProviderFromClient(client).createWorkOrder(makeRequest("evt-lookup-net"));
    expect(result.kind).toBe("retryable_failure");
    expect(wo.count()).toBe(0);
  });

  it("a pre-create lookup 403 is permission_denied, not outcome_unknown", async () => {
    const { AtlasHttpError } = await import("@/lib/atlas/client");
    const { client, wo } = combinedClient(new AtlasHttpError(403, "forbidden", "/work-orders/search"));
    const result = await atlasWriteProviderFromClient(client).createWorkOrder(makeRequest("evt-lookup-403"));
    expect(result.kind).toBe("permission_denied");
    expect(wo.count()).toBe(0);
  });
});
