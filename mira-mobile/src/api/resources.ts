// Shared mobile data layer — typed resource half. Every screen consumes these;
// no screen builds its own requests. All paths trailing-slash (Hub canonical).

import {
  request,
  uploadMultipart,
  withAuthEventsSuppressed,
  clearAllLocalState,
} from "./client";
import { parseChatSse, type ChatTurn } from "../lib/sse";

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

// --- assets -----------------------------------------------------------------

export interface Asset {
  id: string;
  name: string;
  equipment_type?: string | null;
  manufacturer?: string | null;
  model_number?: string | null;
  equipment_number?: string | null;
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

// --- equipment notebooks (NotebookLM-style workspaces; build spec §3–6) -----

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
}

function toNotebook(d: Record<string, unknown>): Notebook {
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
  };
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

export interface NotebookSource {
  docId: string;
  filename: string | null;
  status: string | null;
  enabledByDefault: boolean;
  matchState: string;
  pages: number | null;
}

export interface NotebookServerTurn {
  id: string;
  question: string;
  answerStatus: string;
  answerText: string | null;
}

export interface NotebookDetail {
  notebook: Notebook;
  sources: NotebookSource[];
  turns: NotebookServerTurn[];
}

export async function getNotebookDetail(id: string): Promise<NotebookDetail> {
  const r = await request(`/api/equipment-notebooks/${encodeURIComponent(id)}/`);
  const d = r.data as {
    notebook: Record<string, unknown>;
    sources?: NotebookSource[];
    turns?: NotebookServerTurn[];
  };
  return { notebook: toNotebook(d.notebook), sources: d.sources ?? [], turns: d.turns ?? [] };
}

export async function attachSource(notebookId: string, docId: string): Promise<void> {
  await request(`/api/equipment-notebooks/${encodeURIComponent(notebookId)}/sources/`, {
    method: "POST",
    json: { docId, sourceRole: "manual" },
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
  await attachSource(notebook.id, d.uploadId);
  return { attached: true, duplicate: Boolean(d.duplicate), warning: null };
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

/** Ask within the caller-selected source scope (per-source checkboxes). */
export async function askNotebook(
  notebookId: string,
  message: string,
  sourceDocIds: string[],
): Promise<ChatTurn> {
  const r = await request(
    `/api/equipment-notebooks/${encodeURIComponent(notebookId)}/chat/`,
    { method: "POST", json: { message, sourceDocIds }, timeoutMs: 120_000 },
  );
  return parseChatSse(r.text, r.status);
}

/** Pure helper (unit-tested): the doc ids chat retrieval is scoped to. */
export function enabledDocIds(sources: Pick<NotebookSource, "docId" | "enabledByDefault">[]): string[] {
  return sources.filter((s) => s.enabledByDefault !== false).map((s) => s.docId);
}

// --- More tab ---------------------------------------------------------------

export interface TeamMember {
  email: string;
  role: string;
  status: string;
}

export async function listTeam(): Promise<TeamMember[]> {
  const r = await request("/api/team/");
  const d = r.data as { members?: Record<string, unknown>[] } | null;
  return (d?.members ?? []).map((m) => ({
    email: String(m.email ?? ""),
    role: String(m.role ?? ""),
    status: String(m.status ?? ""),
  }));
}

export async function getUsage(): Promise<Record<string, unknown> | null> {
  const r = await request("/api/usage/");
  return (r.data as Record<string, unknown> | null) ?? null;
}
