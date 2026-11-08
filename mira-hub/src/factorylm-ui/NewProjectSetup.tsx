"use client";

/**
 * New project setup sheet (#4632). Replaces window.prompt. A native <dialog>:
 * Escape closes it, and phone Back closes it through the shared layer-back
 * history controller. Writes happen only on the "Create project" click; every
 * other action is a GET or local state.
 *
 * The decisions live in new-project-setup-logic.ts. This file only renders them.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { API_BASE } from "@/lib/config";
import type { HubNotebook } from "./notebook-tree";
import { createLayerBack, type LayerBack } from "./layer-back-history";
import {
  createNewProjectSetup,
  initialSetupState,
  listNotice,
  type LinkedDoc,
  type SetupController,
  type SetupState,
  type WorkspaceDoc,
} from "./new-project-setup-logic";

/** Arm the Back placeholder after the host's own history step has settled (see the sheet effect). */
export const LAYER_ARM_DELAY_MS = 150;

export type SetupActions = {
  retryMachines: () => void;
  choose: (kind: "general" | string) => void;
  setName: (name: string) => void;
  toggleDoc: (docId: string) => void;
  addPdfs: (files: File[]) => void;
  removePdf: (index: number) => void;
  next: () => void;
  back: () => void;
  commit: () => void;
  openProject: () => void;
  cancel: () => void;
};

const field: CSSProperties = { display: "block", width: "100%", minHeight: 44, fontSize: 16, padding: "8px 10px", border: "1px solid var(--fl-line-strong)", borderRadius: "var(--fl-radius)", background: "var(--fl-surface)", color: "var(--fl-ink)", boxSizing: "border-box" };
const button: CSSProperties = { minHeight: 44, minWidth: 44, padding: "0 16px", borderRadius: "var(--fl-radius)", border: "1px solid var(--fl-line-strong)", background: "var(--fl-surface)", color: "var(--fl-ink)", fontSize: "var(--fl-fs-sm)", cursor: "pointer" };
const primary: CSSProperties = { ...button, background: "var(--fl-accent)", color: "var(--fl-surface)", border: "1px solid var(--fl-accent)" };
/** A disabled button looks disabled (same dimming as a disabled checkbox row). */
const unless = (style: CSSProperties, off: boolean): CSSProperties => (off ? { ...style, opacity: 0.6, cursor: "not-allowed" } : style);
const row: CSSProperties = { display: "flex", alignItems: "center", gap: 12, minHeight: 44, padding: "8px 0", borderBottom: "1px solid var(--fl-line)" };
const muted: CSSProperties = { color: "var(--fl-muted)", fontSize: "var(--fl-fs-sm)", margin: "4px 0" };
const alertBox: CSSProperties = { background: "var(--fl-warn-bg)", border: "1px solid var(--fl-line)", borderRadius: "var(--fl-radius)", padding: "10px 12px", margin: "10px 0", fontSize: "var(--fl-fs-sm)" };
const TONE_COLOR: Record<string, string> = { ready: "var(--fl-ok)", processing: "var(--fl-muted)", attention: "var(--fl-warn)" };

const STEP_TITLES = ["What are you working on?", "Load references", "Confirm readiness", "Start working"];

function Checkbox({ checked, disabled, label, reason, onToggle }: { checked: boolean; disabled: boolean; label: string; reason: string | null; onToggle: () => void }) {
  return (
    <label style={{ ...row, opacity: disabled ? 0.6 : 1 }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} style={{ width: 22, height: 22 }} />
      <span style={{ flex: 1 }}>
        <span style={{ display: "block" }}>{label}</span>
        {reason ? <span style={muted}>{reason}</span> : null}
      </span>
    </label>
  );
}

function Step1({ state, actions }: { state: SetupState; actions: SetupActions }) {
  const machineNotice = state.machineError ? "load-failed" : listNotice({ failed: false, machines: state.machines, malformed: state.machineMalformed, shown: state.machines?.length ?? 0 });
  const generalSelected = state.selected?.kind === "general";
  return (
    <>
      <p style={muted}>Pick the machine this project is about, or start a general project with no machine.</p>
      {machineNotice === "loading" ? <p style={muted}>Loading machines…</p> : null}
      {machineNotice === "load-failed" || machineNotice === "unreadable" ? (
        <p role="alert" style={alertBox}>{state.machineError ?? "Could not load your machines. Try again."} <button type="button" style={button} onClick={actions.retryMachines}>Retry</button></p>
      ) : null}
      {machineNotice === "empty" ? <p style={muted}>No machines yet. Choose General to start without one.</p> : null}
      <div role="group" aria-label="Machines" style={{ display: "grid", gap: 8 }}>
        <button type="button" aria-pressed={generalSelected} onClick={() => actions.choose("general")} style={{ ...button, textAlign: "left", background: generalSelected ? "var(--fl-accent-tint)" : "var(--fl-surface)", color: generalSelected ? "var(--fl-accent-ink)" : "var(--fl-ink)", borderColor: generalSelected ? "var(--fl-accent)" : "var(--fl-line-strong)" }}>
          General (no machine)
        </button>
        {(state.machines ?? []).map((m) => {
          const pressed = state.selected?.kind === "machine" && state.selected.machine.id === m.id;
          return (
            <button key={m.id} type="button" aria-pressed={pressed} onClick={() => actions.choose(m.id)} style={{ ...button, textAlign: "left", minHeight: 56, background: pressed ? "var(--fl-accent-tint)" : "var(--fl-surface)", color: pressed ? "var(--fl-accent-ink)" : "var(--fl-ink)", borderColor: pressed ? "var(--fl-accent)" : "var(--fl-line-strong)" }}>
              <span style={{ display: "block", fontWeight: 600 }}>{m.name}</span>
              <span style={{ display: "block", fontSize: "var(--fl-fs-xs)" }}>{[m.location, m.unsPath || m.tag].filter(Boolean).join(" · ")}</span>
            </button>
          );
        })}
      </div>
      {state.duplicate ? (
        <p role="alert" style={alertBox}>
          This machine already has a project: {state.duplicate.name}{" "}
          <button type="button" style={primary} onClick={actions.openProject}>Open that project</button>
        </p>
      ) : null}
      {state.selected?.kind === "machine" && !state.duplicate && state.linked === null ? <p role="status" style={muted}>Loading this machine&apos;s manuals…</p> : null}
      {state.selected ? (
        <label style={{ display: "block", marginTop: 14 }}>
          <span style={muted}>{generalSelected ? "Project name (required)" : "Project name"}</span>
          <input value={state.name} onChange={(e) => actions.setName(e.target.value)} style={field} />
        </label>
      ) : null}
    </>
  );
}

function Step2({ state, actions }: { state: SetupState; actions: SetupActions }) {
  const linked: LinkedDoc[] = state.linked ?? [];
  const linkedIds = new Set(linked.map((d) => d.docId).filter(Boolean));
  const workspace: WorkspaceDoc[] = (state.workspace ?? []).filter((w) => !w.docId || !linkedIds.has(w.docId));
  const isChosen = (docId: string | null) => docId !== null && state.chosenDocIds.includes(docId);
  return (
    <>
      <h3 style={{ fontSize: "var(--fl-fs)", margin: "8px 0 4px" }}>Manuals linked to this machine</h3>
      {state.linked === null && state.selected?.kind === "machine" ? <p style={muted}>Loading manuals…</p> : null}
      {linked.length === 0 && state.linked !== null ? <p style={muted}>No manuals are linked to this machine yet.</p> : null}
      {linked.map((d) => (
        <Checkbox key={d.key} checked={isChosen(d.docId)} disabled={!d.docId} label={d.filename} reason={d.reason} onToggle={() => d.docId && actions.toggleDoc(d.docId)} />
      ))}
      <h3 style={{ fontSize: "var(--fl-fs)", margin: "16px 0 4px" }}>Workspace documents</h3>
      {state.referencesError ? <p role="alert" style={alertBox}>{state.referencesError}</p> : null}
      {workspace.length === 0 && state.workspace !== null ? <p style={muted}>No other documents in your workspace.</p> : null}
      {workspace.map((w) => (
        <Checkbox key={w.fileId} checked={isChosen(w.docId)} disabled={!w.docId} label={w.filename} reason={w.docId ? null : "Not ready to attach: no searchable copy yet."} onToggle={() => w.docId && actions.toggleDoc(w.docId)} />
      ))}
      <h3 style={{ fontSize: "var(--fl-fs)", margin: "16px 0 4px" }}>Upload a PDF</h3>
      <input type="file" accept="application/pdf" multiple aria-label="Upload PDF" onChange={(e) => { actions.addPdfs(Array.from(e.target.files ?? [])); e.target.value = ""; }} style={{ fontSize: 16, minHeight: 44 }} />
      {state.pdfError ? <p role="alert" style={alertBox}>{state.pdfError}</p> : null}
      {state.pdfs.map((f, i) => (
        <div key={`${f.name}-${i}`} style={row}>
          <span style={{ flex: 1 }}>{f.name}</span>
          <button type="button" style={button} onClick={() => actions.removePdf(i)}>Remove {f.name}</button>
        </div>
      ))}
    </>
  );
}

function Step3({ state, actions }: { state: SetupState; actions: SetupActions }) {
  const target = state.selected?.kind === "machine" ? state.selected.machine.name : state.name || "General project";
  const docCount = state.chosenDocIds.length + state.pdfs.length;
  return (
    <>
      <p style={muted}>Project: <strong style={{ color: "var(--fl-ink)" }}>{state.name || target}</strong>{state.selected?.kind === "machine" ? (state.selected.machine.location ? ` · ${state.selected.machine.location}` : "") : " · General (no machine)"}</p>
      <p style={muted}>{docCount} document{docCount === 1 ? "" : "s"} to attach.</p>
      {state.refusal ? (
        <p role="alert" style={alertBox}>{state.refusal.message} <button type="button" style={primary} onClick={actions.openProject}>Open existing</button></p>
      ) : null}
      {state.error ? <p role="alert" style={alertBox}>{state.error}</p> : null}
      {state.done ? (
        <>
          {state.notes.map((n) => <p key={n} role="status" style={alertBox}>{n}</p>)}
          {state.rows.length === 0 ? <p style={muted}>Nothing to check.</p> : null}
          {state.rows.map((r) => (
            <div key={r.key} style={{ ...row, flexWrap: "wrap" }}>
              <span style={{ flex: "1 1 180px" }}>{r.filename}</span>
              <span style={{ color: TONE_COLOR[r.readiness.tone], fontWeight: 600 }}>{r.readiness.label}</span>
              {r.applicability ? <p style={{ ...muted, width: "100%", margin: 0 }}>{r.applicability}</p> : null}
              {r.note ? <p style={{ ...muted, width: "100%", margin: 0 }}>{r.note}</p> : null}
            </div>
          ))}
        </>
      ) : (
        <p style={muted}>Creating the project connects the machine, attaches your documents and starts indexing. Nothing is written until you press Create project.</p>
      )}
    </>
  );
}

function Step4({ state }: { state: SetupState }) {
  return (
    <>
      <p style={muted}>Your project is ready to open.</p>
      {state.confirmed === false ? <p role="status" style={alertBox}>The machine is not confirmed yet. Confirm it before starting a job.</p> : null}
      {state.stillProcessing ? <p role="status" style={muted}>Some documents are still processing. You can start now; they become searchable when ready.</p> : null}
    </>
  );
}

/** Presentational view: renders the state it is given; no effects, no fetches. */
export function NewProjectSetupView({ state, actions }: { state: SetupState; actions: SetupActions }) {
  const busy = state.committing;
  const canNext = state.step === 1
    ? !!state.selected && !state.duplicate && (state.selected.kind === "machine" ? state.linked !== null : state.name.trim() !== "")
    : state.step === 2;
  let body: ReactNode;
  if (state.step === 1) body = <Step1 state={state} actions={actions} />;
  else if (state.step === 2) body = <Step2 state={state} actions={actions} />;
  else if (state.step === 3) body = <Step3 state={state} actions={actions} />;
  else body = <Step4 state={state} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 16, maxWidth: 560, width: "100%", boxSizing: "border-box", fontFamily: "var(--fl-font)", color: "var(--fl-ink)" }}>
      <p style={muted}>New project · step {state.step} of 4</p>
      <h2 style={{ fontSize: "var(--fl-fs-title)", margin: 0 }}>{STEP_TITLES[state.step - 1]}</h2>
      {state.error && state.step === 1 ? <p role="alert" style={alertBox}>{state.error}</p> : null}
      {body}
      <div style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8 }}>
          {state.step > 1 && state.step < 4 ? <button type="button" style={unless(button, busy || state.done)} disabled={busy || state.done} onClick={actions.back}>Back</button> : null}
          {state.step < 4 && !state.done ? <button type="button" style={unless(button, busy)} disabled={busy} onClick={actions.cancel}>Cancel</button> : null}
        </div>
        {state.step === 1 ? <button type="button" style={unless(primary, !canNext)} disabled={!canNext} onClick={actions.next}>Next</button> : null}
        {state.step === 2 ? <button type="button" style={primary} onClick={actions.next}>Review</button> : null}
        {state.step === 3 && !state.done ? <button type="button" style={unless(primary, busy)} disabled={busy} onClick={actions.commit}>{busy ? "Creating…" : "Create project"}</button> : null}
        {state.step === 3 && state.done ? <button type="button" style={primary} onClick={actions.next}>Continue</button> : null}
        {state.step === 4 ? <button type="button" style={primary} onClick={actions.openProject}>Open project</button> : null}
      </div>
    </div>
  );
}

export type NewProjectSetupProps = {
  open: boolean;
  onClose: () => void;
  notebooks: readonly HubNotebook[];
  /** The host's createNotebook (General path). */
  createNotebook: (body: { displayName: string; identitySourceType: "user" }) => Promise<string | null>;
  /** Select the project and close the sheet. */
  onOpenProject: (notebookId: string) => void;
  /** A write created or bound a project: refresh the host's list. */
  onWritten: () => void;
};

/** Container: owns the controller, the native dialog and the phone Back layer. */
export function NewProjectSetup({ open, onClose, notebooks, createNotebook, onOpenProject, onWritten }: NewProjectSetupProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const notebooksRef = useRef(notebooks);
  const [ctl, setCtl] = useState<SetupController | null>(null);
  const [state, setState] = useState<SetupState>(initialSetupState);
  const closeRef = useRef(onClose);
  useEffect(() => { notebooksRef.current = notebooks; closeRef.current = onClose; }, [notebooks, onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }
    const controller = createNewProjectSetup({
      fetch: (input, init) => fetch(input, init),
      apiBase: API_BASE,
      createNotebook,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      getNotebooks: () => notebooksRef.current,
      onWritten,
    });
    setCtl(controller);
    setState(controller.getState());
    const unsubscribe = controller.subscribe(setState);
    if (!dialog.open) dialog.showModal();
    void controller.start();
    return () => { unsubscribe(); controller.dispose(); };
    // The controller is created once per opening; the host callbacks are read through refs and props at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Phone Back closes this sheet (the host's own layer hook only arms for shell
  // layers). Same lifetime as back-closes-layers.ts: one controller per mount,
  // synced on open/close. Disposing on close would drop the listener before the
  // placeholder's own pop lands, and that pop would then restore the URL from
  // before "Open project" selected the new notebook.
  const ctlRef = useRef<SetupController | null>(null);
  useEffect(() => { ctlRef.current = ctl; }, [ctl]);
  const layerRef = useRef<LayerBack | null>(null);
  useEffect(() => {
    layerRef.current = createLayerBack({
      history: window.history,
      currentUrl: () => window.location.href,
      onPopState: (listener) => { window.addEventListener("popstate", listener); return () => window.removeEventListener("popstate", listener); },
      // Back closes the sheet, except mid-write: then it re-arms and stays open.
      raiseBack: () => {
        if (ctlRef.current?.getState().committing) layerRef.current?.sync(true);
        else dialogRef.current?.close();
      },
    });
    return () => { layerRef.current?.dispose(); layerRef.current = null; };
  }, []);
  useEffect(() => {
    if (!open) { layerRef.current?.sync(false); return; }
    const timer = window.setTimeout(() => layerRef.current?.sync(true), LAYER_ARM_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  const actions: SetupActions = {
    retryMachines: () => { if (ctl) { void ctl.start(); } },
    choose: (kind) => {
      if (!ctl) return;
      if (kind === "general") { void ctl.choose({ kind: "general" }); return; }
      const machine = state.machines?.find((m) => m.id === kind);
      if (machine) void ctl.choose({ kind: "machine", machine });
    },
    setName: (name) => ctl?.setName(name),
    toggleDoc: (docId) => ctl?.toggleDoc(docId),
    addPdfs: (files) => ctl?.addPdfs(files),
    removePdf: (index) => ctl?.removePdf(index),
    next: () => { void ctl?.next(); },
    back: () => ctl?.back(),
    commit: () => { void ctl?.commit(); },
    openProject: () => {
      const id = ctl?.openProjectId();
      if (id) onOpenProject(id);
    },
    cancel: () => { dialogRef.current?.close(); },
  };

  return (
    <dialog
      ref={dialogRef}
      aria-label="New project"
      onCancel={(e) => { if (ctl?.getState().committing) e.preventDefault(); }}
      onClose={() => { ctl?.cancel(); closeRef.current(); }}
      style={{ padding: 0, border: "none", borderRadius: "var(--fl-radius)", background: "var(--fl-surface)", color: "var(--fl-ink)", width: "min(600px, 100vw)", maxWidth: "100vw", maxHeight: "100dvh", margin: "auto", boxSizing: "border-box" }}
    >
      {open && ctl ? <NewProjectSetupView state={state} actions={actions} /> : null}
    </dialog>
  );
}
