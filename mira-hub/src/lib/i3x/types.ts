/**
 * i3X (CESMII) wire types — the read/query subset MIRA projects onto.
 *
 * These mirror the published OpenAPI 3.1.0 schemas at
 * https://api.i3x.dev/v1/openapi.json (specVersion "release"). Only the
 * shapes the MIRA read-only projection emits are declared here; write
 * (PUT) request shapes are intentionally omitted — MIRA does not write.
 *
 * Design refs:
 *   docs/research/i3x-strategy-for-factorylm-mira.md   (§2 surface, §8.1 elementId)
 *   docs/architecture/i3x-aligned-ingestion-and-context-model.md  (§4.1 quality, §9 API)
 *
 * Type-only module: no runtime behavior (nothing to unit-test here).
 */

/** VQT data-quality indicator. Exactly the four i3X values. */
export type I3xQuality = "Good" | "GoodNoData" | "Bad" | "Uncertain";

/** Value/Quality/Timestamp triple. `timestamp` is an RFC 3339 UTC string. */
export interface VQT {
  value: unknown;
  quality: I3xQuality;
  timestamp: string;
}

/** A namespace the server exposes. Each `uri` MUST be unique. */
export interface Namespace {
  uri: string;
  displayName: string;
}

/** An object type (class). MUST carry a JSON Schema and belong to one namespace. */
export interface ObjectTypeResponse {
  elementId: string;
  displayName: string;
  namespaceUri: string;
  sourceTypeId: string;
  version?: string | null;
  /** JSON Schema definition for instances of this type. */
  schema: Record<string, unknown>;
  related?: Record<string, unknown> | null;
}

export interface ObjectInstanceMetadata {
  typeNamespaceUri?: string | null;
  sourceTypeId?: string | null;
  description?: string | null;
  relationships?: Record<string, unknown> | null;
  schemaExtensions?: Record<string, unknown> | null;
  system?: Record<string, unknown> | null;
}

/** An object instance. `elementId` MUST be unique and SHOULD be persistent. */
export interface ObjectInstanceResponse {
  elementId: string;
  displayName: string;
  typeElementId: string;
  parentId?: string | null;
  isComposition: boolean;
  isExtended: boolean;
  metadata?: ObjectInstanceMetadata | null;
}

/** A relationship type. Every type MUST declare its `reverseOf`. */
export interface RelationshipType {
  elementId: string;
  displayName: string;
  namespaceUri: string;
  relationshipId: string;
  reverseOf: string;
}

/** One related-object hit from /objects/related. */
export interface RelatedObjectResult {
  sourceRelationship: string;
  object: ObjectInstanceResponse;
}

export interface CurrentValueResult {
  isComposition: boolean;
  value: unknown;
  quality: I3xQuality;
  timestamp: string;
  components?: Record<string, VQT> | null;
}

export interface HistoricalValueResult {
  isComposition: boolean;
  values: VQT[];
}

/** Capability flags reported by /info. MIRA is read-only: all `update.*` false. */
export interface ServerCapabilities {
  query: { history: boolean };
  update: { current: boolean; history: boolean };
  subscribe: { stream: boolean };
}

export interface ServerInfo {
  specVersion: string;
  serverVersion?: string | null;
  serverName?: string | null;
  capabilities: ServerCapabilities;
}
