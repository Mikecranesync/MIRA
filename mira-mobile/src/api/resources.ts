// Shared mobile data layer — typed resource half. Every screen consumes these;
// no screen builds its own requests. All paths trailing-slash (Hub canonical).

import {
  errorFromStatus,
  request,
  uploadMultipart,
  withAuthEventsSuppressed,
  clearAllLocalState,
  requestStream,
} from "./client";
import { createChatSseParser, type ChatTurn } from "../lib/sse";
import type { AssetHistory, HistoryResult, MachineEvidenceWindow } from "../lib/replay";
import type { VisualEvidence } from "../lib/sensor";

// --- auth -------------------------------------------------------------------

export async function signIn(
  email: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  return withAuthEventsSuppressed(async () => {
    try {
      const csrfRes = await request("/api/auth/csrf/");
      const csrfToken = (csrfRes.data as { csrfToken?: string } | null)?.csrfToken;
      if (!csrfToken) return { ok: false, error: "could not start sign-in" };
      try {
        await request("/api/auth/callback/credentials/", {
          method: "POST",
          form: { csrfToken, email, password, json: "true" },
        });
      } catch {
        /* NextAuth's callback status varies; /api/me below is the truth. */
      }
      await request("/api/me/");
      return { ok: true };
    } catch {
      return { ok: false, error: "invalid email or password" };
    }
  });
}

export async function signOut(): Promise<void> {
  try {
    const csrfRes = await request("/api/auth/csrf/");
    const csrfToken = (csrfRes.data as { csrfToken?: string } | null)?.csrfToken;
    if (csrfToken) {
      await request("/api/auth/signout/", {
        method: "POST",
        form: { csrfToken, json: "true" },
      });
    }
  } catch {
    /* fail-closed locally regardless */
  }
  await clearAllLocalState();
}

export interface Me {
  id: string;
  email: string;
  name: string | null;
  role: string;
  tenantId: string;
  capabilities: string[];
}

/** Fail-closed: any failure yields null (unauthenticated / least privilege). */
export async function getMe(): Promise<Me | null> {
  try {
    const r = await withAuthEventsSuppressed(() => request("/api/me/"));
    const d = r.data as Record<string, unknown> | null;
    if (!d) return null;
    return {
      id: String(d.id ?? ""),
      email: String(d.email ?? ""),
      name: (d.name as string) ?? null,
      role: typeof d.role === "string" ? d.role : "",
      tenantId: String(d.tenantId ?? ""),
      capabilities: Array.isArray(d.capabilities) ? (d.capabilities as string[]) : [],
    };
  } catch {
    return null;
  }
}

// --- work orders ------------------------------------------------------------

export interface WorkOrder {
  id: string;
  work_order_number: string;
  title: string;
  description: string;
  asset: string;
  equipment_id: string | null;
  status: string;
  priority: string;
  source_label: string;
  suggested_actions: string[];
  safety_warnings: string[];
  created_at: string;
}

export async function listWorkOrders(status?: string): Promise<WorkOrder[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  const r = await request(`/api/work-orders/${q}`);
  return ((r.data as { work_orders?: WorkOrder[] } | null)?.work_orders ?? []);
}

export async function getWorkOrder(id: string): Promise<WorkOrder | null> {
  const r = await request(`/api/work-orders/${encodeURIComponent(id)}/`);
  return ((r.data as { work_order?: WorkOrder } | null)?.work_order ?? null);
}

export interface CreateWorkOrderInput {
  equipment_id: string;
  description: string;
  title?: string;
  priority?: string;
  /** Client-generated idempotency key (PR #3223 contract; ignored gracefully
   *  by servers that predate it). Generate ONCE per logical create. */
  client_key: string;
}

export async function createWorkOrder(
  input: CreateWorkOrderInput,
): Promise<{ workOrder: WorkOrder; replayed: boolean }> {
  const r = await request("/api/work-orders/", {
    method: "POST",
    json: input,
    idempotencyKey: input.client_key,
  });
  const d = r.data as { work_order: WorkOrder; replayed?: boolean };
  return { workOrder: d.work_order, replayed: Boolean(d.replayed) };
}

export async function updateWorkOrder(
  id: string,
  patch: { status?: string; priority?: string; resolution?: string },
): Promise<WorkOrder | null> {
  const r = await request(`/api/work-orders/${encodeURIComponent(id)}/`, {
    method: "PATCH",
    json: patch,
  });
  return ((r.data as { work_order?: WorkOrder } | null)?.work_order ?? null);
}

// --- PM schedule ------------------------------------------------------------

export interface PmSchedule {
  id: string;
  task: string;
  manufacturer: string | null;
  model_number: string | null;
  equipment_id: string | null;
  interval_label: string | null;
  next_due_at: string | null;
  criticality: string | null;
}

export async function listPmSchedules(): Promise<PmSchedule[]> {
  const r = await request("/api/pm-schedules/");
  const d = r.data as { schedules?: Record<string, unknown>[] } | null;
  return (d?.schedules ?? []).map((s) => ({
    id: String(s.id ?? ""),
    task: String(s.task ?? s.task_description ?? s.title ?? "PM task"),
    manufacturer: (s.manufacturer as string) ?? null,
    model_number: (s.model_number as string) ?? null,
    equipment_id: s.equipment_id ? String(s.equipment_id) : null,
    interval_label: (s.interval_label as string) ?? (s.interval as string) ?? null,
    next_due_at: (s.next_due_at as string) ?? null,
    criticality: (s.criticality as string) ?? null,
  }));
}

export async function completePmSchedule(id: string): Promise<void> {
  await request(`/api/pm-schedules/${encodeURIComponent(id)}/complete/`, {
    method: "POST",
    json: {},
  });
}

export const PM_INTERVAL_UNITS = ["days", "weeks", "months", "years"] as const;

export interface CreatePmScheduleInput {
  equipment_id: string;
  task: string;
  interval_value: number;
  interval_unit: (typeof PM_INTERVAL_UNITS)[number];
  next_due_at?: string; // ISO date; server defaults to now + interval
  criticality?: "low" | "medium" | "high" | "critical";
}

/** SCH-04 (#3226): server contract — 201 {schedule}, stable 400 tokens,
 *  tenant-scoped 404 asset_not_found. No optimistic anything: callers refresh
 *  the list only after the server confirms. */
export async function createPmSchedule(input: CreatePmScheduleInput): Promise<void> {
  await request("/api/pm-schedules/", { method: "POST", json: input });
}

// --- assets -----------------------------------------------------------------

export interface Asset {
  id: string;
  name: string;
  /** Permanent QR identity (API field `tag`, from equipment_number). */
  tag?: string | null;
  location?: string | null;
  equipment_type?: string | null;
  type?: string | null;
  manufacturer?: string | null;
  model_number?: string | null;
  model?: string | null;
}

export async function listAssets(): Promise<Asset[]> {
  const r = await request("/api/assets/");
  const d = r.data as { assets?: Asset[]; rows?: Asset[] } | Asset[] | null;
  if (Array.isArray(d)) return d;
  return d?.assets ?? d?.rows ?? [];
}

export async function getAsset(id: string): Promise<Record<string, unknown> | null> {
  const r = await request(`/api/assets/${encodeURIComponent(id)}/`);
  return (r.data as Record<string, unknown> | null) ?? null;
}

export async function getAssetByTag(tag: string): Promise<Asset | null> {
  const r = await request(`/api/assets/by-tag/${encodeURIComponent(tag)}/`);
  const d = r.data as { asset?: Asset } | Asset | null;
  return (d as { asset?: Asset })?.asset ?? (d as Asset) ?? null;
}

/**
 * Open THE notebook for an asset, creating and binding it on first use.
 *
 * Idempotent server-side: a second call returns the same notebook rather than a
 * second one. Two notebooks on one machine would have disjoint document sets
 * and split history, and the duplicate is invisible in a list.
 *
 * `via` records HOW the machine was chosen. Confirmation is decided by the
 * server, never asserted by the phone: a scan (`qr` / `nfc`) is a selection
 * only, while a signed-in human choosing on a non-scan path (typed tag,
 * picker, nameplate) is recorded as confirmed by that user
 * (`mira-hub/src/lib/equipment-notebooks.ts` bindNotebookAsset).
 */
/** How a machine was chosen — mirrors the Hub's ASSET_SELECTION_METHODS. The
 *  phone reports the method; whether it counts as a confirmation is the
 *  server's rule (scan → unconfirmed; signed-in non-scan → confirmed). */
export type AssetSelectionMethod =
  | "qr"
  | "nfc"
  | "asset_picker"
  | "work_order"
  | "nameplate"
  | "manual_entry";

export async function openAssetNotebook(
  assetId: string,
  via: AssetSelectionMethod,
): Promise<Notebook> {
  const r = await request(`/api/assets/${encodeURIComponent(assetId)}/notebook/`, {
    method: "POST",
    json: { selectedVia: via },
  });
  const d = r.data as { notebook?: Notebook };
  if (!d?.notebook) throw new Error("open_notebook_failed");
  return d.notebook;
}

// --- equipment notebooks (NotebookLM-style workspaces; build spec §3–6) -----

/** The notebook's canonical-asset binding (server `asset` field). Null
 *  `confirmedAt` means selected-but-unconfirmed — the identity chip renders
 *  that as amber, never as confirmed. */
export interface NotebookAssetBinding {
  /** kg_entities.entity_id — the asset UUID as text. */
  entityId: string;
  selectedVia: AssetSelectionMethod | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
}

export interface Notebook {
  id: string;
  displayName: string;
  manufacturer: string | null;
  model: string | null;
  equipmentType: string | null;
  identityStatus: string; // unknown | candidate | user_confirmed
  nodeId: string;
  sourceCount: number;
  createdAt: string | null;
  /** L2 machine binding, or null for a general (L0/L1) notebook. */
  asset: NotebookAssetBinding | null;
}

export function toNotebook(d: Record<string, unknown>): Notebook {
  const a = d.asset as Record<string, unknown> | null | undefined;
  return {
    id: String(d.id ?? ""),
    displayName: String(d.displayName ?? d.display_name ?? "Untitled"),
    manufacturer: (d.manufacturer as string) ?? null,
    model: (d.model as string) ?? null,
    equipmentType: (d.equipmentType as string) ?? null,
    identityStatus: String(d.identityStatus ?? "unknown"),
    nodeId: String(d.nodeId ?? ""),
    sourceCount: Number(d.sourceCount ?? 0),
    createdAt: (d.createdAt as string) ?? null,
    // Without this the client cannot see what the bind route stored — the
    // binding would exist on the server and be invisible on the phone.
    asset:
      a && a.entityId
        ? {
            entityId: String(a.entityId),
            selectedVia: a.selectedVia != null ? (String(a.selectedVia) as AssetSelectionMethod) : null,
            confirmedBy: a.confirmedBy != null ? String(a.confirmedBy) : null,
            confirmedAt: a.confirmedAt != null ? String(a.confirmedAt) : null,
          }
        : null,
  };
}

/**
 * L1→L2: bind THIS notebook to a canonical asset (PUT
 * /api/equipment-notebooks/[id]/asset). The client says WHICH asset and HOW it
 * was selected; confirmation is derived server-side and never sent. Failures
 * carry the server's technician-readable sentence in `error` (the mobile
 * error layer surfaces it verbatim) and a `code` a caller may switch on
 * (`asset_already_bound` → another notebook owns that machine).
 */
export async function bindNotebookAsset(
  notebookId: string,
  assetRef: string,
  selectedVia: AssetSelectionMethod,
): Promise<Notebook> {
  const r = await request(`/api/equipment-notebooks/${encodeURIComponent(notebookId)}/asset/`, {
    method: "PUT",
    json: { assetRef, selectedVia },
  });
  const d = r.data as { notebook?: Record<string, unknown> } | null;
  if (!d?.notebook) throw new Error("bind_asset_failed");
  return toNotebook(d.notebook);
}

export async function listNotebooks(): Promise<Notebook[]> {
  const r = await request("/api/equipment-notebooks/");
  const d = r.data as { notebooks?: Record<string, unknown>[] } | null;
  return (d?.notebooks ?? []).map(toNotebook);
}

export interface NotebookIdentity {
  displayName: string;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  equipmentType?: string | null;
  identityStatus?: "user_confirmed" | "candidate";
  identitySourceType?: "nameplate_image" | "user";
}

export async function createNotebook(input: NotebookIdentity): Promise<Notebook> {
  const r = await request("/api/equipment-notebooks/", { method: "POST", json: input });
  return toNotebook((r.data as { notebook: Record<string, unknown> }).notebook);
}

/** Server union for how a source functions inside a notebook. */
export type SourceRole =
  | "manual"
  | "quick_start"
  | "drawing"
  | "work_order"
  | "note"
  | "photo"
  | "other";

/** How much the relationship is trusted. Only `user_confirmed` / `verified`
 *  may be used as chat scope — a `candidate` is a PROPOSAL, not evidence. */
export type MatchState = "candidate" | "user_confirmed" | "verified" | "rejected";

export interface NotebookSource {
  docId: string;
  filename: string | null;
  status: string | null;
  enabledByDefault: boolean;
  matchState: string;
  pages: number | null;
  /** Workspace file behind this source (null for legacy doc-only rows). */
  fileId: string | null;
  /** 084: the canonical file this doc DERIVES from — e.g. the nameplate
   *  photograph behind a materialized nameplate text doc. When set, the
   *  viewer opens THIS as the primary object; the doc's own bytes are
   *  secondary "source details". */
  originFileId: string | null;
  sourceRole: string | null;
  /** Opaque server evidence for the match (why it was proposed). Preserved
   *  verbatim — the client never interprets or drops it. */
  matchEvidence: unknown | null;
}

/** Map a server source row. Unknown fields are preserved by the explicit
 *  fields below; anything the client doesn't model stays untouched on the
 *  server. A row with no `matchState` predates the field and is treated as
 *  user_confirmed (that is what it meant before match states existed). */
export function toNotebookSource(d: Record<string, unknown>): NotebookSource {
  return {
    docId: String(d.docId ?? d.doc_id ?? ""),
    filename: (d.filename as string) ?? null,
    status: (d.status as string) ?? null,
    enabledByDefault: d.enabledByDefault !== false,
    matchState: d.matchState != null ? String(d.matchState) : "user_confirmed",
    pages: d.pages != null ? Number(d.pages) : null,
    fileId: d.fileId != null ? String(d.fileId) : null,
    originFileId: d.originFileId != null ? String(d.originFileId) : null,
    sourceRole: d.sourceRole != null ? String(d.sourceRole) : null,
    matchEvidence: d.matchEvidence ?? null,
  };
}

/** TRUE only for a MATERIALIZED source (it has a docId — i.e. chunks exist to
 *  retrieve) whose relationship a human or the verifier has accepted.
 *  Candidates and rejected matches must never render as an enabled chat
 *  scope: an unconfirmed proposal is not grounded evidence. */
export function canBeChatSource(
  source: { docId?: string | null; matchState?: string | null },
): boolean {
  if (!source.docId) return false;
  const ms = source.matchState ?? "";
  return ms === "user_confirmed" || ms === "verified";
}

export interface NotebookServerTurn {
  /** 086: hub_users.id of the technician who asked; null = legacy shared row.
   *  The server already scopes `turns` to the caller + legacy, so this is
   *  informational (additive; older Hubs omit it). */
  ownerUserId?: string | null;
  /** 086: true for a pre-ownership row every tenant user can read. */
  sharedLegacy?: boolean;
  id: string;
  question: string;
  answerStatus: string;
  answerText: string | null;
  /** Persisted citations (same shape as the live sources frame). */
  evidence?: unknown[];
  /** 084 (#3387): the evidence-ladder basis the answer was SERVED under.
   *  Never inferred from "zero citations" — absent means no claim. */
  basis?: string | null;
}

/** A photograph LINKED to this notebook (`workspace_file_links`, role
 *  "photo") — what Sensor LOOK parks. It is deliberately NOT an
 *  `equipment_notebook_sources` row and the Hub returns it in its own
 *  `photos[]` array for that reason: a linked photo is viewable evidence in
 *  the notebook's files, never chat scope. Rendering it under Sources would
 *  be the same lie the LOOK card avoids by saying "files", not "sources". */
export interface NotebookPhoto {
  fileId: string;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  /** When the file was parked — the capture time we can honestly show. */
  createdAt: string | null;
  /** When it was linked to THIS notebook (a re-used file can predate it). */
  linkedAt: string | null;
}

export function toNotebookPhoto(d: Record<string, unknown>): NotebookPhoto {
  return {
    // The Hub sends `fileId`; `id` is accepted because that is the column
    // name on the underlying workspace-file row and both have shipped.
    fileId: String(d.fileId ?? d.id ?? ""),
    filename: (d.filename as string) ?? null,
    mimeType: d.mimeType != null ? String(d.mimeType) : null,
    sizeBytes: d.sizeBytes != null ? Number(d.sizeBytes) : null,
    createdAt: d.createdAt != null ? String(d.createdAt) : null,
    linkedAt: d.linkedAt != null ? String(d.linkedAt) : null,
  };
}

export interface NotebookDetail {
  notebook: Notebook;
  sources: NotebookSource[];
  turns: NotebookServerTurn[];
  /** Linked LOOK photographs. Absent on an older server → `[]`, never a
   *  fabricated row; the Photos group simply doesn't render. */
  photos: NotebookPhoto[];
}

export async function getNotebookDetail(id: string): Promise<NotebookDetail> {
  const r = await request(`/api/equipment-notebooks/${encodeURIComponent(id)}/`);
  const d = r.data as {
    notebook: Record<string, unknown>;
    sources?: Record<string, unknown>[];
    turns?: NotebookServerTurn[];
    photos?: Record<string, unknown>[];
  };
  return {
    notebook: toNotebook(d.notebook),
    sources: (d.sources ?? []).map(toNotebookSource),
    turns: d.turns ?? [],
    // A photo row with no file id cannot be shown or opened, so it is dropped
    // rather than rendered as an untappable placeholder.
    photos: (d.photos ?? []).map(toNotebookPhoto).filter((p) => p.fileId !== ""),
  };
}

/** Attach an existing workspace document as a notebook source.
 *  `sourceRole` defaults to "manual" ONLY when the caller says nothing —
 *  a photo/drawing/note caller must pass its own role rather than inherit a
 *  lie about what the document is. */
export async function attachSource(
  notebookId: string,
  docId: string,
  opts: { sourceRole?: SourceRole; matchState?: MatchState } = {},
): Promise<void> {
  const body: Record<string, unknown> = {
    docId,
    sourceRole: opts.sourceRole ?? "manual",
  };
  if (opts.matchState) body.matchState = opts.matchState;
  await request(`/api/equipment-notebooks/${encodeURIComponent(notebookId)}/sources/`, {
    method: "POST",
    json: body,
  });
}

export async function setSourceEnabled(
  notebookId: string,
  docId: string,
  enabled: boolean,
): Promise<void> {
  await request(
    `/api/equipment-notebooks/${encodeURIComponent(notebookId)}/sources/${encodeURIComponent(docId)}/`,
    { method: "PATCH", json: { enabledByDefault: enabled } },
  );
}

export async function deleteNotebook(notebookId: string): Promise<void> {
  // Trailing slash matches every other notebook call: the Hub 308-redirects
  // slashless paths, and a 308 on a DELETE is not replayed with the method
  // intact by every client stack -- so the slash is load-bearing, not style.
  await request(`/api/equipment-notebooks/${encodeURIComponent(notebookId)}/`, {
    method: "DELETE",
  });
}

export async function detachSource(notebookId: string, docId: string): Promise<void> {
  await request(
    `/api/equipment-notebooks/${encodeURIComponent(notebookId)}/sources/${encodeURIComponent(docId)}/`,
    { method: "DELETE" },
  );
}

/** Workspace document (the "attach without re-upload" picker; Drive analog). */
export interface WorkspaceDoc {
  docId: string;
  filename: string | null;
  pages: number | null;
}

export async function listWorkspaceDocs(): Promise<WorkspaceDoc[]> {
  const r = await request("/api/documents/");
  const d = r.data as { documents?: Record<string, unknown>[] } | null;
  return (d?.documents ?? [])
    .filter((row) => row.doc_id)
    .map((row) => ({
      docId: String(row.doc_id),
      filename: (row.filename as string) ?? null,
      pages: row.pages != null ? Number(row.pages) : null,
    }));
}

export interface UploadResult {
  attached: boolean;
  duplicate: boolean;
  warning: string | null;
}

/** Upload a PDF into the notebook's node, then attach it as a source (the
 *  Hub's proven two-step). Honest failure: an un-indexable file reports its
 *  warning instead of silently "succeeding". */
export async function uploadSourceToNotebook(
  notebook: Pick<Notebook, "id" | "nodeId">,
  file: File,
  opts: { sourceRole?: SourceRole } = {},
): Promise<UploadResult> {
  const fd = new FormData();
  fd.append("file", file);
  const up = await uploadMultipart(
    `/api/namespace/node/${encodeURIComponent(notebook.nodeId)}/files/`,
    fd,
  );
  const d = up.data as {
    indexed?: boolean;
    uploadId?: string;
    duplicate?: boolean;
    warning?: string;
  } | null;
  if (!d?.indexed || !d.uploadId) {
    return {
      attached: false,
      duplicate: Boolean(d?.duplicate),
      warning: d?.warning ?? "Saved, but this file couldn't be indexed for chat.",
    };
  }
  await attachSource(notebook.id, d.uploadId, { sourceRole: opts.sourceRole });
  return { attached: true, duplicate: Boolean(d.duplicate), warning: null };
}

// --- workspace files (the Files API: one file, many filing locations) -------

export type FileCapability = "indexable" | "viewable" | "stored";

export interface WorkspaceFile {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  capability: FileCapability;
  /** Chat-searchable RIGHT NOW (indexable + processing finished). */
  indexed: boolean;
  verified: boolean;
  linkCount: number;
  createdAt: string | null;
}

export interface FileLink {
  id: string;
  targetType: string; // asset | notebook | location | work_order | …
  targetId: string;
  role: string | null;
  displayLabel: string | null;
  isPrimary: boolean;
  createdAt: string | null;
}

/** Technician-facing truth about what a file can do. Never promises search on
 *  a file the pipeline cannot read. */
export function fileCapabilityLabel(capability: string): string {
  switch (capability) {
    case "indexable":
      return "Searchable source";
    case "viewable":
      return "Viewable attachment";
    default:
      return "Stored file—not searchable in chat";
  }
}

function toWorkspaceFile(d: Record<string, unknown>): WorkspaceFile {
  const cap = String(d.capability ?? "stored");
  return {
    id: String(d.id ?? ""),
    filename: String(d.filename ?? "untitled"),
    mimeType: String(d.mimeType ?? "application/octet-stream"),
    sizeBytes: Number(d.sizeBytes ?? 0),
    capability: (cap === "indexable" || cap === "viewable" ? cap : "stored") as FileCapability,
    indexed: d.indexed === true,
    verified: d.verified === true,
    linkCount: Number(d.linkCount ?? 0),
    createdAt: (d.createdAt as string) ?? null,
  };
}

function toFileLink(d: Record<string, unknown>): FileLink {
  return {
    id: String(d.id ?? d.linkId ?? ""),
    targetType: String(d.targetType ?? ""),
    targetId: String(d.targetId ?? ""),
    role: d.role != null ? String(d.role) : null,
    displayLabel: d.displayLabel != null ? String(d.displayLabel) : null,
    isPrimary: d.isPrimary === true,
    createdAt: (d.createdAt as string) ?? null,
  };
}

export interface ListFilesQuery {
  q?: string;
  capability?: FileCapability;
  unfiled?: boolean;
  limit?: number;
  offset?: number;
}

/** NOTE: there is deliberately NO target filter here. To list the files filed
 *  under one destination use the per-target door (e.g. `listAssetDocuments`) —
 *  filtering this workspace-wide list client-side would show unattached files
 *  as if they were attached. */
export async function listFiles(query: ListFilesQuery = {}): Promise<WorkspaceFile[]> {
  const p = new URLSearchParams();
  if (query.q) p.set("q", query.q);
  if (query.capability) p.set("capability", query.capability);
  // The server compares against the literal "true" — "1" silently no-ops.
  if (query.unfiled) p.set("unfiled", "true");
  if (query.limit != null) p.set("limit", String(query.limit));
  if (query.offset != null) p.set("offset", String(query.offset));
  const qs = p.toString();
  const r = await request(`/api/files/${qs ? `?${qs}` : ""}`);
  const d = r.data as { files?: Record<string, unknown>[] } | null;
  return (d?.files ?? []).map(toWorkspaceFile);
}

export async function getFile(
  fileId: string,
): Promise<{ file: WorkspaceFile; links: FileLink[] }> {
  const r = await request(`/api/files/${encodeURIComponent(fileId)}/`);
  const d = r.data as { file: Record<string, unknown>; links?: Record<string, unknown>[] };
  return { file: toWorkspaceFile(d.file), links: (d.links ?? []).map(toFileLink) };
}

export interface AttachTargetInput {
  targetType: string;
  targetId: string;
  role?: string;
  displayLabel?: string;
  isPrimary?: boolean;
  matchState?: MatchState;
}

/** Attach one file to N destinations. The server contract is IDEMPOTENT and a
 *  phone WILL retry, so the key rides along and `request()` may safely replay
 *  it — a double tap can never create duplicate links. */
export async function attachFileToTargets(
  fileId: string,
  targets: AttachTargetInput[],
  idempotencyKey: string,
): Promise<{ linkId: string; targetType: string; targetId: string }[]> {
  const r = await request(`/api/files/${encodeURIComponent(fileId)}/links/`, {
    method: "POST",
    json: { targets, clientKey: idempotencyKey },
    idempotencyKey,
  });
  const d = r.data as { links?: { linkId: string; targetType: string; targetId: string }[] } | null;
  return d?.links ?? [];
}

/** Upload a NEW file straight to one or more destinations via the
 *  target-agnostic door (POST /api/files/). The node door is namespace-scoped,
 *  so this is the only way to add a file from an asset or work order. The
 *  server parks the bytes before it does anything else, so a failure here still
 *  leaves the file in the workspace — never report "not saved" on a non-2xx
 *  without saying the file may already be filed. */
export async function uploadFileToTargets(
  file: File,
  targets: AttachTargetInput[],
): Promise<{ fileId: string | null; indexed: boolean; duplicate: boolean; warning: string | null }> {
  const fd = new FormData();
  fd.append("file", file);
  if (targets.length > 0) fd.append("targets", JSON.stringify(targets));
  const r = await uploadMultipart("/api/files/", fd);
  const d = r.data as {
    fileId?: string;
    indexed?: boolean;
    duplicate?: boolean;
    warning?: string;
  } | null;
  return {
    fileId: d?.fileId ?? null,
    indexed: d?.indexed === true,
    duplicate: d?.duplicate === true,
    warning: d?.warning ?? null,
  };
}

/** Remove ONE filing location. The file itself is untouched — this is not a
 *  delete and must never be labelled as one. */
export async function detachFileLink(fileId: string, linkId: string): Promise<void> {
  await request(
    `/api/files/${encodeURIComponent(fileId)}/links/${encodeURIComponent(linkId)}/`,
    { method: "DELETE" },
  );
}

/** Change where a file is filed: add destinations and/or drop existing links
 *  in ONE server-side transaction, so the file is never briefly unfiled. */
export async function relocateFile(
  fileId: string,
  change: { add?: AttachTargetInput[]; removeLinkIds?: string[] },
  idempotencyKey: string,
): Promise<{ links: FileLink[]; removed: number }> {
  const r = await request(`/api/files/${encodeURIComponent(fileId)}/relocate/`, {
    method: "POST",
    json: {
      add: change.add ?? [],
      removeLinkIds: change.removeLinkIds ?? [],
      clientKey: idempotencyKey,
    },
    idempotencyKey,
  });
  const d = r.data as { links?: Record<string, unknown>[]; removed?: number } | null;
  return { links: (d?.links ?? []).map(toFileLink), removed: Number(d?.removed ?? 0) };
}

/** Destructive. 409 `has_links` / `verified_retained` come back as an ApiError
 *  of kind "client" whose `detail` carries the reason token — callers surface
 *  the server's reason rather than inventing one. */
export async function deleteFile(fileId: string): Promise<void> {
  await request(`/api/files/${encodeURIComponent(fileId)}/`, { method: "DELETE" });
}

// --- per-asset documents (the asset Files card) -----------------------------

/** A file EXPLICITLY attached to this asset. `docId`/`indexed` decide whether
 *  chat can cite it; `linkId` is what a detach needs. */
export interface AssetAttachedDoc {
  fileId: string;
  linkId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  capability: FileCapability;
  indexed: boolean;
  verified: boolean;
  docId: string | null;
  role: string | null;
  displayLabel: string | null;
  isPrimary: boolean;
  attachedAt: string | null;
}

/** A manual MATCHED on the asset's manufacturer/model. NOT attached — it is a
 *  suggestion from the shared corpus and is rendered as such. */
export interface AssetSuggestedDoc {
  sourceUrl: string | null;
  title: string;
  modelNumber: string | null;
  equipmentType: string | null;
  chunkCount: number;
  verified: boolean;
  lastIndexed: string | null;
}

/** The server keeps these two lists SEPARATE, and so does the UI. */
export async function listAssetDocuments(
  assetId: string,
): Promise<{ attached: AssetAttachedDoc[]; suggested: AssetSuggestedDoc[] }> {
  const r = await request(`/api/assets/${encodeURIComponent(assetId)}/documents/`);
  const d = r.data as {
    attached?: Record<string, unknown>[];
    suggested?: Record<string, unknown>[];
  } | null;
  return {
    attached: (d?.attached ?? []).map((a) => {
      const cap = String(a.capability ?? "stored");
      return {
        fileId: String(a.fileId ?? ""),
        linkId: String(a.linkId ?? ""),
        filename: String(a.filename ?? "untitled"),
        mimeType: String(a.mimeType ?? "application/octet-stream"),
        sizeBytes: Number(a.sizeBytes ?? 0),
        capability: (cap === "indexable" || cap === "viewable" ? cap : "stored") as FileCapability,
        indexed: a.indexed === true,
        verified: a.verified === true,
        docId: a.docId != null ? String(a.docId) : null,
        role: a.role != null ? String(a.role) : null,
        displayLabel: a.displayLabel != null ? String(a.displayLabel) : null,
        isPrimary: a.isPrimary === true,
        attachedAt: (a.attachedAt as string) ?? null,
      };
    }),
    suggested: (d?.suggested ?? []).map((s) => ({
      sourceUrl: s.sourceUrl != null ? String(s.sourceUrl) : null,
      title: String(s.title ?? "Untitled document"),
      modelNumber: s.modelNumber != null ? String(s.modelNumber) : null,
      equipmentType: s.equipmentType != null ? String(s.equipmentType) : null,
      chunkCount: Number(s.chunkCount ?? 0),
      verified: s.verified === true,
      lastIndexed: (s.lastIndexed as string) ?? null,
    })),
  };
}

/** The authenticated original-bytes path for a workspace file. */
export function fileBytesPath(fileId: string): string {
  return `/api/namespace/files/${encodeURIComponent(fileId)}/`;
}

// --- component nameplate (notebook-scoped) ----------------------------------

export interface ComponentIdentity {
  manufacturer: string;
  model: string;
  catalogNumber: string;
  serialNumber: string;
  equipmentType: string;
  voltage: string;
  fullLoadAmps: string;
  horsepower: string;
  frequency: string;
  rpm: string;
}

export const EMPTY_COMPONENT_IDENTITY: ComponentIdentity = {
  manufacturer: "",
  model: "",
  catalogNumber: "",
  serialNumber: "",
  equipmentType: "",
  voltage: "",
  fullLoadAmps: "",
  horsepower: "",
  frequency: "",
  rpm: "",
};

export interface RecognizeComponentResult {
  fileId: string;
  candidate: Partial<ComponentIdentity>;
  /** Provider lineage object ({provider, filename, mimeType, rawText}) —
   *  opaque here, echoed back to confirm untouched. NOT a string. */
  rawObservation: unknown;
  confidence: number | null;
  attachment: { linkId: string; notebookId: string } | null;
}

/** Nameplate photo of a COMPONENT inside this notebook's machine. The photo is
 *  retained as a workspace file and linked to the notebook by the server; the
 *  reading is a CANDIDATE the technician edits. */
export async function recognizeComponentNameplate(
  notebookId: string,
  image: File,
): Promise<RecognizeComponentResult> {
  const fd = new FormData();
  fd.append("image", image);
  const r = await uploadMultipart(
    `/api/equipment-notebooks/${encodeURIComponent(notebookId)}/nameplate/recognize/`,
    fd,
  );
  const d = (r.data ?? {}) as Record<string, unknown>;
  const att = d.attachment as Record<string, unknown> | undefined;
  return {
    fileId: String(d.fileId ?? ""),
    candidate: (d.candidate as Partial<ComponentIdentity>) ?? {},
    rawObservation: d.rawObservation ?? null,
    confidence: typeof d.confidence === "number" ? d.confidence : null,
    attachment: att
      ? { linkId: String(att.linkId ?? ""), notebookId: String(att.notebookId ?? "") }
      : null,
  };
}

// --- Sensor LOOK (notebook-scoped; contract §4.1) ---------------------------

export interface LookObservation {
  /** What the vision pass SAW — observations only, never a diagnosis. */
  text: string;
  capturedAt: string;
  provenance: string; // "phone_photo"
}

export interface LookResult {
  /** The parked photograph — retained and linked to the notebook (role
   *  "photo") BEFORE vision runs, so it exists even when the provider fails. */
  fileId: string;
  attachment: { linkId: string; notebookId: string } | null;
  /** Null when the provider failed: the file is kept, the observation is not
   *  invented. */
  observation: LookObservation | null;
  /** Server reason when `observation` is null (`provider_error` /
   *  `recognizer_not_configured`), else null. */
  reason: string | null;
  /** The server's technician-facing sentence for that reason, else null. */
  message: string | null;
  /** Opaque capture-quality assessment (blur/glare hint) — preserved verbatim. */
  quality: unknown | null;
}

/**
 * LOOK: photograph → parked once (SHA-256 dedup on the server; `clientKey`
 * makes a retry replay the same link instead of filing a second one) →
 * observation text. Same multipart seam as `recognizeComponentNameplate`.
 * The observation is conversation context only — it becomes a citable source
 * solely through the existing confirmation doors (§4.1), never from here.
 */
export async function lookAtPhoto(
  notebookId: string,
  image: File,
  clientKey: string,
  question?: string | null,
): Promise<LookResult> {
  const fd = new FormData();
  fd.append("image", image);
  fd.append("clientKey", clientKey);
  if (question?.trim()) fd.append("question", question.trim());
  // §4.1: the server parks + links the photo BEFORE vision, and a provider
  // failure (502) or an unconfigured recognizer (503) still returns that
  // parked file with `observation: null`. Those bodies are answers — the
  // evidence card renders from them; anything else (or a 5xx without a
  // file) is the same typed error as before.
  const r = await uploadMultipart(
    `/api/equipment-notebooks/${encodeURIComponent(notebookId)}/look/`,
    fd,
    { acceptStatuses: [502, 503] },
  );
  const d = (r.data ?? {}) as Record<string, unknown>;
  if (r.status >= 400 && !d.fileId) throw errorFromStatus(r.status, d);
  const att = d.attachment as Record<string, unknown> | undefined;
  const obs = d.observation as Record<string, unknown> | null | undefined;
  return {
    fileId: String(d.fileId ?? ""),
    attachment: att
      ? { linkId: String(att.linkId ?? ""), notebookId: String(att.notebookId ?? "") }
      : null,
    observation:
      obs && typeof obs.text === "string" && obs.text.trim()
        ? {
            text: obs.text,
            capturedAt: String(obs.capturedAt ?? new Date().toISOString()),
            provenance: String(obs.provenance ?? "phone_photo"),
          }
        : null,
    quality: d.quality ?? null,
    reason: typeof d.reason === "string" ? d.reason : null,
    message: typeof d.message === "string" ? d.message : null,
  };
}

export type ConfirmComponentStatus =
  | "complete"
  | "candidate_review"
  | "no_manual_found"
  | "search_unavailable"
  | "no_extractable_text"
  | "manufacturer_model_required"
  | "download_rejected";

/** What the server actually returns about the discovered manual. `docId` +
 *  `indexed` are the ONLY proof that a citable source row exists — a fileId
 *  alone means the bytes were kept, not that chat can use them. */
export interface ConfirmedManual {
  fileId: string | null;
  docId: string | null;
  filename: string | null;
  matchState: string | null;
  enabledByDefault: boolean;
  indexed: boolean;
  chunkCount: number;
  discoveryUrl: string | null;
  finalUrl: string | null;
}

/** The search hit, before any of it is believed. */
export interface ManualCandidateView {
  url: string | null;
  title: string | null;
  host: string | null;
  validated: boolean;
  oemHost: boolean;
}

export interface ConfirmComponentResult {
  status: ConfirmComponentStatus;
  manual: ConfirmedManual | null;
  candidate: ManualCandidateView | null;
  /** The applicability verdict — why the server did or didn't trust it. */
  applicability: unknown | null;
  message: string | null;
  warning: string | null;
  /** On candidate_review: what discovery learned by READING the file
   *  ("Read the PDF: a lever-hoist brochure, no end-truck model"). */
  discoveryReason?: string | null;
  /** The manufacturer's own manual-request page (validated by the server). */
  oemRequestUrl?: string | null;
}

/** TRUE only when the server's own payload proves a citable notebook source
 *  exists: an indexed document whose match state is trusted. This is the gate
 *  between "we kept the file" and "the manual was added". */
export function confirmYieldedCitableSource(r: ConfirmComponentResult): boolean {
  const m = r.manual;
  if (!m || !m.docId || !m.indexed) return false;
  return m.matchState === "verified" || m.matchState === "user_confirmed";
}

export interface ConfirmComponentBody {
  fileId: string;
  identity: ComponentIdentity;
  /** Opaque provider observation from `recognize` — an OBJECT, not a string.
   *  Passed back verbatim so the server keeps its own lineage. */
  rawObservation?: unknown;
  confidence?: number | null;
  /** Ask the server to go find the official manual for this component. */
  discover?: boolean;
}

/** Confirm the COMPONENT identity read from the nameplate. This never touches
 *  the parent notebook's identity — a component inside the machine is not the
 *  machine (a contactor photo must not rename a PowerFlex notebook). */
export async function confirmComponentNameplate(
  notebookId: string,
  body: ConfirmComponentBody,
  idempotencyKey: string,
): Promise<ConfirmComponentResult> {
  const r = await request(
    `/api/equipment-notebooks/${encodeURIComponent(notebookId)}/nameplate/confirm/`,
    { method: "POST", json: { ...body, clientKey: idempotencyKey }, idempotencyKey, timeoutMs: 120_000 },
  );
  const d = (r.data ?? {}) as Record<string, unknown>;
  const m = d.manual as Record<string, unknown> | null | undefined;
  const c = d.candidate as Record<string, unknown> | null | undefined;
  return {
    status: String(d.status ?? "no_manual_found") as ConfirmComponentStatus,
    manual: m
      ? {
          fileId: m.fileId != null ? String(m.fileId) : null,
          docId: m.docId != null ? String(m.docId) : null,
          filename: m.filename != null ? String(m.filename) : null,
          matchState: m.matchState != null ? String(m.matchState) : null,
          enabledByDefault: m.enabledByDefault === true,
          indexed: m.indexed === true,
          chunkCount: Number(m.chunkCount ?? 0),
          discoveryUrl: m.discoveryUrl != null ? String(m.discoveryUrl) : null,
          finalUrl: m.finalUrl != null ? String(m.finalUrl) : null,
        }
      : null,
    candidate: c
      ? {
          url: c.url != null ? String(c.url) : null,
          title: c.title != null ? String(c.title) : null,
          host: c.host != null ? String(c.host) : null,
          validated: c.validated === true,
          oemHost: c.oemHost === true,
        }
      : null,
    applicability: d.applicability ?? null,
    message: d.message != null ? String(d.message) : null,
    warning: d.warning != null ? String(d.warning) : null,
  };
}

// --- namespace locations (filing destinations) ------------------------------

export interface LocationTarget {
  id: string;
  name: string;
  kind: string;
  unsPath: string | null;
}

interface NamespaceTreeNode {
  id: string;
  name: string;
  kind: string;
  unsPath: string | null;
  children?: NamespaceTreeNode[];
}

/** Flatten the namespace tree to the structural nodes a file can be filed
 *  under (site / area / line / cell). Assets are offered separately. */
export function flattenLocations(nodes: NamespaceTreeNode[] | undefined): LocationTarget[] {
  const out: LocationTarget[] = [];
  const walk = (n: NamespaceTreeNode) => {
    if (["site", "area", "line", "cell", "namespace"].includes(n.kind))
      out.push({ id: n.id, name: n.name, kind: n.kind, unsPath: n.unsPath ?? null });
    for (const c of n.children ?? []) walk(c);
  };
  for (const n of nodes ?? []) walk(n);
  return out;
}

export async function listLocations(): Promise<LocationTarget[]> {
  const r = await request("/api/namespace/tree/");
  const d = r.data as { tree?: NamespaceTreeNode[]; nodes?: NamespaceTreeNode[] } | NamespaceTreeNode[] | null;
  const nodes = Array.isArray(d) ? d : (d?.tree ?? d?.nodes ?? []);
  return flattenLocations(nodes);
}

export interface NameplateCandidate {
  displayName?: string;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  equipmentType?: string | null;
  confidence?: number | null;
}

/** Nameplate photo → EDITABLE candidate identity. 503 when no vision provider
 *  is configured (honest failure — surfaced to the user, never faked). */
export async function recognizeNameplate(image: File): Promise<NameplateCandidate> {
  const fd = new FormData();
  fd.append("image", image);
  const r = await uploadMultipart("/api/equipment-notebooks/recognize-nameplate/", fd);
  return ((r.data as { candidate?: NameplateCandidate } | null)?.candidate ?? {});
}

export interface SourcePassage {
  page: number | null;
  text: string;
}

/** Full cited passage for a citation chip (CIT-07 phase 2) — fetched on
 *  demand, never inlined in chat frames (payload stays small). */
export async function getSourcePassage(
  notebookId: string,
  docId: string,
  page: number | null,
): Promise<SourcePassage[]> {
  const q = page != null ? `?page=${page}` : "";
  const r = await request(
    `/api/equipment-notebooks/${encodeURIComponent(notebookId)}/sources/${encodeURIComponent(docId)}/passage/${q}`,
  );
  return ((r.data as { passages?: SourcePassage[] } | null)?.passages ?? []);
}

/** One prior exchange line, the shape the server's sanitizeHistory accepts. */
export interface ChatHistoryTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * STRM-2 stopped-turn contract (no schema change): the server persists a
 * client-stopped turn as `answer_status='error'` with `answer_text` = the
 * partial that streamed; a provider-failure turn is `'error'` with
 * `answer_text` NULL. So `error` + non-empty text IS the stopped turn.
 * One rule, applied on reload (this) and live (`status === "stopped"`).
 */
export function isStoppedTurn(t: Pick<NotebookServerTurn, "answerStatus" | "answerText">): boolean {
  return t.answerStatus === "error" && !!t.answerText?.trim();
}

/**
 * CONV-3: the recent thread, built from BOTH stores a notebook renders —
 * persisted turns (server truth, survives devices) and this session's live
 * turns — in chronological order, as role/content pairs. Same windowing the
 * web client uses (last 12 lines); the route caps it again defensively.
 * A refusal contributes its QUESTION (real context) but no fabricated answer
 * line. A STOPPED turn (see `isStoppedTurn`) contributes nothing — a stopped
 * answer is not an answer, and neither is the question that produced it,
 * identically to how a live stopped turn is filtered out. Pure and
 * unit-tested.
 */
export function buildChatHistory(
  turns: Pick<NotebookServerTurn, "question" | "answerText" | "answerStatus">[],
  liveTurns: { q: string; a: Pick<ChatTurn, "answer"> }[],
  maxLines = 12,
): ChatHistoryTurn[] {
  const out: ChatHistoryTurn[] = [];
  for (const t of turns) {
    if (isStoppedTurn(t)) continue;
    if (t.question.trim()) out.push({ role: "user", content: t.question });
    if (t.answerText?.trim()) out.push({ role: "assistant", content: t.answerText });
  }
  for (const t of liveTurns) {
    if (t.q.trim()) out.push({ role: "user", content: t.q });
    if (t.a.answer?.trim()) out.push({ role: "assistant", content: t.a.answer });
  }
  return out.slice(-maxLines);
}

/** Ask within the caller-selected source scope (per-source checkboxes). */
export async function askNotebook(
  notebookId: string,
  message: string,
  sourceDocIds: string[],
  opts: {
    /**
     * "general" asks for an explicitly ungrounded answer (spec 1.1). It is
     * sent ONLY when the technician chose it — never as an automatic
     * fallback, because silently downgrading a grounded question to general
     * reasoning is precisely the evidence-contract change 1.4 forbids.
     */
    mode?: "general";
    /** Recent thread for multi-turn memory (CONV-3) — server-sanitized. */
    history?: ChatHistoryTurn[];
    /** STRM-1: called with the turn-so-far after every completed frame, so
     *  the transcript can paint tokens as they arrive. The resolved value is
     *  the SAME object the last update produced (one parser, one truth). */
    onUpdate?: (partial: ChatTurn) => void;
    /** STRM-2: Stop. Rejects with the signal's reason (an AbortError). */
    signal?: AbortSignal;
    /** Sensor REPLAY (contract §4.4): the selected Machine Memory window.
     *  The server re-fetches the rows itself and grounds the answer on them;
     *  the client never sends rows. Absent = unchanged document path. */
    machineEvidence?: MachineEvidenceWindow;
    /** Sensor LOOK (S5 D3): which parked photo the question is about. The
     *  server verifies the file is linked to THIS notebook (and silently
     *  ignores it otherwise) and re-derives the evidence entry — the client
     *  never sends evidence rows. Absent = unchanged path. */
    visualEvidence?: VisualEvidence;
  } = {},
): Promise<ChatTurn> {
  const parser = createChatSseParser();
  const r = await requestStream(
    `/api/equipment-notebooks/${encodeURIComponent(notebookId)}/chat/`,
    {
      json: {
        message,
        sourceDocIds,
        ...(opts.mode ? { mode: opts.mode } : {}),
        ...(opts.history?.length ? { history: opts.history } : {}),
        ...(opts.machineEvidence ? { machineEvidence: opts.machineEvidence } : {}),
        ...(opts.visualEvidence ? { visualEvidence: opts.visualEvidence } : {}),
      },
      onChunk: (chunk) => {
        const before = parser.turn().answer;
        const partial = parser.push(chunk);
        if (partial.answer !== before) opts.onUpdate?.(partial);
      },
      signal: opts.signal,
      timeoutMs: 120_000,
    },
  );
  const turn = parser.finish();
  // Non-200 bodies never reach here (requestStream throws), but keep the
  // status-tagging contract of the old one-shot parse for a 2xx that isn't 200.
  if (r.status !== 200 && !turn.status) turn.status = `http ${r.status}`;
  return turn;
}

/** Pure helper (unit-tested): the doc ids chat retrieval is scoped to. */
export function enabledDocIds(sources: Pick<NotebookSource, "docId" | "enabledByDefault">[]): string[] {
  return sources.filter((s) => s.enabledByDefault !== false).map((s) => s.docId);
}

// --- Sensor REPLAY: Machine Memory history window (contract §4.3) -----------

/**
 * GET /api/assets/[id]/history?at=&pre=&post= — the fault-anchored window
 * Machine Memory actually recorded. Read-only, tenant-scoped on the server.
 * A 404 `no_fault_window` is an ANSWER (there is nothing to replay), not a
 * transport failure, so it is accepted and mapped rather than thrown. Rows are
 * passed through as the server ordered them (by event_timestamp); the client
 * adds nothing.
 */
export async function getAssetHistory(
  assetId: string,
  opts: { at?: string; pre?: number; post?: number } = {},
): Promise<HistoryResult> {
  const p = new URLSearchParams();
  if (opts.at) p.set("at", opts.at);
  if (opts.pre != null) p.set("pre", String(opts.pre));
  if (opts.post != null) p.set("post", String(opts.post));
  const qs = p.toString();
  const r = await request(
    `/api/assets/${encodeURIComponent(assetId)}/history/${qs ? `?${qs}` : ""}`,
    { acceptStatuses: [404] },
  );
  const d = (r.data ?? {}) as Record<string, unknown>;
  if (r.status === 404) {
    // Only the server's OWN discriminators are answers about the machine. A
    // bare 404 (route missing, asset not in this tenant, bad id) is a
    // transport/route failure and must never read as "no fault window
    // recorded" (§2.8 honesty).
    const error = typeof d.error === "string" ? d.error : "";
    if (error === "no_uns_path") return { ok: false, reason: "no_uns_path" };
    if (error === "no_fault_window") {
      // Hub shape: `latestWindow: {state, started_at, ended_at}` +
      // `windowsAvailable`; `latest.at` tolerated for older bodies.
      const latest = (d.latestWindow ?? d.latest) as Record<string, unknown> | null | undefined;
      return {
        ok: false,
        reason: "no_fault_window",
        windowsAvailable: d.windowsAvailable !== false,
        latest:
          latest && latest.state
            ? { state: String(latest.state), at: String(latest.started_at ?? latest.at ?? "") }
            : null,
      };
    }
    throw errorFromStatus(404, d);
  }
  const anchor = (d.anchor ?? {}) as Record<string, unknown>;
  const w = (d.window ?? {}) as Record<string, unknown>;
  const anchorAt = String(anchor.at ?? "");
  const freshness = (d.freshness ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(d.rows) ? (d.rows as Record<string, unknown>[]) : [];
  const overall = String(freshness.overall ?? "unknown");
  const history: AssetHistory = {
    anchor: {
      at: anchorAt,
      source: anchor.source === "explicit" ? "explicit" : "state_window",
      windowId: anchor.windowId != null ? String(anchor.windowId) : null,
      runId: anchor.runId != null ? String(anchor.runId) : null,
    },
    rows: rows.map((row) => ({
      event_timestamp: String(row.event_timestamp ?? ""),
      ingested_at: String(row.ingested_at ?? ""),
      uns_path: String(row.uns_path ?? ""),
      tag: String(row.tag ?? ""),
      value: (row.value as AssetHistory["rows"][number]["value"]) ?? null,
      prev_value: (row.prev_value as AssetHistory["rows"][number]["prev_value"]) ?? null,
      quality: row.quality != null ? String(row.quality) : null,
      kind: row.kind === "diff" ? "diff" : "event",
    })),
    freshness: {
      overall:
        overall === "live" || overall === "stale" || overall === "simulated" ? overall : "unknown",
      live: Number(freshness.live ?? 0),
      stale: Number(freshness.stale ?? 0),
      simulated: Number(freshness.simulated ?? 0),
      unknown: Number(freshness.unknown ?? 0),
    },
    summary: (d.summary ?? {}) as AssetHistory["summary"],
    provenance: "machine_memory",
    reason: d.reason === "unavailable" ? "unavailable" : null,
    // Workstream C: the server's own coverage facts (null on an older Hub —
    // the lib derives them from rows + reason, never from freshness).
    coverage: coverageFrom(d.coverage),
    // The window the SERVER fetched, which is nested (`historyResponseBody`
    // emits `window:{from,to,pre,post}`), NOT the one we asked for. The server
    // clamps to the §4.3 120 s cap, so echoing the request would misname the
    // timeline header AND the window handed to Ask MIRA. Absolute bounds are
    // the fallback when only `from`/`to` are named; the request is the last
    // resort, and is the only case where these numbers are ours, not the
    // server's.
    pre: windowSeconds(w.pre, anchorAt, w.from, -1) ?? Number(d.pre ?? opts.pre ?? 5),
    post: windowSeconds(w.post, anchorAt, w.to, 1) ?? Number(d.post ?? opts.post ?? 2),
    from: w.from != null ? String(w.from) : null,
    to: w.to != null ? String(w.to) : null,
  };
  return { ok: true, history };
}

/** The Hub's HistoryCoverage, taken verbatim when present and well-formed. */
function coverageFrom(raw: unknown): AssetHistory["coverage"] {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.recorded !== "number" || typeof c.admissible !== "boolean") return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    recorded: c.recorded,
    events: num(c.events) ?? undefined,
    diffs: num(c.diffs) ?? undefined,
    historyAvailable: c.historyAvailable !== false,
    diffsAvailable: typeof c.diffsAvailable === "boolean" ? c.diffsAvailable : undefined,
    admissible: c.admissible,
    from: str(c.from),
    to: str(c.to),
    earliest: str(c.earliest),
    latest: str(c.latest),
    ingestLagMaxMs: num(c.ingestLagMaxMs),
  };
}

/** One bound of the fetched window, in seconds: the server's own `pre`/`post`
 *  when it names them, else derived from the absolute bound it did name
 *  (`sign` = -1 for `from`, +1 for `to`). Returns null when neither is
 *  available — the caller then falls back to the request, which is the only
 *  honest thing left to show. */
function windowSeconds(
  seconds: unknown,
  anchorAt: string,
  bound: unknown,
  sign: 1 | -1,
): number | null {
  if (typeof seconds === "number" && Number.isFinite(seconds)) return seconds;
  if (typeof bound !== "string") return null;
  const a = new Date(anchorAt).getTime();
  const b = new Date(bound).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((sign * (b - a)) / 1000);
}

// --- More tab ---------------------------------------------------------------

export interface TeamMember {
  email: string;
  role: string;
  status: string;
}

export async function listTeam(): Promise<TeamMember[]> {
  // The Hub returns a BARE ARRAY here (punch list TEAM-08) — accept both.
  const r = await request("/api/team/");
  const d = r.data as Record<string, unknown>[] | { members?: Record<string, unknown>[] } | null;
  const rows = Array.isArray(d) ? d : (d?.members ?? []);
  return rows.map((m) => ({
    email: String(m.email ?? ""),
    role: String(m.role ?? ""),
    status: String(m.status ?? ""),
  }));
}

export async function getUsage(): Promise<Record<string, unknown> | null> {
  const r = await request("/api/usage/");
  return (r.data as Record<string, unknown> | null) ?? null;
}
