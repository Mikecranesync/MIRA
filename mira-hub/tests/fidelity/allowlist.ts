/**
 * Chat-request fields allowed to differ between reference and clone (PRD
 * "Allowlist policy"). Each entry carries its reason AND a check the value must
 * still pass on every surface — an allowlisted field is constrained, never
 * ignored. Anything not listed here must be byte-equal after JSON parsing.
 */
import type { Surface } from "./surfaces";
import oracle from "./fixtures/oracle.json";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const nb = oracle.detailEmpty.notebook;
const NOTEBOOK_IDENTITY = { version: 1, manufacturer: nb.manufacturer, model: nb.model, catalogNumber: nb.catalogNumber,
  serialNumber: nb.serialNumber, equipmentType: nb.equipmentType, identityStatus: nb.identityStatus };

export const REQUEST_ALLOWLIST: Record<string, { reason: string; valid: (v: unknown, present: boolean, surface: Surface) => boolean }> = {
  clientRequestId: {
    reason: "Idempotency key minted per send (crypto.randomUUID) on each surface; must be a v4 UUID, and distinct across sends (checked across all runs in the spec).",
    valid: (v, present) => present && typeof v === "string" && UUID.test(v),
  },
  threadId: {
    reason: "Only the clone is thread-aware: the classic page never sends it, and on the legacy (thread-less) notebook the clone must send it as null.",
    valid: (v, present, surface) => (surface === "reference" ? !present : present && v === null),
  },
  expectedEquipmentEntityId: {
    reason: "The clone carries the machine-binding precondition for safe recovery. This fixture is unbound, so it must explicitly send null; the reference predates that additive field.",
    valid: (v, present, surface) => (surface === "reference" ? !present : present && v === null),
  },
  expectedNotebookIdentity: {
    reason: "The clone also preserves the confirmed nameplate identity when there is no asset binding. Require exactly this oracle notebook's identity; never ignore a model/catalog mismatch.",
    valid: (v, present, surface) => surface === "reference" ? !present : present && !!v && typeof v === "object" && !Array.isArray(v)
      && Object.keys(v).length === Object.keys(NOTEBOOK_IDENTITY).length
      && Object.entries(NOTEBOOK_IDENTITY).every(([key, expected]) => (v as Record<string, unknown>)[key] === expected),
  },
};
