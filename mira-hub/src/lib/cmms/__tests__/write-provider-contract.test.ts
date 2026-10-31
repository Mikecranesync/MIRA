import { describe, expect, it } from "vitest";

import { AtlasAuthError, AtlasHttpError, type AtlasComment } from "@/lib/atlas/client";

import { type AtlasCommentApi, AtlasWriteProvider } from "../atlas-write-provider";
import { MockCmmsWriteProvider } from "../mock-write-provider";
import { type CmmsWriteProvider, type WorkLogNote, type WorkOrderTarget, markerFor } from "../write-contract";

function makeNote(eventId: string, suffix = ""): WorkLogNote {
  return {
    idempotencyKey: `idem-${eventId}`,
    marker: markerFor(eventId),
    text: `Replaced the belt tensioner.${suffix}`,
    attributionLabel: "Mike via MIRA",
    occurredAt: "2026-10-31T12:00:00.000Z",
    sourceRef: `asset_fix_records:${eventId}`,
  };
}

// ── FakeAtlasCommentApi — in-memory stand-in for AtlasClient's comment methods ──

type FakeMode = "legacy" | "v16";

interface FakeComment {
  id: number;
  content: string;
  system: boolean;
  [k: string]: unknown;
}

type InjectedFailure = { kind: "http"; status: number } | { kind: "throwNetwork" } | { kind: "authError" };

type FakeOp = "countComments" | "createComment" | "searchComments";

class FakeAtlasCommentApi implements AtlasCommentApi {
  readonly calls: { op: FakeOp; woId: string }[] = [];

  private readonly mode: FakeMode;
  private readonly comments = new Map<string, FakeComment[]>();
  private readonly pending: Partial<Record<FakeOp, InjectedFailure>> = {};
  private nextId = 1;

  constructor(mode: FakeMode) {
    this.mode = mode;
  }

  /** Inject exactly one failure on the next call to the named op. */
  failNext(op: FakeOp, failure: InjectedFailure): void {
    this.pending[op] = failure;
  }

  /** Test fixture helper: push a comment directly, bypassing create's dedup-by-caller discipline. */
  seedComment(woId: string, content: string): void {
    this.listFor(woId).push({ id: this.nextId++, content, system: false });
  }

  async countComments(workOrderId: string | number): Promise<{ count: number }> {
    const woId = String(workOrderId);
    this.calls.push({ op: "countComments", woId });
    const path = `/comments/count/${woId}`;
    if (this.mode === "legacy") throw new AtlasHttpError(404, "No static resource comments.", path);

    const failure = this.consume("countComments");
    if (failure) this.throwFailure(failure, path);

    return { count: this.listFor(woId).length };
  }

  async createComment(payload: { workOrder: { id: number }; content: string }): Promise<AtlasComment> {
    const woId = String(payload.workOrder.id);
    this.calls.push({ op: "createComment", woId });
    const path = "/comments";
    if (this.mode === "legacy") throw new AtlasHttpError(404, "No static resource comments.", path);

    const failure = this.consume("createComment");
    if (failure?.kind === "throwNetwork") {
      // The request landed server-side before the connection died.
      this.listFor(woId).push({ id: this.nextId++, content: payload.content, system: false });
      throw new TypeError("fetch failed");
    }
    if (failure) this.throwFailure(failure, path);

    const comment: FakeComment = { id: this.nextId++, content: payload.content, system: false };
    this.listFor(woId).push(comment);
    return comment;
  }

  async searchComments(workOrderId: string | number): Promise<AtlasComment[]> {
    const woId = String(workOrderId);
    this.calls.push({ op: "searchComments", woId });
    const path = `/comments/search/${woId}`;
    if (this.mode === "legacy") throw new AtlasHttpError(404, "No static resource comments.", path);

    const failure = this.consume("searchComments");
    if (failure) this.throwFailure(failure, path);

    const real = this.listFor(woId);
    const systemRow: FakeComment = { id: 900_000 + real.length, content: "Status changed to IN_PROGRESS", system: true };
    return [systemRow, ...real];
  }

  private listFor(woId: string): FakeComment[] {
    let list = this.comments.get(woId);
    if (!list) {
      list = [];
      this.comments.set(woId, list);
    }
    return list;
  }

  private consume(op: FakeOp): InjectedFailure | undefined {
    const failure = this.pending[op];
    if (failure) delete this.pending[op];
    return failure;
  }

  private throwFailure(failure: InjectedFailure, path: string): never {
    if (failure.kind === "throwNetwork") throw new TypeError("fetch failed");
    if (failure.kind === "authError") throw new AtlasAuthError("Atlas not configured");
    throw new AtlasHttpError(failure.status, "injected failure", path);
  }
}

// ── Generic conformance suite — run against both providers ──────────────────

interface ConformanceFixture {
  provider: CmmsWriteProvider;
  target: WorkOrderTarget;
  /** Arrange for the NEXT appendWorkLog to land but report outcome_unknown. */
  triggerLostResponse: () => void;
  /** Seed two pre-existing delivered records that already carry `marker`. */
  seedDuplicateMarker: (marker: string) => void;
}

function runWriteProviderContract(label: string, factory: () => ConformanceFixture) {
  describe(`CmmsWriteProvider contract: ${label}`, () => {
    it("is idempotent on note.marker: a second append returns verified_by_readback with exactly one record", async () => {
      const { provider, target } = factory();
      const note = makeNote("11111111-1111-4111-8111-111111111111");

      await provider.appendWorkLog(target, note);
      const second = await provider.appendWorkLog(target, note);

      expect(second.kind).toBe("verified_by_readback");
      if (second.kind === "verified_by_readback") {
        expect(second.externalRef).toBeTruthy();
      }

      const back = await provider.readBackWorkLog(target, note.marker);
      expect(back.kind).toBe("found");
      if (back.kind === "found") {
        expect(back.count).toBe(1);
      }
    });

    it("reconciles a lost response: outcome_unknown, then a retry returns verified_by_readback with exactly one record", async () => {
      const { provider, target, triggerLostResponse } = factory();
      const note = makeNote("22222222-2222-4222-8222-222222222222");

      triggerLostResponse();
      const first = await provider.appendWorkLog(target, note);
      expect(first.kind).toBe("outcome_unknown");

      const second = await provider.appendWorkLog(target, note);
      expect(second.kind).toBe("verified_by_readback");

      const back = await provider.readBackWorkLog(target, note.marker);
      expect(back.kind).toBe("found");
      if (back.kind === "found") {
        expect(back.count).toBe(1);
      }
    });

    it("reports conflict when two pre-existing records already carry the marker", async () => {
      const { provider, target, seedDuplicateMarker } = factory();
      const note = makeNote("33333333-3333-4333-8333-333333333333");

      seedDuplicateMarker(note.marker);
      const result = await provider.appendWorkLog(target, note);

      expect(result.kind).toBe("conflict");
    });

    it("readBackWorkLog: not_found before any write, found after", async () => {
      const { provider, target } = factory();
      const note = makeNote("44444444-4444-4444-8444-444444444444");

      const before = await provider.readBackWorkLog(target, note.marker);
      expect(before.kind).toBe("not_found");

      await provider.appendWorkLog(target, note);

      const after = await provider.readBackWorkLog(target, note.marker);
      expect(after.kind).toBe("found");
    });
  });
}

function mockFactory(): ConformanceFixture {
  const provider = new MockCmmsWriteProvider();
  const target: WorkOrderTarget = { providerId: "mock", externalWorkOrderId: "wo-mock-1" };

  return {
    provider,
    target,
    triggerLostResponse: () => provider.failNext("lost_response"),
    seedDuplicateMarker: (marker: string) => {
      const list = provider.records(target.externalWorkOrderId);
      list.push({ id: "seed-1", content: `${marker} seed one`, createdAt: "2026-01-01T00:00:00.000Z" });
      list.push({ id: "seed-2", content: `${marker} seed two`, createdAt: "2026-01-01T00:00:00.000Z" });
    },
  };
}

function atlasFactory(): ConformanceFixture & { api: FakeAtlasCommentApi } {
  const api = new FakeAtlasCommentApi("v16");
  const provider = new AtlasWriteProvider(api);
  const target: WorkOrderTarget = { providerId: "atlas", externalWorkOrderId: "501" };

  return {
    provider,
    target,
    api,
    triggerLostResponse: () => api.failNext("createComment", { kind: "throwNetwork" }),
    seedDuplicateMarker: (marker: string) => {
      api.seedComment(target.externalWorkOrderId, `${marker} seed one`);
      api.seedComment(target.externalWorkOrderId, `${marker} seed two`);
    },
  };
}

runWriteProviderContract("MockCmmsWriteProvider", mockFactory);
runWriteProviderContract("AtlasWriteProvider (v16 fake comments API)", atlasFactory);

// ── Atlas-specific cases (HTTP status mapping, legacy mode, capability caching) ──

describe("AtlasWriteProvider — Atlas-specific behavior", () => {
  const target: WorkOrderTarget = { providerId: "atlas", externalWorkOrderId: "502" };

  it("legacy Atlas (no CommentController): unsupported with reason atlas_version_without_comments, no write attempted", async () => {
    const api = new FakeAtlasCommentApi("legacy");
    const provider = new AtlasWriteProvider(api);
    const note = makeNote("55555555-5555-4555-8555-555555555555");

    const result = await provider.appendWorkLog(target, note);

    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("atlas_version_without_comments");
    }
    expect(api.calls.some((c) => c.op === "createComment")).toBe(false);
  });

  it("403 on the capability probe maps to permission_denied", async () => {
    const api = new FakeAtlasCommentApi("v16");
    api.failNext("countComments", { kind: "http", status: 403 });
    const provider = new AtlasWriteProvider(api);
    const note = makeNote("66666666-6666-4666-8666-666666666666");

    const result = await provider.appendWorkLog(target, note);

    expect(result.kind).toBe("permission_denied");
  });

  it("500 on create maps to retryable_failure", async () => {
    const api = new FakeAtlasCommentApi("v16");
    const provider = new AtlasWriteProvider(api);
    const note = makeNote("77777777-7777-4777-8777-777777777777");
    api.failNext("createComment", { kind: "http", status: 500 });

    const result = await provider.appendWorkLog(target, note);

    expect(result.kind).toBe("retryable_failure");
  });

  it("404 on create maps to permanent_failure (work_order_not_found)", async () => {
    const api = new FakeAtlasCommentApi("v16");
    const provider = new AtlasWriteProvider(api);
    const note = makeNote("88888888-8888-4888-8888-888888888888");
    api.failNext("createComment", { kind: "http", status: 404 });

    const result = await provider.appendWorkLog(target, note);

    expect(result.kind).toBe("permanent_failure");
    if (result.kind === "permanent_failure") {
      expect(result.reason).toBe("work_order_not_found");
    }
  });

  it("capabilities are probed exactly once per target per provider instance", async () => {
    const api = new FakeAtlasCommentApi("v16");
    const provider = new AtlasWriteProvider(api);
    const note = makeNote("99999999-9999-4999-8999-999999999999");

    await provider.capabilities(target);
    await provider.capabilities(target);
    await provider.appendWorkLog(target, note);

    const probeCalls = api.calls.filter((c) => c.op === "countComments" && c.woId === target.externalWorkOrderId);
    expect(probeCalls.length).toBe(1);
  });
});
