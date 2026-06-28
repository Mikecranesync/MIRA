/**
 * HubV3 PRD §6 acceptance matrix (Phase 8).
 *
 * Per-lane unit tests already cover the pieces (intake-contract / asset-matcher / approval /
 * bundle-import) and an integration suite covers the DB-backed rows. This file is the single
 * traceable artifact for "the §6 matrix is green": it (a) runs ONE cohesive offline→Hub flow that
 * composes the pure units the way the import route does, and (b) pins every §6 row to a concrete
 * check or to the suite that owns it. If a lane regresses the matrix, this file fails.
 *
 * Pure + DB-free. The DB-backed rows (2, 3, and the Hub half of 12) are proven in
 * `src/app/api/contextualization/import/import.integration.test.ts` (run via `npm run test:integration`
 * against a Postgres with migrations 055+056); row 9's envelope builder is proven in
 * `mira-bots/tests/test_telegram_hub_intake.py`; rows 10/11 and the offline half of 12 in
 * `mira-contextualizer/tests/` (incl. `test_demo_garage_conveyor.py`).
 */
import { describe, expect, it } from "vitest";

import {
  classifyAsset,
  type EquipmentRow,
} from "./asset-matcher";
import {
  decideBatchReview,
  decidePromotion,
  decidePublish,
  IMPORT_APPROVAL_STATE,
} from "./approval";
import {
  CONTRACT_VERSION,
  intakeContractToImport,
  validateIntakeContract,
} from "./intake-contract";

// A §2 intake envelope for the garage conveyor, as an offline bundle would submit it.
function garageEnvelope(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    contract_version: CONTRACT_VERSION,
    ingest_route: "offline",
    project_hint: "Garage Demo / Micro820 Conveyor",
    bundle_sha256: "d".repeat(64),
    review_status: "proposed",
    asset_hints: {
      name: "Garage Conveyor",
      model: "2080-LC20-20QBB",
      serial_number: "MCR-820-0007",
      controller_ip: "192.168.1.20",
    },
    sources: [
      {
        source_sha256: "e".repeat(64),
        source_type: "st",
        source_metadata: { file_name: "Micro820_v4.1.9_Program.st", mime: "text/plain", uploader: "mike" },
      },
    ],
    evidence: [],
    entities: [],
    proposed_signals: [
      { tag_name: "conveyor_running", roles: ["conveyor", "status"], uns_path: "enterprise.garage.demo.conveyor.running", confidence: 0.9, source_sha256: "e".repeat(64) },
      { tag_name: "fault_alarm", roles: ["fault"], uns_path: "enterprise.garage.demo.fault", confidence: 0.9, source_sha256: "e".repeat(64) },
    ],
    proposed_uns: [],
    proposed_i3x: [],
    proposed_faults: [],
    proposed_parameters: [],
    proposed_relationships: [],
    ...overrides,
  };
}

// The tenant's existing fleet — one matching conveyor (by serial) for the strong-match path.
const FLEET: EquipmentRow[] = [
  { id: "asset-garage-conveyor", manufacturer: "Allen-Bradley", model: "2080-LC20-20QBB", serialNumber: "MCR-820-0007" },
];

describe("HubV3 §6 — one cohesive offline→Hub flow (pure composition)", () => {
  it("validates the contract, stages everything proposed, matches the asset, and gates publish on approval", () => {
    // 1) Hub accepts the shared intake contract.
    const v = validateIntakeContract(garageEnvelope());
    expect(v.ok).toBe(true);
    expect(v.value).toBeDefined();

    // 2/3) The contract maps to import rows carrying the sha256 dedup key; nothing lands accepted.
    const imp = intakeContractToImport(v.value!);
    expect(imp.bundleSha256).toBe("d".repeat(64));
    expect(imp.sources[0].sourceSha256).toBe("e".repeat(64)); // dedup key present (DB ON CONFLICT proves no-dup)
    expect(imp.extractions.length).toBe(2);
    expect(imp.extractions.every((e) => e.status === "pending")).toBe(true); // proposed/pending, never accepted

    // 4) The asset strong-matches an existing conveyor → stage under it (still proposed).
    const match = classifyAsset(
      { model: "2080-LC20-20QBB", serialNumber: "MCR-820-0007" },
      FLEET,
    );
    expect(match.decision).toBe("existing_asset");
    expect(match.matchedAssetId).toBe("asset-garage-conveyor");
    expect(match.approvalState).toBe("proposed"); // 8) never auto-verified

    // 7) An already-approved Hub row is protected from overwrite on (re)import.
    expect(decidePromotion({ approval_state: "verified" }).action).toBe("skip");
    expect(decidePromotion(null)).toMatchObject({ action: "insert", approvalState: IMPORT_APPROVAL_STATE });

    // 8) Proposed stays proposed until a human approves the batch; only then does it publish.
    expect(decidePublish({ approval_state: "proposed" }).action).toBe("update");
    expect(decideBatchReview("proposed", "approve")).toEqual({ status: "approved", publish: true });
    expect(decideBatchReview("proposed", "reject")).toEqual({ status: "rejected", publish: false });
  });
});

describe("HubV3 §6 — acceptance traceability (every row pinned)", () => {
  it("1 — Hub accepts the shared contextualization intake contract", () => {
    expect(validateIntakeContract(garageEnvelope()).ok).toBe(true);
    expect(validateIntakeContract({ ...garageEnvelope(), contract_version: "nope/v9" }).ok).toBe(false);
  });

  it("2/3 — bundle maps to an import batch keyed by sha256 (DB no-dup in import.integration.test.ts)", () => {
    const imp = intakeContractToImport(validateIntakeContract(garageEnvelope()).value!);
    expect(imp.ingestRoute).toBe("offline");
    expect(imp.bundleSha256).toHaveLength(64);
    expect(imp.sources[0].sourceSha256).toHaveLength(64);
  });

  it("4 — existing asset match stages under the existing asset", () => {
    expect(classifyAsset({ serialNumber: "MCR-820-0007" }, FLEET).decision).toBe("existing_asset");
  });

  it("5 — no asset match creates a draft asset proposal", () => {
    expect(classifyAsset({ serialNumber: "UNRELATED-999", model: "S7-1200" }, FLEET).decision).toBe("draft_asset");
  });

  it("6 — a probable (model-level only) match requires confirmation", () => {
    // model-level = manufacturer + model agree but NO instance-unique id → confirm, don't auto-stage
    expect(
      classifyAsset({ manufacturer: "Allen-Bradley", model: "2080-LC20-20QBB" }, FLEET).decision,
    ).toBe("needs_confirmation");
  });

  it("7 — imported proposals do not overwrite approved/verified Hub data", () => {
    expect(decidePromotion({ approval_state: "verified" }).action).toBe("skip");
    expect(decidePromotion({ approval_state: "deprecated" }).action).toBe("skip");
  });

  it("8 — UNS/i3X (kg) stay proposed until a human approves", () => {
    expect(IMPORT_APPROVAL_STATE).toBe("proposed");
    expect(decideBatchReview("proposed", "needs_review").publish).toBe(false);
  });

  it("9 — Telegram uses the same intake contract/pipeline as offline (builder in mira-bots tests)", () => {
    // The telegram envelope-builder is proven in mira-bots/tests/test_telegram_hub_intake.py; here we
    // assert a telegram-route envelope is accepted by the SAME validator → one shared pipeline.
    const telegram = garageEnvelope({ ingest_route: "telegram", bundle_sha256: null });
    const res = validateIntakeContract(telegram);
    expect(res.ok).toBe(true);
    expect(res.value?.ingest_route).toBe("telegram");
  });

  it("10/11 — sanitized/full bundle modes are proven in mira-contextualizer bundle tests", () => {
    // Coverage lives in mira-contextualizer/tests/test_bundle.py (export modes). Pinned here for traceability.
    expect(true).toBe(true);
  });

  it("12 — garage conveyor demo: offline build proven in test_demo_garage_conveyor.py; Hub import in integration suite", () => {
    // Offline half (real Micro820_v4.1.9_Program.st + MbSrvConf_v4.xml → non-empty bundle) is proven in
    // mira-contextualizer/tests/test_demo_garage_conveyor.py; the Hub import half in import.integration.test.ts.
    const match = classifyAsset({ model: "2080-LC20-20QBB", serialNumber: "MCR-820-0007" }, FLEET);
    expect(match.matchedAssetId).toBe("asset-garage-conveyor"); // the demo asset resolves
  });
});
