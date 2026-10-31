// In-memory CmmsWriteProvider for tests and local development (#5020).
//
// Mirrors the honesty contract of AtlasWriteProvider without any network
// dependency: appendWorkLog is idempotent on `note.marker`, failures are
// injectable one-shot via `failNext`, and `records`/`calls` give tests a
// window into what actually happened.

import {
  type CmmsCapability,
  type CmmsCapabilityMatrix,
  type CmmsReadBackResult,
  type CmmsWriteProvider,
  type CmmsWriteResult,
  type WorkLogNote,
  type WorkOrderTarget,
  countMarker,
  renderWorkLogText,
} from "./write-contract";

export type MockFailureKind =
  | "throw"
  | "lost_response"
  | "retryable_failure"
  | "permission_denied"
  | "permanent_failure";

export interface MockRecord {
  id: string;
  content: string;
  createdAt: string;
}

export interface MockCmmsWriteProviderOptions {
  /** Default true. When false, append/read-work-log report `unsupported`. */
  supportsWorkLog?: boolean;
  /** The provider slug this mock stands in for (default "mock"). The
   *  dispatcher refuses an adapter whose id differs from the delivery's
   *  `connection_key`, so a test wiring a mock to an "atlas" connection
   *  must say so explicitly. */
  providerId?: string;
}

export interface MockCall {
  op: "appendWorkLog" | "readBackWorkLog";
  woId: string;
  marker: string;
}

export class MockCmmsWriteProvider implements CmmsWriteProvider {
  readonly providerId: string;

  private readonly supportsWorkLog: boolean;
  private readonly recordsByWorkOrder = new Map<string, MockRecord[]>();
  private readonly callLog: MockCall[] = [];
  private nextFailure: MockFailureKind | null = null;
  private nextId = 1;

  constructor(options: MockCmmsWriteProviderOptions = {}) {
    this.supportsWorkLog = options.supportsWorkLog ?? true;
    this.providerId = options.providerId ?? "mock";
  }

  /** Inject exactly one failure on the next `appendWorkLog` call. */
  failNext(kind: MockFailureKind): void {
    this.nextFailure = kind;
  }

  /** Live reference to a work order's stored records — tests may seed fixtures by pushing onto it. */
  records(woId: string): MockRecord[] {
    let list = this.recordsByWorkOrder.get(woId);
    if (!list) {
      list = [];
      this.recordsByWorkOrder.set(woId, list);
    }
    return list;
  }

  get calls(): readonly MockCall[] {
    return this.callLog;
  }

  async capabilities(target: WorkOrderTarget): Promise<CmmsCapabilityMatrix> {
    void target; // the mock's support does not depend on the target
    const workLog: CmmsCapability = this.supportsWorkLog
      ? { support: "implemented" }
      : { support: "unsupported", reason: "mock_disabled" };

    return {
      append_work_log: workLog,
      read_work_log: workLog,
      attach_evidence: { support: "unsupported", reason: "not_implemented" },
      record_reading: { support: "unsupported", reason: "not_implemented" },
      transition_work_order: { support: "unsupported", reason: "not_implemented" },
      list_changes: { support: "unsupported", reason: "not_implemented" },
    };
  }

  async appendWorkLog(target: WorkOrderTarget, note: WorkLogNote): Promise<CmmsWriteResult> {
    const woId = target.externalWorkOrderId;
    this.callLog.push({ op: "appendWorkLog", woId, marker: note.marker });

    if (!this.supportsWorkLog) {
      return { kind: "unsupported", reason: "mock_disabled", receipt: {} };
    }

    const matches = this.findByMarker(woId, note.marker);
    if (matches.length > 1) {
      return { kind: "conflict", reason: "duplicate_marker", receipt: { ids: matches.map((m) => m.id) } };
    }
    if (matches.length === 1) {
      return { kind: "verified_by_readback", externalRef: matches[0].id, receipt: { id: matches[0].id } };
    }

    const failure = this.nextFailure;
    this.nextFailure = null;

    if (failure === "throw") {
      throw new Error("mock_injected_throw");
    }
    if (failure === "retryable_failure") {
      return { kind: "retryable_failure", reason: "mock_injected_retryable_failure", receipt: {} };
    }
    if (failure === "permission_denied") {
      return { kind: "permission_denied", reason: "mock_injected_permission_denied", receipt: {} };
    }
    if (failure === "permanent_failure") {
      return { kind: "permanent_failure", reason: "mock_injected_permanent_failure", receipt: {} };
    }

    const record = this.store(woId, note);

    if (failure === "lost_response") {
      // The record is stored (the "send" landed) but this call reports the
      // outcome as unknown — the next appendWorkLog with the same marker
      // must find it by read-back rather than writing a second record.
      return { kind: "outcome_unknown", reason: "mock_injected_lost_response", receipt: {} };
    }

    return { kind: "verified_by_readback", externalRef: record.id, receipt: { id: record.id } };
  }

  async readBackWorkLog(target: WorkOrderTarget, marker: string): Promise<CmmsReadBackResult> {
    const woId = target.externalWorkOrderId;
    this.callLog.push({ op: "readBackWorkLog", woId, marker });

    if (!this.supportsWorkLog) {
      return { kind: "unsupported", reason: "mock_disabled", receipt: {} };
    }

    const matches = this.findByMarker(woId, marker);
    if (matches.length === 0) {
      return { kind: "not_found", receipt: {} };
    }

    return {
      kind: "found",
      externalRef: matches[0].id,
      count: matches.length,
      receipt: { ids: matches.map((m) => m.id) },
    };
  }

  private findByMarker(woId: string, marker: string): MockRecord[] {
    return this.records(woId).filter((r) => countMarker(r.content, marker) > 0);
  }

  private store(woId: string, note: WorkLogNote): MockRecord {
    const record: MockRecord = {
      id: `mock-${this.nextId++}`,
      content: renderWorkLogText(note),
      createdAt: note.occurredAt,
    };
    this.records(woId).push(record);
    return record;
  }
}
