/**
 * i3X typed projection layer (read-only).
 *
 * Pure functions that project MIRA's approved UNS/KG/live-signal context onto
 * the i3X (CESMII) wire shapes. No I/O, no routes, no writes — route handlers
 * (a later phase) call these after loading rows and applying the approval gate.
 *
 * This is the concrete realization of the `toI3xEnvelope` intent sketched in
 * docs/specs/public-ingest-api-spec.md §10. The named functions below ARE the
 * projection API (one mapping for the whole repo — do not fork). Design:
 *   docs/research/i3x-strategy-for-factorylm-mira.md
 *   docs/architecture/i3x-aligned-ingestion-and-context-model.md
 *
 * Exposure rule: callers MUST gate inputs through ./approval (verified entities +
 * approved-tag values) before projecting. The projection emits whatever it's
 * given; the gate decides what it's given.
 *
 * Note: auth.ts and response.ts are intentionally NOT re-exported here.
 * Route handlers import them directly via `@/lib/i3x/auth` and
 * `@/lib/i3x/response` because they are route-layer concerns (DB access,
 * HTTP response shaping), not part of this pure projection surface.
 */

export * from "@/lib/i3x/types";
export { serverInfo, I3X_SPEC_VERSION } from "@/lib/i3x/server-info";
export { qualityToI3x } from "@/lib/i3x/quality";
export {
  toVQT,
  toCurrentValueResult,
  toHistoricalValueResult,
  type MiraReading,
  type MiraValueType,
} from "@/lib/i3x/value";
export {
  EXPOSABLE_APPROVAL_STATE,
  isExposable,
  filterExposable,
  filterApprovedTags,
  type HasApprovalState,
} from "@/lib/i3x/approval";
export {
  MIRA_TYPE_NAMESPACE_URI,
  objectTypeElementId,
  kgEntityToObjectInstance,
  type KgEntity,
} from "@/lib/i3x/objects";
export {
  reverseOf,
  relationshipType,
  listRelationshipTypes,
  relatedFromEdge,
  type KgRelationship,
} from "@/lib/i3x/relationships";
