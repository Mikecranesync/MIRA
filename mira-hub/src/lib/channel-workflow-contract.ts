/**
 * Versioned channel-neutral request/result contract.
 *
 * Transport adapters may differ in event IDs, external user IDs, conversation
 * keys, and attachment handles. Everything else is semantic input owned by the
 * Hub workflow. Parsing is deliberately strict: an unknown field cannot become
 * an accidental trust bit (for example, client-supplied `verified: true`).
 */

import { createHash } from "node:crypto";

export type Channel = "telegram" | "slack" | "hub" | "mobile";
export type ChannelAction =
  "message" | "reset" | "confirm_identity" | "recover_delivery";
export type OperationState =
  | "queued"
  | "running"
  | "complete"
  | "candidate_review"
  | "insufficient_evidence"
  | "failed"
  | "cancelled";

export type OperationProgressStep =
  | "prepared"
  | "recognizing_nameplate"
  | "discovering_manual"
  | "ingesting_file"
  | "answering_from_files"
  | "resetting_workspace";

export type AttachmentKind = "image" | "pdf" | "other";

export interface ChannelAttachment {
  attachmentId: string;
  kind: AttachmentKind;
  mimeType: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
}

export interface ChannelWorkflowRequest {
  contractVersion: "1.0";
  tenantId: string;
  actor: {
    userId: string;
    externalUserId: string;
    uploaderId: string;
  };
  channel: Channel;
  eventId: string;
  conversation: {
    id: string;
    sessionId?: string;
    notebookId?: string;
    assetId?: string;
    nodeId?: string;
  };
  action: ChannelAction;
  priorOperationId?: string;
  confirmedIdentity?: EquipmentIdentity;
  text: string;
  caption: string;
  attachments: ChannelAttachment[];
}

export interface EquipmentIdentity {
  manufacturer?: string | null;
  productFamily?: string | null;
  series?: string | null;
  model?: string | null;
  typeCode?: string | null;
  partNumber?: string | null;
  catalogNumber?: string | null;
  serialNumber?: string | null;
  equipmentType?: string | null;
  rating?: string | null;
  input?: string | null;
  confidence?: number | null;
}

export interface ChannelCitation {
  citationId: string;
  docId: string;
  fileId: string | null;
  sourceTitle: string;
  page: number | null;
  quote: string;
}

export interface ChannelWorkflowResult {
  contractVersion: "1.0";
  operationId: string;
  state: OperationState;
  handled: boolean;
  semanticKind:
    | "nameplate_manual"
    | "file_intake"
    | "grounded_answer"
    | "reset"
    | "fallthrough";
  delegatedRoute?: "printsense" | "legacy_diagnostics" | null;
  conversation: {
    sessionId: string;
    notebookId: string;
    generation: number;
    assetId?: string | null;
    nodeId?: string | null;
  };
  identity?: EquipmentIdentity | null;
  files?: Array<{
    fileId: string;
    documentId: string | null;
    filename: string;
    indexed: boolean;
    processingState: string;
  }>;
  manual?: Record<string, unknown> | null;
  answer?: { text: string; citations: ChannelCitation[] } | null;
  provenance: Record<string, unknown>;
  deliveryToken?: string | null;
}

export class ChannelContractError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ChannelContractError";
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const CHANNELS = new Set<Channel>(["telegram", "slack", "hub", "mobile"]);
const ACTIONS = new Set<ChannelAction>([
  "message",
  "reset",
  "confirm_identity",
  "recover_delivery",
]);
const KINDS = new Set<AttachmentKind>(["image", "pdf", "other"]);

const REQUEST_FIELDS = new Set([
  "contractVersion",
  "tenantId",
  "actor",
  "channel",
  "eventId",
  "conversation",
  "action",
  "priorOperationId",
  "confirmedIdentity",
  "text",
  "caption",
  "attachments",
]);
const ACTOR_FIELDS = new Set(["userId", "externalUserId", "uploaderId"]);
const CONVERSATION_FIELDS = new Set([
  "id",
  "sessionId",
  "notebookId",
  "assetId",
  "nodeId",
]);
const ATTACHMENT_FIELDS = new Set([
  "attachmentId",
  "kind",
  "mimeType",
  "filename",
  "sizeBytes",
  "sha256",
]);
const IDENTITY_STRING_FIELDS = [
  "manufacturer",
  "productFamily",
  "series",
  "model",
  "typeCode",
  "partNumber",
  "catalogNumber",
  "serialNumber",
  "equipmentType",
  "rating",
  "input",
] as const;
const IDENTITY_FIELDS = new Set<string>([
  ...IDENTITY_STRING_FIELDS,
  "confidence",
]);

function object(raw: unknown, code: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new ChannelContractError(code);
  return raw as Record<string, unknown>;
}

function rejectUnknown(
  value: Record<string, unknown>,
  allowed: Set<string>,
  code: string,
): void {
  if (Object.keys(value).some((key) => !allowed.has(key)))
    throw new ChannelContractError(code);
}

function requiredString(raw: unknown, code: string, max = 500): string {
  if (typeof raw !== "string" || !raw.trim())
    throw new ChannelContractError(code);
  const normalized = raw.trim();
  if (normalized.length > max) throw new ChannelContractError(code);
  return normalized;
}

function contractText(raw: unknown, code: string): string {
  if (typeof raw !== "string" || raw.length > 4000)
    throw new ChannelContractError(code);
  return raw;
}

function optionalUuid(raw: unknown, code: string): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !UUID_RE.test(raw))
    throw new ChannelContractError(code);
  return raw.toLowerCase();
}

function optionalIdentity(raw: unknown): EquipmentIdentity | undefined {
  if (raw === undefined) return undefined;
  const value = object(raw, "invalid_confirmed_identity");
  rejectUnknown(value, IDENTITY_FIELDS, "unknown_identity_field");
  const identity: EquipmentIdentity = {};
  for (const field of IDENTITY_STRING_FIELDS) {
    const item = value[field];
    if (item === undefined) continue;
    if (item === null) {
      identity[field] = null;
      continue;
    }
    if (typeof item !== "string")
      throw new ChannelContractError("invalid_identity_field");
    const normalized = item.trim();
    if (normalized.length > 500)
      throw new ChannelContractError("invalid_identity_field");
    identity[field] = normalized || null;
  }
  if (value.confidence !== undefined) {
    if (
      value.confidence !== null &&
      (typeof value.confidence !== "number" ||
        !Number.isFinite(value.confidence) ||
        value.confidence < 0 ||
        value.confidence > 1)
    ) {
      throw new ChannelContractError("invalid_identity_confidence");
    }
    identity.confidence = value.confidence as number | null;
  }
  if (Object.keys(identity).length === 0) {
    throw new ChannelContractError("invalid_confirmed_identity");
  }
  return identity;
}

/** Strict runtime parser. It mirrors contracts/channel-workflow.v1.schema.json. */
export function parseChannelWorkflowRequest(
  raw: unknown,
): ChannelWorkflowRequest {
  const value = object(raw, "invalid_request");
  rejectUnknown(value, REQUEST_FIELDS, "unknown_request_field");
  if (value.contractVersion !== "1.0")
    throw new ChannelContractError("unsupported_contract_version");

  const tenantId = requiredString(value.tenantId, "invalid_tenant_id");
  if (!UUID_RE.test(tenantId))
    throw new ChannelContractError("invalid_tenant_id");

  const actor = object(value.actor, "invalid_actor");
  rejectUnknown(actor, ACTOR_FIELDS, "unknown_actor_field");
  const userId = requiredString(actor.userId, "actor_id_required", 200);
  const externalUserId = requiredString(
    actor.externalUserId,
    "external_user_id_required",
    200,
  );
  const uploaderId = requiredString(
    actor.uploaderId,
    "uploader_id_required",
    200,
  );
  if (!UUID_RE.test(userId)) throw new ChannelContractError("invalid_actor_id");
  if (!UUID_RE.test(uploaderId))
    throw new ChannelContractError("invalid_uploader_id");

  if (
    typeof value.channel !== "string" ||
    !CHANNELS.has(value.channel as Channel)
  ) {
    throw new ChannelContractError("invalid_channel");
  }
  if (
    typeof value.action !== "string" ||
    !ACTIONS.has(value.action as ChannelAction)
  ) {
    throw new ChannelContractError("invalid_action");
  }

  const conversation = object(value.conversation, "invalid_conversation");
  rejectUnknown(
    conversation,
    CONVERSATION_FIELDS,
    "unknown_conversation_field",
  );
  const conversationId = requiredString(
    conversation.id,
    "conversation_id_required",
  );

  if (!Array.isArray(value.attachments) || value.attachments.length > 10) {
    throw new ChannelContractError("invalid_attachments");
  }
  const attachments = value.attachments.map(
    (rawAttachment): ChannelAttachment => {
      const attachment = object(rawAttachment, "invalid_attachment");
      rejectUnknown(attachment, ATTACHMENT_FIELDS, "unknown_attachment_field");
      const attachmentId = requiredString(
        attachment.attachmentId,
        "attachment_id_required",
        200,
      );
      if (
        typeof attachment.kind !== "string" ||
        !KINDS.has(attachment.kind as AttachmentKind)
      ) {
        throw new ChannelContractError("invalid_attachment_kind");
      }
      const mimeType = requiredString(
        attachment.mimeType,
        "attachment_mime_required",
        200,
      );
      const filename = requiredString(
        attachment.filename,
        "attachment_filename_required",
        255,
      );
      if (
        typeof attachment.sizeBytes !== "number" ||
        !Number.isSafeInteger(attachment.sizeBytes) ||
        attachment.sizeBytes < 0
      ) {
        throw new ChannelContractError("invalid_attachment_size");
      }
      if (
        typeof attachment.sha256 !== "string" ||
        !SHA256_RE.test(attachment.sha256)
      ) {
        throw new ChannelContractError("invalid_attachment_sha256");
      }
      return {
        attachmentId,
        kind: attachment.kind as AttachmentKind,
        mimeType,
        filename,
        sizeBytes: attachment.sizeBytes,
        sha256: attachment.sha256,
      };
    },
  );
  const attachmentKinds = new Set(
    attachments.map((attachment) => attachment.kind),
  );
  if (attachmentKinds.has("other")) {
    throw new ChannelContractError("unsupported_attachment_kind");
  }
  if (attachmentKinds.size > 1) {
    throw new ChannelContractError("mixed_attachment_kinds_not_supported");
  }
  if (attachmentKinds.has("image") && attachments.length > 1) {
    throw new ChannelContractError("multiple_image_attachments_not_supported");
  }
  if (value.action !== "message" && attachments.length > 0) {
    throw new ChannelContractError("attachments_not_allowed_for_action");
  }

  const text = contractText(value.text, "invalid_text");
  const caption = contractText(value.caption, "invalid_caption");
  const priorOperationId = optionalUuid(
    value.priorOperationId,
    "invalid_prior_operation_id",
  );
  const confirmedIdentity = optionalIdentity(value.confirmedIdentity);
  if (
    (value.action === "confirm_identity" ||
      value.action === "recover_delivery") &&
    !priorOperationId
  ) {
    throw new ChannelContractError("prior_operation_required");
  }
  if (
    priorOperationId &&
    value.action !== "confirm_identity" &&
    value.action !== "recover_delivery"
  ) {
    throw new ChannelContractError("prior_operation_requires_action");
  }
  if (confirmedIdentity && value.action !== "confirm_identity") {
    throw new ChannelContractError("confirmed_identity_requires_confirmation");
  }

  return {
    contractVersion: "1.0",
    tenantId: tenantId.toLowerCase(),
    actor: {
      userId: userId.toLowerCase(),
      externalUserId,
      uploaderId: uploaderId.toLowerCase(),
    },
    channel: value.channel as Channel,
    eventId: requiredString(value.eventId, "event_id_required", 300),
    conversation: {
      id: conversationId,
      sessionId: optionalUuid(conversation.sessionId, "invalid_session_id"),
      notebookId: optionalUuid(conversation.notebookId, "invalid_notebook_id"),
      assetId: optionalUuid(conversation.assetId, "invalid_asset_id"),
      nodeId: optionalUuid(conversation.nodeId, "invalid_node_id"),
    },
    action: value.action as ChannelAction,
    priorOperationId,
    confirmedIdentity,
    text,
    caption,
    attachments,
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(input)
        .filter((key) => input[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalize(input[key])]),
    );
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** Full request identity for exactly-once conflict detection. */
export function semanticFingerprint(request: ChannelWorkflowRequest): string {
  return createHash("sha256").update(stableJson(request), "utf8").digest("hex");
}

/**
 * Cross-client semantic comparison. Removes only transport identity; tenant,
 * canonical actor/uploader, context, user content, and byte identity remain.
 */
export function semanticProjection(
  request: ChannelWorkflowRequest,
): Record<string, unknown> {
  return {
    contractVersion: request.contractVersion,
    tenantId: request.tenantId,
    actor: {
      userId: request.actor.userId,
      uploaderId: request.actor.uploaderId,
    },
    conversation: {
      ...(request.conversation.sessionId
        ? { sessionId: request.conversation.sessionId }
        : {}),
      ...(request.conversation.notebookId
        ? { notebookId: request.conversation.notebookId }
        : {}),
      ...(request.conversation.assetId
        ? { assetId: request.conversation.assetId }
        : {}),
      ...(request.conversation.nodeId
        ? { nodeId: request.conversation.nodeId }
        : {}),
    },
    action: request.action,
    ...(request.priorOperationId
      ? { priorOperationId: request.priorOperationId }
      : {}),
    ...(request.confirmedIdentity
      ? { confirmedIdentity: request.confirmedIdentity }
      : {}),
    text: request.text,
    caption: request.caption,
    attachments: request.attachments.map((attachment) => ({
      kind: attachment.kind,
      mimeType: attachment.mimeType,
      filename: attachment.filename,
      sizeBytes: attachment.sizeBytes,
      sha256: attachment.sha256,
    })),
  };
}
