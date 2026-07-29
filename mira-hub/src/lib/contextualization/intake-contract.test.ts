import { describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  validateIntakeContract,
  intakeContractToImport,
  type IntakeContract,
} from "./intake-contract";

// A minimal-but-valid envelope per HubV3 PRD §2. Names/serials/paths are
// matching evidence, never identity; review_status is always "proposed" on intake.
function validEnvelope(): Record<string, unknown> {
  return {
    contract_version: CONTRACT_VERSION,
    ingest_route: "offline",
    project_hint: "Garage Demo / Micro820 Conveyor",
    bundle_sha256: "a".repeat(64),
    review_status: "proposed",
    asset_hints: { name: "Conveyor 1", model: "Micro820", controller_ip: "192.168.1.20" },
    sources: [
      {
        source_sha256: "b".repeat(64),
        source_type: "st",
        source_metadata: { file_name: "Micro820.st", mime: "text/plain", uploader: "mike" },
      },
    ],
    evidence: [],
    entities: [],
    proposed_signals: [
      { tag_name: "Conv_Run", roles: ["output"], uns_path: "enterprise.garage.demo.conv.run", confidence: 0.9, source_sha256: "b".repeat(64) },
    ],
    proposed_uns: [],
    proposed_i3x: [],
    proposed_faults: [],
    proposed_parameters: [],
    proposed_relationships: [],
  };
}

describe("validateIntakeContract", () => {
  it("accepts a well-formed intake envelope", () => {
    const res = validateIntakeContract(validEnvelope());
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.value?.ingest_route).toBe("offline");
  });

  it("rejects a wrong contract_version", () => {
    const env = { ...validEnvelope(), contract_version: "nope/v9" };
    const res = validateIntakeContract(env);
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/contract_version/);
  });

  it("rejects an unknown ingest_route", () => {
    const env = { ...validEnvelope(), ingest_route: "carrier-pigeon" };
    const res = validateIntakeContract(env);
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/ingest_route/);
  });

  it("rejects an empty sources array", () => {
    const env = { ...validEnvelope(), sources: [] };
    const res = validateIntakeContract(env);
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/sources/);
  });

  it("rejects a source missing its sha256", () => {
    const env = validEnvelope();
    (env.sources as Record<string, unknown>[])[0].source_sha256 = undefined;
    const res = validateIntakeContract(env);
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/source_sha256/);
  });

  it("rejects review_status other than proposed on intake", () => {
    const env = { ...validEnvelope(), review_status: "approved" };
    const res = validateIntakeContract(env);
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/review_status/);
  });

  it("defaults review_status to proposed when omitted", () => {
    const env = validEnvelope();
    delete (env as Record<string, unknown>).review_status;
    const res = validateIntakeContract(env);
    expect(res.ok).toBe(true);
    expect(res.value?.review_status).toBe("proposed");
  });
});

describe("intakeContractToImport", () => {
  it("maps the envelope to insertable project/source/extraction rows", () => {
    const contract = validateIntakeContract(validEnvelope()).value as IntakeContract;
    const imp = intakeContractToImport(contract);
    expect(imp.bundleSha256).toBe("a".repeat(64));
    expect(imp.ingestRoute).toBe("offline");
    expect(imp.sources).toHaveLength(1);
    expect(imp.sources[0].sourceSha256).toBe("b".repeat(64));
    expect(imp.sources[0].sourceType).toBe("st");
    // proposed_signals become extractions; nothing lands "accepted" on intake.
    expect(imp.extractions).toHaveLength(1);
    expect(imp.extractions[0].tagName).toBe("Conv_Run");
    expect(imp.extractions[0].status).toBe("pending");
  });
});
