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
export type ChannelAction = "message" | "reset" | "confirm_identity";
export type OperationState =
  | "queued"
  | "running"
  | "complete"
  | "candidate_review"
  | "insufficient_evidence"
  | "failed"
  | "cancelled";

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const CHANNELS = new Set<Channel>(["telegram", "slack", "hub", "mobile"]);
const ACTIONS = new Set<ChannelAction>(["message", "reset", "confirm_identity"]);
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
  "text",
  "caption",
  "attachments",
]);
const ACTOR_FIELDS = new Set(["userId", "externalUserId", "uploaderId"]);
const CONVERSATION_FIELDS = new Set(["id", "sessionId", "notebookId", "assetId", "nodeId"]);
const ATTACHMENT_FIELDS = new Set([
  "attachmentId",
  "kind",
  "mimeType",
  "filename",
  "sizeBytes",
  "sha256",
]);

function object(raw: unknown, code: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ChannelContractError(code);
  return raw as Record<string, unknown>;
}

function rejectUnknown(value: Record<string, unknown>, allowed: Set<string>, code: string): void {
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new ChannelContractError(code);
}

function requiredString(raw: unknown, code: string, max = 500): string {
  if (typeof raw !== "string" || !raw.trim()) throw new ChannelContractError(code);
  return raw.trim().slice(0, max);
}

function optionalUuid(raw: unknown, code: string): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !UUID_RE.test(raw)) throw new ChannelContractError(code);
  return raw.toLowerCase();
}

/** Strict runtime parser. It mirrors contracts/channel-workflow.v1.schema.json. */
export function parseChannelWorkflowRequest(raw: unknown): ChannelWorkflowRequest {
  const value = object(raw, "invalid_request");
  rejectUnknown(value, REQUEST_FIELDS, "unknown_request_field");
  if (value.contractVersion !== "1.0") throw new ChannelContractError("unsupported_contract_version");

  const tenantId = requiredString(value.tenantId, "invalid_tenant_id");
  if (!UUID_RE.test(tenantId)) throw new ChannelContractError("invalid_tenant_id");

  const actor = object(value.actor, "invalid_actor");
  rejectUnknown(actor, ACTOR_FIELDS, "unknown_actor_field");
  const userId = requiredString(actor.userId, "actor_id_required", 200);
  const externalUserId = requiredString(actor.externalUserId, "external_user_id_required", 200);
  const uploaderId = requiredString(actor.uploaderId, "uploader_id_required", 200);

  if (typeof value.channel !== "string" || !CHANNELS.has(value.channel as Channel)) {
    throw new ChannelContractError("invalid_channel");
  }
  if (typeof value.action !== "string" || !ACTIONS.has(value.action as ChannelAction)) {
    throw new ChannelContractError("invalid_action");
  }

  const conversation = object(value.conversation, "invalid_conversation");
  rejectUnknown(conversation, CONVERSATION_FIELDS, "unknown_conversation_field");
  const conversationId = requiredString(conversation.id, "conversation_id_required");

  if (!Array.isArray(value.attachments) || value.attachments.length > 10) {
    throw new ChannelContractError("invalid_attachments");
  }
  const attachments = value.attachments.map((rawAttachment): ChannelAttachment => {
    const attachment = object(rawAttachment, "invalid_attachment");
    rejectUnknown(attachment, ATTACHMENT_FIELDS, "unknown_attachment_field");
    const attachmentId = requiredString(attachment.attachmentId, "attachment_id_required", 200);
    if (typeof attachment.kind !== "string" || !KINDS.has(attachment.kind as AttachmentKind)) {
      throw new ChannelContractError("invalid_attachment_kind");
    }
    const mimeType = requiredString(attachment.mimeType, "attachment_mime_required", 200);
    const filename = requiredString(attachment.filename, "attachment_filename_required", 255);
    if (
      typeof attachment.sizeBytes !== "number" ||
      !Number.isSafeInteger(attachment.sizeBytes) ||
      attachment.sizeBytes < 0
    ) {
      throw new ChannelContractError("invalid_attachment_size");
    }
    if (typeof attachment.sha256 !== "string" || !SHA256_RE.test(attachment.sha256)) {
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
  });

  const text = typeof value.text === "string" ? value.text.slice(0, 4000) : "";
  const caption = typeof value.caption === "string" ? value.caption.slice(0, 4000) : "";

  return {
    contractVersion: "1.0",
    tenantId: tenantId.toLowerCase(),
    actor: { userId, externalUserId, uploaderId },
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
    priorOperationId: optionalUuid(value.priorOperationId, "invalid_prior_operation_id"),
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
export function semanticProjection(request: ChannelWorkflowRequest): Record<string, unknown> {
  return {
    contractVersion: request.contractVersion,
    tenantId: request.tenantId,
    actor: {
      userId: request.actor.userId,
      uploaderId: request.actor.uploaderId,
    },
    conversation: {
      ...(request.conversation.sessionId ? { sessionId: request.conversation.sessionId } : {}),
      ...(request.conversation.notebookId ? { notebookId: request.conversation.notebookId } : {}),
      ...(request.conversation.assetId ? { assetId: request.conversation.assetId } : {}),
      ...(request.conversation.nodeId ? { nodeId: request.conversation.nodeId } : {}),
    },
    action: request.action,
    ...(request.priorOperationId ? { priorOperationId: request.priorOperationId } : {}),
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
