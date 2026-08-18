/**
 * Channel-neutral MIRA workflow.
 *
 * Telegram, Slack, Hub, and mobile normalize transport events before this
 * boundary. This module owns semantic routing and calls the existing Hub
 * nameplate, manual-discovery, Files, and notebook-chat capabilities through
 * injected adapters. Channel code may render the result but cannot recompute
 * identity, possession, applicability, retrieval scope, or citations.
 */

import { createHash } from "node:crypto";

import type { NotebookSource } from "@/lib/equipment-notebooks";
import type { DiscoveryResult } from "@/lib/manual-discovery";
import type {
  ChannelAttachment,
  ChannelCitation,
  ChannelWorkflowRequest,
  ChannelWorkflowResult,
  EquipmentIdentity,
  OperationProgressStep,
  OperationState,
} from "@/lib/channel-workflow-contract";
import type {
  ChannelWorkspace,
  ChannelWorkspaceStatePatch,
} from "@/lib/channel-workspaces";

export type RecognizedImageKind = "nameplate" | "electrical_print" | "other" | "unknown";

export interface WorkflowAttachment {
  descriptor: ChannelAttachment;
  bytes: Buffer;
}

export interface NameplateRecognitionOutcome {
  ok: boolean;
  statusCode: number;
  fileId: string | null;
  imageKind: RecognizedImageKind;
  candidate: EquipmentIdentity;
  confidence: number | null;
  rawObservation: Record<string, unknown> | null;
  error?: string | null;
}

export interface FileIntakeOutcome {
  ok: boolean;
  statusCode: number;
  fileId: string | null;
  documentId: string | null;
  indexed: boolean;
  sourcesSynced?: boolean;
  processingState: string;
  warning?: string | null;
  error?: string | null;
}

export interface NotebookAnswerOutcome {
  status: "answered" | "insufficient_evidence" | "error";
  text: string;
  citations: ChannelCitation[];
}

export interface PriorWorkflowOperation {
  tenantId: string;
  sessionId: string;
  channel: ChannelWorkflowRequest["channel"];
  actorUserId: string;
  uploaderId: string;
  state: OperationState;
  result: Record<string, unknown> | null;
  terminalDeliveryClaimedAt: string | null;
  terminalDeliveredAt: string | null;
}

export interface ChannelWorkflowDependencies {
  progress(step: OperationProgressStep): Promise<boolean>;
  updateWorkspace(patch: ChannelWorkspaceStatePatch): Promise<boolean>;
  resetWorkspace(
    request: ChannelWorkflowRequest,
    operationId: string,
  ): Promise<ChannelWorkspace>;
  recognizeNameplate(
    workspace: ChannelWorkspace,
    attachment: WorkflowAttachment,
    request: ChannelWorkflowRequest,
  ): Promise<NameplateRecognitionOutcome>;
  discoverManual(identity: EquipmentIdentity): Promise<DiscoveryResult>;
  confirmIdentity(
    workspace: ChannelWorkspace,
    args: {
      fileId: string;
      identity: EquipmentIdentity;
      confidence: number | null;
      rawObservation: Record<string, unknown> | null;
      discover: boolean;
    },
    request: ChannelWorkflowRequest,
  ): Promise<{ ok: boolean; statusCode: number; body: Record<string, unknown> }>;
  intakeFile(
    workspace: ChannelWorkspace,
    attachment: WorkflowAttachment,
    request: ChannelWorkflowRequest,
  ): Promise<FileIntakeOutcome>;
  listSources(workspace: ChannelWorkspace): Promise<NotebookSource[]>;
  answerNotebook(
    workspace: ChannelWorkspace,
    question: string,
    sourceDocIds: string[],
  ): Promise<NotebookAnswerOutcome>;
  getPriorOperation(
    tenantId: string,
    operationId: string,
  ): Promise<PriorWorkflowOperation | null>;
}

export interface ExecuteChannelWorkflowInput {
  request: ChannelWorkflowRequest;
  workspace: ChannelWorkspace;
  operationId: string;
  attachments: WorkflowAttachment[];
}

const MANUAL_INTENT =
  /\b(manual|user\s+guide|instruction(?:s)?|documentation|datasheet|data\s+sheet|pdf)\b/i;
const CONFIRMATION_INTENT =
  /^\s*(?:yes|yep|confirm(?:ed)?|correct|looks\s+right|use\s+it|add\s+it)\b/i;

export function hasManualIntent(request: Pick<ChannelWorkflowRequest, "text" | "caption">): boolean {
  return MANUAL_INTENT.test(`${request.text}\n${request.caption}`);
}

function conversation(workspace: ChannelWorkspace): ChannelWorkflowResult["conversation"] {
  return {
    sessionId: workspace.sessionId,
    notebookId: workspace.notebookId,
    generation: workspace.generation,
    assetId: workspace.assetId,
    nodeId: workspace.selectedNodeId,
  };
}

function baseResult(
  operationId: string,
  workspace: ChannelWorkspace,
  values: Pick<
    ChannelWorkflowResult,
    "state" | "handled" | "semanticKind" | "provenance"
  > &
    Partial<ChannelWorkflowResult>,
): ChannelWorkflowResult {
  return {
    contractVersion: "1.0",
    operationId,
    state: values.state,
    handled: values.handled,
    semanticKind: values.semanticKind,
    delegatedRoute: values.delegatedRoute ?? null,
    conversation: conversation(workspace),
    provenance: values.provenance,
    ...(values.identity !== undefined ? { identity: values.identity } : {}),
    ...(values.files !== undefined ? { files: values.files } : {}),
    ...(values.manual !== undefined ? { manual: values.manual } : {}),
    ...(values.answer !== undefined ? { answer: values.answer } : {}),
  };
}

function identityValues(identity: EquipmentIdentity): string[] {
  return [
    identity.manufacturer,
    identity.productFamily,
    identity.series,
    identity.model,
    identity.typeCode,
    identity.partNumber,
    identity.catalogNumber,
    identity.serialNumber,
    identity.equipmentType,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function likelyNameplate(kind: RecognizedImageKind, identity: EquipmentIdentity): boolean {
  if (kind === "electrical_print" || kind === "other") return false;
  if (kind === "nameplate") return true;
  const identifiers = [
    identity.model,
    identity.series,
    identity.typeCode,
    identity.partNumber,
    identity.catalogNumber,
    identity.serialNumber,
  ].filter((value) => typeof value === "string" && value.trim());
  return Boolean(identity.manufacturer) && identifiers.length > 0;
}

async function requireProgress(
  deps: ChannelWorkflowDependencies,
  step: OperationProgressStep,
): Promise<void> {
  if (!(await deps.progress(step))) throw new Error("operation_lease_lost");
}

function manualPreview(discovery: DiscoveryResult): Record<string, unknown> {
  if (!discovery.serviceAvailable) {
    return {
      state: "unavailable",
      official: false,
      requiresIdentityConfirmation: true,
      reason: discovery.reason,
      candidate: null,
    };
  }
  if (!discovery.found || !discovery.candidate) {
    return {
      state: "not_found",
      official: false,
      requiresIdentityConfirmation: true,
      reason: discovery.reason,
      candidate: null,
    };
  }
  const official = discovery.validated && discovery.isDirectPdf && discovery.oemHost;
  return {
    state: official ? "official_candidate" : "candidate",
    official,
    requiresIdentityConfirmation: true,
    reason: discovery.reason,
    candidate: {
      url: discovery.candidate.url,
      title: discovery.candidate.title,
      host: discovery.candidate.host,
      validated: discovery.validated,
      directPdf: discovery.isDirectPdf,
      oemHost: discovery.oemHost,
    },
  };
}

async function discoverForIdentity(
  input: ExecuteChannelWorkflowInput,
  deps: ChannelWorkflowDependencies,
  identity: EquipmentIdentity,
  provenance: Record<string, unknown>,
): Promise<ChannelWorkflowResult> {
  await requireProgress(deps, "discovering_manual");
  const discovery = await deps.discoverManual(identity);
  const manual = manualPreview(discovery);
  const found = discovery.found && discovery.candidate !== null;
  return baseResult(input.operationId, input.workspace, {
    state: found ? "candidate_review" : "insufficient_evidence",
    handled: true,
    semanticKind: "nameplate_manual",
    identity,
    manual,
    provenance: {
      ...provenance,
      discoveryServiceAvailable: discovery.serviceAvailable,
      identityAuthority: "candidate_pending_confirmation",
      manualPossession: false,
    },
  });
}

function priorResultIdentity(raw: Record<string, unknown> | null): {
  identity: EquipmentIdentity;
  fileId: string;
  confidence: number | null;
  rawObservation: Record<string, unknown> | null;
} | null {
  if (!raw) return null;
  const identity = raw.identity;
  const provenance = raw.provenance;
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) return null;
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) return null;
  const p = provenance as Record<string, unknown>;
  const fileId = typeof p.nameplateFileId === "string" ? p.nameplateFileId : "";
  if (!fileId) return null;
  return {
    identity: identity as EquipmentIdentity,
    fileId,
    confidence: typeof p.confidence === "number" ? p.confidence : null,
    rawObservation:
      p.rawObservation && typeof p.rawObservation === "object" && !Array.isArray(p.rawObservation)
        ? (p.rawObservation as Record<string, unknown>)
        : null,
  };
}

async function confirmCandidate(
  input: ExecuteChannelWorkflowInput,
  deps: ChannelWorkflowDependencies,
  priorOperationId: string | null | undefined,
): Promise<ChannelWorkflowResult> {
  if (!priorOperationId) throw new Error("prior_operation_required");
  const prior = await deps.getPriorOperation(
    input.request.tenantId,
    priorOperationId,
  );
  const candidate = priorResultIdentity(prior?.result ?? null);
  if (
    !prior ||
    prior.tenantId !== input.request.tenantId ||
    prior.sessionId !== input.workspace.sessionId ||
    prior.state !== "candidate_review" ||
    !candidate
  ) {
    throw new Error("prior_operation_not_found");
  }
  await requireProgress(deps, "discovering_manual");
  const confirmed = await deps.confirmIdentity(
    input.workspace,
    {
      ...candidate,
      identity: input.request.confirmedIdentity ?? candidate.identity,
      discover: true,
    },
    input.request,
  );
  const status = typeof confirmed.body.status === "string" ? confirmed.body.status : "failed";
  const manual =
    confirmed.body.manual && typeof confirmed.body.manual === "object"
      ? (confirmed.body.manual as Record<string, unknown>)
      : null;
  const trusted =
    manual?.indexed === true &&
    (manual.matchState === "verified" || manual.matchState === "user_confirmed") &&
    typeof manual.docId === "string";
  if (confirmed.ok) {
    const confirmedIdentity = input.request.confirmedIdentity ?? candidate.identity;
    await deps.updateWorkspace({
      equipmentIdentity: confirmedIdentity,
      pendingIntent: null,
      pendingOperationId: null,
      ...(typeof manual?.fileId === "string" ? { lastFileId: manual.fileId } : {}),
      ...(trusted ? { lastDocId: String(manual!.docId) } : {}),
    });
  }
  const state =
    status === "complete" && trusted
      ? "complete"
      : status === "candidate_review"
        ? "candidate_review"
        : confirmed.ok
          ? "insufficient_evidence"
          : "failed";
  return baseResult(input.operationId, input.workspace, {
    state,
    handled: true,
    semanticKind: "nameplate_manual",
    identity: input.request.confirmedIdentity ?? candidate.identity,
    manual: { ...confirmed.body, verifiedGroundingSource: trusted },
    provenance: {
      sourceOperationId: priorOperationId,
      identityAuthority: "user_confirmed",
      manualPossession: trusted,
    },
  });
}

const RECOVERABLE_TERMINAL_STATES = new Set<OperationState>([
  "complete",
  "candidate_review",
  "insufficient_evidence",
  "failed",
]);
const RECOVERABLE_SEMANTIC_KINDS = new Set<ChannelWorkflowResult["semanticKind"]>([
  "nameplate_manual",
  "file_intake",
  "grounded_answer",
  "reset",
  "fallthrough",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneRecoveredResult(
  input: ExecuteChannelWorkflowInput,
  priorOperationId: string,
  prior: PriorWorkflowOperation,
): ChannelWorkflowResult | null {
  const raw = prior.result;
  if (
    !raw ||
    raw.contractVersion !== "1.0" ||
    raw.operationId !== priorOperationId ||
    raw.state !== prior.state ||
    raw.handled !== true ||
    typeof raw.semanticKind !== "string" ||
    !RECOVERABLE_SEMANTIC_KINDS.has(raw.semanticKind as ChannelWorkflowResult["semanticKind"]) ||
    !isRecord(raw.conversation) ||
    raw.conversation.sessionId !== prior.sessionId ||
    !isRecord(raw.provenance)
  ) {
    return null;
  }
  if (
    raw.delegatedRoute !== undefined &&
    raw.delegatedRoute !== null &&
    raw.delegatedRoute !== "printsense" &&
    raw.delegatedRoute !== "legacy_diagnostics"
  ) {
    return null;
  }
  if (
    (raw.identity !== undefined && raw.identity !== null && !isRecord(raw.identity)) ||
    (raw.files !== undefined && !Array.isArray(raw.files)) ||
    (raw.manual !== undefined && raw.manual !== null && !isRecord(raw.manual)) ||
    (raw.answer !== undefined && raw.answer !== null && !isRecord(raw.answer))
  ) {
    return null;
  }

  const recovered: ChannelWorkflowResult = {
    contractVersion: "1.0",
    operationId: input.operationId,
    state: prior.state,
    handled: true,
    semanticKind: raw.semanticKind as ChannelWorkflowResult["semanticKind"],
    delegatedRoute: raw.delegatedRoute as ChannelWorkflowResult["delegatedRoute"],
    conversation: conversation(input.workspace),
    provenance: {
      ...raw.provenance,
      recoveredFromOperationId: priorOperationId,
      userAuthorizedPossibleDuplicate: true,
    },
  };
  if (raw.identity !== undefined) {
    recovered.identity = raw.identity as ChannelWorkflowResult["identity"];
  }
  if (raw.files !== undefined) {
    recovered.files = raw.files as ChannelWorkflowResult["files"];
  }
  if (raw.manual !== undefined) {
    recovered.manual = raw.manual as ChannelWorkflowResult["manual"];
  }
  if (raw.answer !== undefined) {
    recovered.answer = raw.answer as ChannelWorkflowResult["answer"];
  }
  return recovered;
}

async function recoverDelivery(
  input: ExecuteChannelWorkflowInput,
  deps: ChannelWorkflowDependencies,
  priorOperationId: string | null | undefined,
): Promise<ChannelWorkflowResult> {
  if (!priorOperationId) throw new Error("prior_operation_required");
  const prior = await deps.getPriorOperation(input.request.tenantId, priorOperationId);
  if (
    !prior ||
    prior.tenantId !== input.request.tenantId ||
    prior.sessionId !== input.workspace.sessionId ||
    prior.channel !== input.request.channel ||
    prior.actorUserId !== input.request.actor.userId ||
    prior.uploaderId !== input.request.actor.uploaderId
  ) {
    throw new Error("prior_operation_not_found");
  }
  if (
    !RECOVERABLE_TERMINAL_STATES.has(prior.state) ||
    !prior.terminalDeliveryClaimedAt ||
    prior.terminalDeliveredAt
  ) {
    throw new Error("prior_operation_not_recoverable");
  }
  const recovered = cloneRecoveredResult(input, priorOperationId, prior);
  if (!recovered) throw new Error("prior_operation_not_recoverable");
  return recovered;
}

async function intakePdfs(
  input: ExecuteChannelWorkflowInput,
  deps: ChannelWorkflowDependencies,
  pdfs: WorkflowAttachment[],
): Promise<ChannelWorkflowResult> {
  await requireProgress(deps, "ingesting_file");
  const files: NonNullable<ChannelWorkflowResult["files"]> = [];
  let failed = false;
  for (const pdf of pdfs) {
    const outcome = await deps.intakeFile(input.workspace, pdf, input.request);
    if (!outcome.ok || !outcome.fileId) failed = true;
    if (outcome.fileId) {
      files.push({
        fileId: outcome.fileId,
        documentId: outcome.documentId,
        filename: pdf.descriptor.filename,
        indexed: outcome.indexed && outcome.sourcesSynced !== false,
        processingState: outcome.processingState,
      });
      await deps.updateWorkspace({
        lastFileId: outcome.fileId,
        lastDocId:
          outcome.indexed && outcome.sourcesSynced !== false ? outcome.documentId : null,
        pendingIntent: null,
        pendingOperationId: null,
      });
    }
  }
  return baseResult(input.operationId, input.workspace, {
    state: failed ? "failed" : "complete",
    handled: true,
    semanticKind: "file_intake",
    files,
    provenance: {
      sourceChannel: input.request.channel,
      sourceEventId: input.request.eventId,
      uploaderId: input.request.actor.uploaderId,
      attachmentHashes: pdfs.map((pdf) => pdf.descriptor.sha256),
      indexedDocumentIds: files
        .filter((file) => file.indexed && file.documentId)
        .map((file) => file.documentId),
    },
  });
}

function positiveSourceIds(sources: NotebookSource[]): string[] {
  return sources
    .filter(
      (source) =>
        source.enabledByDefault &&
        (source.matchState === "verified" || source.matchState === "user_confirmed") &&
        source.status !== "failed",
    )
    .map((source) => source.docId);
}

function attachmentMatches(
  supplied: WorkflowAttachment,
  expected: ChannelAttachment | undefined,
): boolean {
  if (!expected) return false;
  return (
    supplied.descriptor.attachmentId === expected.attachmentId &&
    supplied.descriptor.kind === expected.kind &&
    supplied.descriptor.mimeType === expected.mimeType &&
    supplied.descriptor.filename === expected.filename &&
    supplied.bytes.length === expected.sizeBytes &&
    createHash("sha256").update(supplied.bytes).digest("hex") === expected.sha256
  );
}

async function answerFromNotebook(
  input: ExecuteChannelWorkflowInput,
  deps: ChannelWorkflowDependencies,
  question: string,
): Promise<ChannelWorkflowResult | null> {
  const sources = await deps.listSources(input.workspace);
  const docIds = positiveSourceIds(sources);
  if (docIds.length === 0) return null;
  await requireProgress(deps, "answering_from_files");
  const answer = await deps.answerNotebook(input.workspace, question, docIds);
  return baseResult(input.operationId, input.workspace, {
    state:
      answer.status === "answered"
        ? "complete"
        : answer.status === "insufficient_evidence"
          ? "insufficient_evidence"
          : "failed",
    handled: true,
    semanticKind: "grounded_answer",
    answer: { text: answer.text, citations: answer.citations },
    provenance: {
      sourceSnapshot: docIds,
      retrievalScope: "positive_notebook_sources",
      exactLastDocumentSelected:
        input.workspace.lastDocId === null || docIds.includes(input.workspace.lastDocId),
    },
  });
}

/** Execute one already-fenced canonical operation. */
export async function executeChannelWorkflow(
  input: ExecuteChannelWorkflowInput,
  deps: ChannelWorkflowDependencies,
): Promise<ChannelWorkflowResult> {
  const { request, workspace } = input;
  if (
    request.tenantId !== workspace.tenantId ||
    request.channel !== workspace.channel ||
    request.conversation.id !== workspace.conversationId
  ) {
    throw new Error("workspace_context_conflict");
  }

  if (request.action === "reset") {
    await requireProgress(deps, "resetting_workspace");
    const fresh = await deps.resetWorkspace(request, input.operationId);
    return baseResult(input.operationId, fresh, {
      state: "complete",
      handled: true,
      semanticKind: "reset",
      identity: null,
      provenance: { priorSessionId: workspace.sessionId, clearedCanonicalState: true },
    });
  }

  if (request.action === "confirm_identity") {
    return confirmCandidate(input, deps, request.priorOperationId);
  }

  if (request.action === "recover_delivery") {
    return recoverDelivery(input, deps, request.priorOperationId);
  }

  const messageText = `${request.text}\n${request.caption}`;
  if (CONFIRMATION_INTENT.test(messageText) && workspace.pendingOperationId) {
    return confirmCandidate(input, deps, workspace.pendingOperationId);
  }

  const descriptors = new Map(request.attachments.map((item) => [item.attachmentId, item]));
  if (
    input.attachments.some(
      (item) => !attachmentMatches(item, descriptors.get(item.descriptor.attachmentId)),
    ) ||
    input.attachments.length !== request.attachments.length
  ) {
    throw new Error("attachment_envelope_mismatch");
  }

  const pdfs = input.attachments.filter((item) => item.descriptor.kind === "pdf");
  if (pdfs.length > 0) return intakePdfs(input, deps, pdfs);

  const image = input.attachments.find((item) => item.descriptor.kind === "image");
  const manualIntent = hasManualIntent(request);
  if (image) {
    await requireProgress(deps, "recognizing_nameplate");
    const recognized = await deps.recognizeNameplate(workspace, image, request);
    if (recognized.imageKind === "electrical_print") {
      return baseResult(input.operationId, workspace, {
        state: "complete",
        handled: false,
        semanticKind: "fallthrough",
        delegatedRoute: "printsense",
        provenance: {
          imageKind: recognized.imageKind,
          nameplateFileId: recognized.fileId,
          recognitionAttempted: true,
        },
      });
    }
    if (!recognized.ok || !likelyNameplate(recognized.imageKind, recognized.candidate)) {
      return baseResult(input.operationId, workspace, {
        state: recognized.ok ? "complete" : "insufficient_evidence",
        handled: false,
        semanticKind: "fallthrough",
        delegatedRoute: "legacy_diagnostics",
        provenance: {
          imageKind: recognized.imageKind,
          nameplateFileId: recognized.fileId,
          recognitionAttempted: true,
          recognitionError: recognized.error ?? null,
        },
      });
    }

    const identity = recognized.candidate;
    await deps.updateWorkspace({
      equipmentIdentity: identity,
      ...(recognized.fileId ? { lastFileId: recognized.fileId } : {}),
      pendingIntent: manualIntent ? "manual_discovery" : null,
      pendingOperationId: input.operationId,
    });
    const provenance = {
      imageKind: recognized.imageKind,
      nameplateFileId: recognized.fileId,
      confidence: recognized.confidence,
      rawObservation: recognized.rawObservation,
      identityFieldCount: identityValues(identity).length,
    };
    if (manualIntent) return discoverForIdentity(input, deps, identity, provenance);
    return baseResult(input.operationId, workspace, {
      state: "candidate_review",
      handled: true,
      semanticKind: "nameplate_manual",
      identity,
      manual: null,
      provenance: { ...provenance, identityAuthority: "candidate_pending_confirmation" },
    });
  }

  if ((manualIntent || workspace.pendingIntent === "manual_discovery") && workspace.equipmentIdentity) {
    await deps.updateWorkspace({
      pendingIntent: "manual_discovery",
      pendingOperationId: input.operationId,
    });
    return discoverForIdentity(input, deps, workspace.equipmentIdentity, {
      reusedPersistedIdentity: true,
      nameplateFileId: workspace.lastFileId,
    });
  }

  const question = request.text.trim() || request.caption.trim();
  if (question) {
    const grounded = await answerFromNotebook(input, deps, question);
    if (grounded) return grounded;
  }

  return baseResult(input.operationId, workspace, {
    state: "complete",
    handled: false,
    semanticKind: "fallthrough",
    delegatedRoute: "legacy_diagnostics",
    provenance: { reason: "no_canonical_workflow_match" },
  });
}
