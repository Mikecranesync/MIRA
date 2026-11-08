/**
 * Contract-twin sync test (#5020 TASK-OUTBOX-CREATE-WO, case 7). The
 * language-neutral JSON twin (`contracts/cmms-write-contract.v1.json`) must
 * list the same operations, write-result kinds, read-back-result kinds,
 * delivery states and retryable states as the TypeScript source of truth
 * (`write-contract.ts`). A session that adds an operation to one and forgets
 * the other drifts silently — this test makes that drift a red test instead.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CMMS_OPERATIONS,
  DELIVERY_STATES,
  RETRYABLE_STATES,
} from "../write-contract";

const WRITE_RESULT_KINDS = [
  "success",
  "accepted_pending_verification",
  "verified_by_readback",
  "unsupported",
  "permission_denied",
  "conflict",
  "retryable_failure",
  "permanent_failure",
  "outcome_unknown",
];

const READ_BACK_RESULT_KINDS = ["found", "not_found", "unsupported", "error"];

const TWIN_PATH = path.resolve(__dirname, "../../../../../contracts/cmms-write-contract.v1.json");

type Twin = {
  operations: string[];
  writeResultKinds: string[];
  readBackResultKinds: string[];
  deliveryStates: string[];
  retryableStates: string[];
};

function loadTwin(): Twin {
  return JSON.parse(readFileSync(TWIN_PATH, "utf8")) as Twin;
}

describe("cmms-write-contract.v1.json twin sync", () => {
  it("operations: JSON twin lists exactly CMMS_OPERATIONS", () => {
    const twin = loadTwin();
    expect(new Set(twin.operations)).toEqual(new Set(CMMS_OPERATIONS));
    expect(twin.operations).toHaveLength(CMMS_OPERATIONS.length);
  });

  it("writeResultKinds: JSON twin lists exactly the CmmsWriteResult['kind'] union", () => {
    const twin = loadTwin();
    expect(new Set(twin.writeResultKinds)).toEqual(new Set(WRITE_RESULT_KINDS));
  });

  it("readBackResultKinds: JSON twin lists exactly the CmmsReadBackResult['kind'] union", () => {
    const twin = loadTwin();
    expect(new Set(twin.readBackResultKinds)).toEqual(new Set(READ_BACK_RESULT_KINDS));
  });

  it("deliveryStates: JSON twin lists exactly DELIVERY_STATES", () => {
    const twin = loadTwin();
    expect(new Set(twin.deliveryStates)).toEqual(new Set(DELIVERY_STATES));
    expect(twin.deliveryStates).toHaveLength(DELIVERY_STATES.length);
  });

  it("retryableStates: JSON twin lists exactly RETRYABLE_STATES", () => {
    const twin = loadTwin();
    expect(new Set(twin.retryableStates)).toEqual(new Set(RETRYABLE_STATES));
    expect(twin.retryableStates).toHaveLength(RETRYABLE_STATES.length);
  });

  it("$defs.WorkOrderRequest exists and requires the same fields as the TS type", () => {
    const twin = loadTwin() as unknown as { $defs: Record<string, { required?: string[] }> };
    const req = twin.$defs.WorkOrderRequest;
    expect(req).toBeDefined();
    expect(new Set(req.required)).toEqual(
      new Set([
        "idempotencyKey",
        "marker",
        "title",
        "description",
        "priority",
        "externalAssetId",
        "attributionLabel",
        "occurredAt",
        "sourceRef",
      ]),
    );
  });
});
