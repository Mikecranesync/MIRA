/**
 * Chat-request fields allowed to differ between reference and clone (PRD
 * "Allowlist policy"). Each entry carries its reason AND a check the value must
 * still pass on every surface — an allowlisted field is constrained, never
 * ignored. Anything not listed here must be byte-equal after JSON parsing.
 */
import type { Surface } from "./surfaces";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const REQUEST_ALLOWLIST: Record<string, { reason: string; valid: (v: unknown, present: boolean, surface: Surface) => boolean }> = {
  clientRequestId: {
    reason: "Idempotency key minted per send (crypto.randomUUID) on each surface; must be a v4 UUID, and distinct across sends (checked across all runs in the spec).",
    valid: (v, present) => present && typeof v === "string" && UUID.test(v),
  },
  threadId: {
    reason: "Only the clone is thread-aware: the classic page never sends it, and on the legacy (thread-less) notebook the clone must send it as null.",
    valid: (v, present, surface) => (surface === "reference" ? !present : present && v === null),
  },
  clientCapabilities: {
    reason: "F004 (#4303): only the clone renders the grounding_status entry, so only it declares grounding_status_v1 (ignored by the server while the flag is off). The frozen classic page sends nothing. Exactly that one value is allowed: any other capability, an extra entry, or the reference starting to send it fails.",
    valid: (v, present, surface) =>
      surface === "reference"
        ? !present
        : present && Array.isArray(v) && v.length === 1 && v[0] === "grounding_status_v1",
  },
};
