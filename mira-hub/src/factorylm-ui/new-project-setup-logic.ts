/**
 * New project setup (#4632): the pure logic behind the one sheet that replaces
 * `window.prompt`. No React here. The sheet (NewProjectSetup.tsx) is a thin
 * adapter over `createNewProjectSetup`, and every network call goes through an
 * injected `fetch`, so the write plan, the duplicate refusal and the readiness
 * mapping are testable without a DOM.
 *
 * Writes happen only in `commit()`. Opening, choosing, going back and cancelling
 * issue GETs at most.
 */
import { MAX_UPLOAD_MB } from "@/lib/config";
import type { ReadinessState } from "@/lib/document-readiness";
import type { HubNotebook } from "./notebook-tree";
import { listNotice, partitionMachines, type ListNotice, type Machine } from "./ScopePicker";

// ---------- readiness and applicability (pure, fail closed) ----------

export type ReadinessTone = "ready" | "processing" | "attention";
export type ReadinessView = { tone: ReadinessTone; label: string };

const ATTENTION: ReadinessView = { tone: "attention", label: "Needs attention" };
const READY: ReadinessView = { tone: "ready", label: "Ready to search" };
const PROCESSING: ReadinessView = { tone: "processing", label: "Processing" };
const UPLOADING: ReadinessView = { tone: "processing", label: "Uploading" };

/** Exhaustive over ReadinessState: a new state is a compile error here. */
const READINESS_VIEW = {
  uploading: UPLOADING,
  stored: PROCESSING,
  chat_ready_basic: READY,
  enhancing: READY,
  chat_ready_enhanced: READY,
  enhancement_degraded: READY,
  needs_ocr: ATTENTION,
  failed: ATTENTION,
} satisfies Record<ReadinessState, ReadinessView>;

/** Anything that is not a known state (null, garbage, a missing field) is Needs attention. */
export function readinessView(readiness: unknown): ReadinessView {
  const state = typeof readiness === "object" && readiness !== null
    ? (readiness as { state?: unknown }).state
    : undefined;
  if (typeof state === "string" && Object.prototype.hasOwnProperty.call(READINESS_VIEW, state)) {
    return READINESS_VIEW[state as ReadinessState];
  }
  return ATTENTION;
}

/** Applicability is its own line, never folded into readiness. */
export function applicabilityLine(matchState: unknown): string {
  switch (matchState) {
    case "verified": return "Verified for this machine";
    case "user_confirmed": return "Added by you, not verified for this model";
    case "candidate": return "Suggested, not approved";
    case "rejected": return "Rejected, not used";
    default: return "Applicability unknown";
  }
}

// ---------- machines (same walk as NotebookMachineBinding) ----------

/** Walks the namespace tree; keeps asset/equipment nodes with their parent chain. Throws on a malformed payload. */
export function machinesFromTree(body: unknown): { machines: Machine[]; malformed: number; unplaced: number } {
  const nodes = (body as { nodes?: unknown } | null)?.nodes;
  if (!Array.isArray(nodes)) throw new Error("machine_list_unreadable");
  const rows: unknown[] = [];
  const pending: Array<{ node: unknown; parents: string[] }> = nodes.map((node: unknown) => ({ node, parents: [] }));
  let visited = 0;
  while (pending.length) {
    if (++visited > 10_000) throw new Error("machine_list_too_large");
    const entry = pending.pop()!;
    if (!entry.node || typeof entry.node !== "object") throw new Error("machine_list_unreadable");
    const node = entry.node as { id?: unknown; name?: unknown; kind?: unknown; unsPath?: unknown; children?: unknown };
    if (typeof node.kind !== "string" || typeof node.name !== "string") throw new Error("machine_list_unreadable");
    if (node.kind === "asset" || node.kind === "equipment") {
      rows.push({ id: node.id, name: node.name, tag: node.name, unsPath: node.unsPath, location: entry.parents.join(" / ") || null });
    }
    if (node.children !== undefined && !Array.isArray(node.children)) throw new Error("machine_list_unreadable");
    for (const child of (node.children ?? []) as unknown[]) pending.push({ node: child, parents: [...entry.parents, node.name] });
  }
  const result = partitionMachines(rows);
  if (listNotice({ failed: false, machines: result.machines, malformed: result.malformed, shown: result.machines.length }) === "unreadable") {
    throw new Error("machine_list_unreadable");
  }
  return result;
}

export { listNotice, type ListNotice, type Machine };

/**
 * The duplicate pre-check. The tree node id is the kg_entities id while the
 * notebook's asset.entityId is coalesce(entity_id, id), so this can miss a
 * bridged row. The server's refusal (created:false / asset_already_bound) is the
 * final authority.
 */
export function findExistingProject(machineId: string, notebooks: readonly HubNotebook[]): HubNotebook | null {
  return notebooks.find((nb) => nb.asset?.entityId === machineId) ?? null;
}

// ---------- documents ----------

export type WorkspaceDoc = { fileId: string; docId: string | null; filename: string };
export type LinkedDoc = { key: string; docId: string | null; filename: string; reason: string | null };

export function workspaceDocsFrom(body: unknown): WorkspaceDoc[] {
  const files = (body as { files?: unknown } | null)?.files;
  if (!Array.isArray(files)) return [];
  const out: WorkspaceDoc[] = [];
  for (const raw of files) {
    const f = (raw ?? {}) as { id?: unknown; filename?: unknown; uploadId?: unknown };
    if (typeof f.id !== "string") continue;
    out.push({
      fileId: f.id,
      docId: typeof f.uploadId === "string" && f.uploadId ? f.uploadId : null,
      filename: typeof f.filename === "string" && f.filename ? f.filename : "Untitled document",
    });
  }
  return out;
}

/**
 * Manuals already linked to the machine (GET /api/namespace/node/{id}/files/).
 * That GET strips `upload_id` from direct rows, so the docId comes from either
 * the row itself (source "upload": its id IS the hub_uploads id) or the
 * workspace list (direct row, matched by file id). An indexed row that resolves
 * to no docId is shown disabled, never attached with a guessed id.
 */
export function linkedDocsFrom(body: unknown, workspace: readonly WorkspaceDoc[]): LinkedDoc[] {
  const files = (body as { files?: unknown } | null)?.files;
  if (!Array.isArray(files)) return [];
  const out: LinkedDoc[] = [];
  for (const raw of files) {
    const f = (raw ?? {}) as { id?: unknown; filename?: unknown; source?: unknown; indexed?: unknown };
    if (typeof f.id !== "string") continue;
    const filename = typeof f.filename === "string" && f.filename ? f.filename : "Untitled document";
    if (f.indexed !== true) {
      out.push({ key: `file:${f.id}`, docId: null, filename, reason: "Not searchable yet" });
      continue;
    }
    const docId = f.source === "upload" ? f.id : (workspace.find((w) => w.fileId === f.id)?.docId ?? null);
    out.push({
      key: docId ?? `file:${f.id}`,
      docId,
      filename,
      reason: docId ? null : "Not attachable from here. Add it from Workspace documents.",
    });
  }
  return out;
}

// ---------- write plan ----------

export type Selection = { kind: "general" } | { kind: "machine"; machine: Machine };
export type CommitDoc = { docId: string; filename: string };
export type HttpResult = { status: number; ok: boolean; body: Record<string, unknown> };

export type SetupDeps = {
  fetch: typeof fetch;
  apiBase: string;
  /** The host's createNotebook (POST /api/equipment-notebooks/); resolves to the new id, or null on 401. */
  createNotebook: (body: { displayName: string; identitySourceType: "user" }) => Promise<string | null>;
  sleep: (ms: number) => Promise<void>;
};

export async function call(deps: SetupDeps, method: string, path: string, opts: { json?: unknown; form?: FormData } = {}): Promise<HttpResult> {
  const init: RequestInit = { method, credentials: "include", cache: "no-store" };
  if (opts.form) init.body = opts.form;
  else if (opts.json !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(opts.json);
  }
  try {
    const res = await deps.fetch(`${deps.apiBase}${path}`, init);
    let body: Record<string, unknown> = {};
    try {
      const parsed = await res.json();
      if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
    } catch {
      // Not JSON: keep the status-based message.
    }
    return { status: res.status, ok: res.ok, body };
  } catch {
    return { status: 0, ok: false, body: {} };
  }
}

export function messageOf(res: HttpResult, fallback: string): string {
  if (res.status === 401) return "Sign in again to continue.";
  if (typeof res.body.error === "string" && res.body.error) return res.body.error;
  return fallback;
}

export type CommitOutcome =
  | { kind: "refused"; notebookId: string; name: string; message: string }
  | { kind: "failed"; message: string }
  | {
      kind: "created";
      notebookId: string;
      nodeId: string | null;
      /** null for General (never bound). */
      confirmed: boolean | null;
      notes: string[];
      docs: DocOutcome[];
    };

export type DocOutcome = {
  key: string;
  filename: string;
  docId: string | null;
  attachFailed: boolean;
  notIndexed: boolean;
  message: string | null;
};

export type CommitInput = {
  selected: Selection;
  name: string;
  docs: readonly CommitDoc[];
  pdfs: readonly File[];
};

const NOT_CONFIRMED = "The project is open, but the machine is not confirmed yet. Confirm it before starting a job.";

/**
 * The one write path. Order: create (general: createNotebook; machine: POST
 * /api/assets/{id}/notebook/, then PUT /asset to confirm, then GET to verify),
 * then a sources POST per selected document, then each uploaded PDF (POST
 * files, then sources). A refusal stops before any further write.
 */
export async function runCommit(input: CommitInput, deps: SetupDeps): Promise<CommitOutcome> {
  const notes: string[] = [];
  let notebookId: string;
  let nodeId: string | null = null;
  let confirmed: boolean | null = null;
  const name = input.name.trim();

  if (input.selected.kind === "general") {
    let id: string | null;
    try {
      id = await deps.createNotebook({ displayName: name, identitySourceType: "user" });
    } catch (err) {
      return { kind: "failed", message: err instanceof Error ? err.message : "Could not create the project." };
    }
    if (!id) return { kind: "failed", message: "Sign in again to continue." };
    notebookId = id;
  } else {
    const machine = input.selected.machine;
    const post = () => call(deps, "POST", `/api/assets/${encodeURIComponent(machine.id)}/notebook/`, {
      json: { selectedVia: "asset_picker", displayName: name || machine.name },
    });
    let res = await post();
    if (!res.ok && res.body.code === "notebook_race") res = await post();
    if (!res.ok) return { kind: "failed", message: messageOf(res, "Could not open a project for that machine.") };
    const nb = res.body.notebook as { id?: unknown; nodeId?: unknown; displayName?: unknown } | undefined;
    if (typeof nb?.id !== "string" || typeof nb.nodeId !== "string") {
      return { kind: "failed", message: "The project was created but could not be opened. Refresh projects before trying again." };
    }
    const existingName = typeof nb.displayName === "string" && nb.displayName ? nb.displayName : machine.name;
    if (res.body.created === false) {
      return { kind: "refused", notebookId: nb.id, name: existingName, message: `This machine already has a project: ${existingName}` };
    }
    notebookId = nb.id;
    nodeId = nb.nodeId;

    const put = await call(deps, "PUT", `/api/equipment-notebooks/${encodeURIComponent(notebookId)}/asset/`, {
      json: { assetRef: machine.id, selectedVia: "asset_picker" },
    });
    if (!put.ok) {
      if (put.body.code === "asset_already_bound" && typeof put.body.boundNotebookId === "string") {
        return { kind: "refused", notebookId: put.body.boundNotebookId, name: machine.name, message: "This machine already has a project." };
      }
      confirmed = false;
      notes.push(NOT_CONFIRMED);
    } else {
      const entityId = (put.body.notebook as { asset?: { entityId?: unknown } } | undefined)?.asset?.entityId;
      const verify = await call(deps, "GET", `/api/equipment-notebooks/${encodeURIComponent(notebookId)}/`);
      const binding = (verify.body.notebook as { asset?: { entityId?: unknown; confirmedAt?: unknown } } | undefined)?.asset;
      const ok = verify.ok && typeof entityId === "string" && binding?.entityId === entityId
        && typeof binding.confirmedAt === "string" && Number.isFinite(Date.parse(binding.confirmedAt));
      confirmed = ok;
      if (!ok) notes.push("Machine selection was saved, but its confirmation could not be checked. Check again before starting a job.");
    }
  }

  if (input.selected.kind === "general" && input.pdfs.length > 0 && nodeId === null) {
    const read = await call(deps, "GET", `/api/equipment-notebooks/${encodeURIComponent(notebookId)}/`);
    const id = (read.body.notebook as { nodeId?: unknown } | undefined)?.nodeId;
    if (read.ok && typeof id === "string") nodeId = id;
  }

  const docs: DocOutcome[] = [];
  const attached = new Set<string>();
  const attach = async (docId: string, filename: string, key: string, message: string | null) => {
    if (attached.has(docId)) return;
    attached.add(docId);
    const res = await call(deps, "POST", `/api/equipment-notebooks/${encodeURIComponent(notebookId)}/sources/`, {
      json: { docId, sourceRole: "manual" },
    });
    docs.push({ key, filename, docId, attachFailed: !res.ok, notIndexed: false, message: res.ok ? message : messageOf(res, "Couldn't be added as a source. Try again from the project.") });
  };
  for (const doc of input.docs) await attach(doc.docId, doc.filename, doc.docId, null);

  for (const pdf of input.pdfs) {
    if (nodeId === null) {
      docs.push({ key: `upload:${pdf.name}`, filename: pdf.name, docId: null, attachFailed: false, notIndexed: true, message: "Couldn't save the file to this project." });
      continue;
    }
    const form = new FormData();
    form.append("file", pdf);
    const up = await call(deps, "POST", `/api/namespace/node/${encodeURIComponent(nodeId)}/files/`, { form });
    if (!up.ok) {
      docs.push({ key: `upload:${pdf.name}`, filename: pdf.name, docId: null, attachFailed: false, notIndexed: true, message: messageOf(up, "Couldn't save this file. Try again.") });
      continue;
    }
    const uploadId = up.body.uploadId;
    if (up.body.indexed !== true || typeof uploadId !== "string" || !uploadId) {
      const warning = typeof up.body.warning === "string" && up.body.warning ? ` (${up.body.warning})` : "";
      docs.push({ key: `upload:${pdf.name}`, filename: pdf.name, docId: null, attachFailed: false, notIndexed: true, message: `Saved to this project, but it couldn't be read for chat yet${warning}.` });
      continue;
    }
    await attach(uploadId, pdf.name, uploadId, null);
  }

  return { kind: "created", notebookId, nodeId, confirmed, notes, docs };
}

// ---------- readiness watch and result rows ----------

export type SourceView = { docId: string; filename: string | null; readiness: unknown; matchState: unknown };
export const POLL_INTERVAL_MS = 3000;
export const POLL_MAX = 20;
export const STILL_PROCESSING = "Still processing, you can start; it becomes searchable when ready.";

/**
 * Poll the notebook's sources on a bounded schedule. Stops early once every
 * watched document has left uploading/stored. `capped` means the schedule ran out.
 */
export async function watchReadiness(
  notebookId: string,
  docIds: readonly string[],
  deps: SetupDeps,
  limits: { intervalMs?: number; max?: number } = {},
  /** Called after every poll; `stop()` true ends the watch (the sheet closed). */
  hooks: { onUpdate?: (sources: SourceView[]) => void; stop?: () => boolean } = {},
): Promise<{ sources: SourceView[]; capped: boolean; unauthorized: boolean }> {
  const max = limits.max ?? POLL_MAX;
  const intervalMs = limits.intervalMs ?? POLL_INTERVAL_MS;
  let sources: SourceView[] = [];
  for (let poll = 1; poll <= max; poll++) {
    const res = await call(deps, "GET", `/api/equipment-notebooks/${encodeURIComponent(notebookId)}/`);
    if (res.status === 401) return { sources, capped: false, unauthorized: true };
    if (res.ok && Array.isArray(res.body.sources)) {
      sources = (res.body.sources as Array<Record<string, unknown>>).flatMap((s) =>
        typeof s.docId === "string"
          ? [{ docId: s.docId, filename: typeof s.filename === "string" ? s.filename : null, readiness: s.readiness, matchState: s.matchState }]
          : []);
    }
    hooks.onUpdate?.(sources);
    const settled = docIds.every((id) => {
      const src = sources.find((s) => s.docId === id);
      return src !== undefined && !["uploading", "stored"].includes((src.readiness as { state?: string } | null)?.state ?? "");
    });
    if (settled) return { sources, capped: false, unauthorized: false };
    if (poll < max) await deps.sleep(intervalMs);
    if (hooks.stop?.()) return { sources, capped: false, unauthorized: false };
  }
  return { sources, capped: true, unauthorized: false };
}

export type ResultRow = {
  key: string;
  filename: string;
  readiness: ReadinessView;
  applicability: string | null;
  note: string | null;
};

/** One row per document. A failed or unindexed document never shows Ready. */
export function resultRows(docs: readonly DocOutcome[], sources: readonly SourceView[], capped: boolean): ResultRow[] {
  return docs.map((doc) => {
    if (doc.notIndexed) return { key: doc.key, filename: doc.filename, readiness: ATTENTION, applicability: null, note: doc.message };
    if (doc.attachFailed || !doc.docId) return { key: doc.key, filename: doc.filename, readiness: ATTENTION, applicability: null, note: doc.message };
    const src = sources.find((s) => s.docId === doc.docId);
    if (!src) return { key: doc.key, filename: doc.filename, readiness: ATTENTION, applicability: null, note: "Not listed in this project yet. Check the project before relying on it." };
    const readiness = readinessView(src.readiness);
    const stillBusy = readiness.tone === "processing" && capped;
    return {
      key: doc.key,
      filename: doc.filename,
      readiness,
      applicability: applicabilityLine(src.matchState),
      note: stillBusy ? STILL_PROCESSING : doc.message,
    };
  });
}

// ---------- controller (state and actions; writes only from commit) ----------

export type SetupStep = 1 | 2 | 3 | 4;

export type SetupState = {
  step: SetupStep;
  machines: Machine[] | null;
  machineError: string | null;
  machineMalformed: number;
  selected: Selection | null;
  name: string;
  duplicate: { notebookId: string; name: string } | null;
  linked: LinkedDoc[] | null;
  workspace: WorkspaceDoc[] | null;
  referencesError: string | null;
  chosenDocIds: string[];
  pdfs: File[];
  pdfError: string | null;
  committing: boolean;
  done: boolean;
  error: string | null;
  refusal: { notebookId: string; message: string } | null;
  notebookId: string | null;
  confirmed: boolean | null;
  notes: string[];
  rows: ResultRow[];
  stillProcessing: boolean;
};

export function initialSetupState(): SetupState {
  return {
    step: 1, machines: null, machineError: null, machineMalformed: 0, selected: null, name: "",
    duplicate: null, linked: null, workspace: null, referencesError: null, chosenDocIds: [],
    pdfs: [], pdfError: null, committing: false, done: false, error: null, refusal: null,
    notebookId: null, confirmed: null, notes: [], rows: [], stillProcessing: false,
  };
}

export type SetupController = {
  getState(): SetupState;
  subscribe(listener: (state: SetupState) => void): () => void;
  start(): Promise<void>;
  choose(selection: Selection): Promise<void>;
  setName(name: string): void;
  toggleDoc(docId: string): void;
  addPdfs(files: readonly File[]): void;
  removePdf(index: number): void;
  next(): Promise<void>;
  back(): void;
  commit(): Promise<void>;
  /** The notebook the technician should open, if any (created, or the existing one on a refusal). */
  openProjectId(): string | null;
  /** False while a commit is running: the sheet must not close mid-write. */
  cancel(): boolean;
  dispose(): void;
};

export type ControllerDeps = SetupDeps & {
  getNotebooks: () => readonly HubNotebook[];
  /** Called once a write has created or bound a project, so the host can refresh its list. */
  onWritten?: () => void;
  maxPdfBytes?: number;
};

const MACHINE_LOAD_ERROR = "Could not load your machines. Try again.";
const REFERENCES_ERROR = "Could not load your documents. You can still continue.";

export function createNewProjectSetup(deps: ControllerDeps): SetupController {
  let state = initialSetupState();
  const listeners = new Set<(s: SetupState) => void>();
  let disposed = false;
  const maxPdfBytes = deps.maxPdfBytes ?? MAX_UPLOAD_MB * 1024 * 1024;

  const set = (patch: Partial<SetupState>) => {
    state = { ...state, ...patch };
    if (!disposed) for (const l of listeners) l(state);
  };

  const ensureWorkspace = async (): Promise<void> => {
    if (state.workspace !== null) return;
    const res = await call(deps, "GET", "/api/files/?capability=indexable&limit=50");
    if (disposed) return;
    if (res.ok) set({ workspace: workspaceDocsFrom(res.body), referencesError: null });
    else set({ referencesError: REFERENCES_ERROR });
  };

  const allDocs = (): Array<{ docId: string | null; filename: string }> => [
    ...(state.linked ?? []),
    ...(state.workspace ?? []).map((w) => ({ docId: w.docId, filename: w.filename })),
  ];

  const controller: SetupController = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    async start() {
      if (state.machines !== null) return;
      const res = await call(deps, "GET", "/api/namespace/tree/");
      if (disposed) return;
      if (!res.ok) { set({ machineError: messageOf(res, MACHINE_LOAD_ERROR) }); return; }
      try {
        const result = machinesFromTree(res.body);
        set({ machines: result.machines, machineMalformed: result.malformed, machineError: null });
      } catch {
        set({ machineError: MACHINE_LOAD_ERROR });
      }
    },

    async choose(selection) {
      if (state.committing || state.done) return;
      if (selection.kind === "general") {
        set({ selected: selection, duplicate: null, linked: [], chosenDocIds: [] });
        return;
      }
      const machine = selection.machine;
      const dup = findExistingProject(machine.id, deps.getNotebooks());
      set({
        selected: selection,
        name: machine.name,
        duplicate: dup ? { notebookId: dup.id, name: dup.displayName } : null,
        linked: null,
        chosenDocIds: [],
      });
      if (dup) return;
      await ensureWorkspace();
      const res = await call(deps, "GET", `/api/namespace/node/${encodeURIComponent(machine.id)}/files/`);
      if (disposed || state.selected !== selection) return;
      const linked = res.ok ? linkedDocsFrom(res.body, state.workspace ?? []) : [];
      set({
        linked,
        chosenDocIds: linked.flatMap((d) => (d.docId ? [d.docId] : [])),
        referencesError: res.ok ? state.referencesError : REFERENCES_ERROR,
      });
    },

    setName(name) {
      if (!state.committing && !state.done) set({ name });
    },

    toggleDoc(docId) {
      if (state.committing || state.done) return;
      const chosen = state.chosenDocIds.includes(docId)
        ? state.chosenDocIds.filter((id) => id !== docId)
        : [...state.chosenDocIds, docId];
      set({ chosenDocIds: chosen });
    },

    addPdfs(files) {
      if (state.committing || state.done) return;
      const ok: File[] = [];
      let pdfError: string | null = null;
      for (const f of files) {
        const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
        if (!isPdf) pdfError = `${f.name} is not a PDF. Add PDFs only.`;
        else if (f.size > maxPdfBytes) pdfError = `${f.name} is over the ${MAX_UPLOAD_MB} MB limit.`;
        else ok.push(f);
      }
      set({ pdfs: [...state.pdfs, ...ok], pdfError });
    },

    removePdf(index) {
      if (state.committing || state.done) return;
      set({ pdfs: state.pdfs.filter((_, i) => i !== index) });
    },

    async next() {
      if (state.committing) return;
      if (state.step === 1) {
        if (!state.selected || state.duplicate) return;
        if (state.selected.kind === "general" && state.name.trim() === "") {
          set({ error: "Name this project first." });
          return;
        }
        set({ step: 2, error: null });
        await ensureWorkspace();
        return;
      }
      if (state.step === 2) { set({ step: 3, error: null }); return; }
      if (state.step === 3 && state.done) set({ step: 4 });
    },

    back() {
      if (state.committing || state.done) return;
      if (state.step === 2 || state.step === 3) set({ step: (state.step - 1) as SetupStep, error: null });
    },

    async commit() {
      if (state.committing || state.done || !state.selected || state.duplicate) return;
      const selected = state.selected;
      const docs: CommitDoc[] = [];
      const seen = new Set<string>();
      for (const id of state.chosenDocIds) {
        const match = allDocs().find((d) => d.docId === id);
        if (!match || !match.docId || seen.has(id)) continue;
        seen.add(id);
        docs.push({ docId: id, filename: match.filename });
      }
      set({ committing: true, error: null, refusal: null });
      const outcome = await runCommit({ selected, name: state.name, docs, pdfs: state.pdfs }, deps);
      if (disposed) return;
      if (outcome.kind === "refused") {
        set({ committing: false, refusal: { notebookId: outcome.notebookId, message: outcome.message } });
        return;
      }
      if (outcome.kind === "failed") {
        set({ committing: false, error: outcome.message });
        return;
      }
      deps.onWritten?.();
      set({ notebookId: outcome.notebookId, confirmed: outcome.confirmed, notes: outcome.notes });
      const watched = outcome.docs.flatMap((d) => (d.docId ? [d.docId] : []));
      // The writes are finished. After the first readiness read the sheet unlocks
      // (Continue, Cancel and Open work) while slow documents keep updating.
      const w = await watchReadiness(outcome.notebookId, watched, deps, {}, {
        onUpdate: (sources) => { if (!disposed) set({ committing: false, done: true, rows: resultRows(outcome.docs, sources, false) }); },
        stop: () => disposed,
      });
      if (disposed) return;
      if (w.unauthorized) {
        set({ committing: false, done: true, error: "Sign in again to see document status.", rows: resultRows(outcome.docs, [], false) });
        return;
      }
      set({
        committing: false,
        done: true,
        rows: resultRows(outcome.docs, w.sources, w.capped),
        stillProcessing: w.capped,
      });
    },

    openProjectId() {
      return state.notebookId ?? state.refusal?.notebookId ?? state.duplicate?.notebookId ?? null;
    },

    cancel() {
      if (state.committing) return false;
      disposed = true;
      listeners.clear();
      return true;
    },

    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
  return controller;
}
