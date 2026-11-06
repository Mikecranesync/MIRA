"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { SheetView } from "@/capabilities/living-sheet/reduce";
import type { InstructionRecordV2 } from "@/capabilities/living-sheet/instruction-record-v2";
import type { CloseoutInput } from "@/capabilities/living-sheet/packet-intake";
import type { PacketEdit } from "@/capabilities/work-packet/types";
import { effectiveInstruction, fieldValueChanges, qcTargets } from "@/capabilities/living-sheet/instruction-fields";
import { apiIntakePacket, apiCloseout, apiAssetMemoryRecord, createAssetMemoryLoadGate, localStorageStore, type AssetMemoryRecord, type AssetMemorySelection } from "./living-sheet-client";
import { instructionRequestId, localInstructionInput } from "./living-instruction-client";
import { LivingInstructionGuide } from "./LivingInstructionGuide";

const button: CSSProperties = { minHeight: 48, padding: "10px 14px", margin: "6px 6px 6px 0", fontSize: 17, color: "var(--fl-text)", background: "var(--fl-surface)", border: "1px solid var(--fl-line)", borderRadius: 8 };
const inputStyle: CSSProperties = { display: "block", boxSizing: "border-box", minHeight: 48, width: "100%", fontSize: 17, margin: "6px 0", padding: 8, color: "var(--fl-text)", background: "var(--fl-surface)", border: "1px solid var(--fl-line)" };
const errorText = (error: string | undefined) => ({ identity_mismatch: "The packet does not match this notebook’s confirmed identity.", snapshot_conflict: "The saved job changed. Reopen the guide and review its current snapshot.", candidate_conflict: "A newer guide candidate was saved. Reopen the guide and review that exact revision before submitting QC.", candidate_content_limit: "The guide and its preserved history exceed the revision size limit. Earlier evidence is still saved; this QC was not recorded.", wrong_technician: "Only the authenticated technician who finished this job can save closeout QC.", request_id_conflict: "This request ID belongs to different content or another technician. Reopen the saved job to inspect its history." }[error ?? ""] ?? `Could not save: ${error ?? "connection interrupted"}. Retry the same request.`);

export function PacketIntakeButton({ notebookId, scopeId, onImported }: { notebookId: string; scopeId: string; onImported: (jobId: string) => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return <section><h3>Save a repair guide from this device</h3><p>Import the existing packet and reported work evidence into this notebook. Execution marks start clear.</p>
    <button type="button" style={button} disabled={busy} onClick={async () => {
      if (inFlight.current) return; inFlight.current = true; setBusy(true); setError(null);
      try {
        const source = await localInstructionInput(localStorageStore, notebookId);
        const clientRequestId = await instructionRequestId(`intake:${scopeId}:${notebookId}`, source);
        const result = await apiIntakePacket(notebookId, { ...source, clientRequestId });
        if (!result.ok) throw new Error(errorText(result.body.error));
        if (alive.current) onImported(result.body.jobId);
      } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "The local packet could not be imported."); }
      finally { inFlight.current = false; if (alive.current) setBusy(false); }
    }}>{busy ? "Saving guide…" : "Import local packet and work record"}</button>{error && <p role="alert">{error}</p>}
  </section>;
}

export function CloseoutQCForm({ record, scopeId, onSaved }: { record: InstructionRecordV2; scopeId: string; onSaved: () => Promise<void> }) {
  const packet = effectiveInstruction(record)!.packet;
  const targets = qcTargets(packet);
  const [decisions, setDecisions] = useState<Record<string, Partial<PacketEdit>>>({});
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const pending = useRef<CloseoutInput | null>(null); const inFlight = useRef(false);
  const set = (path: string, value: Partial<PacketEdit>) => { pending.current = null; setDecisions(prev => ({ ...prev, [path]: { ...prev[path], ...value, path } })); };
  const complete = targets.every(({ path }) => decisions[path]?.action && (decisions[path].action !== "settle" || (decisions[path].value?.trim() && decisions[path].source?.trim())));
  return <section data-no-print data-testid="closeout-qc"><h2>Performing technician closeout QC</h2><p>Make an explicit decision for every field and step. Unknowns may stay unknown. Corrections need their own source. This creates a DRAFT candidate; reusable acceptance remains separate.</p>
    <p>Reviewing {record.closeout ? `candidate revision ${record.closeout.revision}` : "the saved source-job guide"}.</p>
    {targets.map(({ path, field }) => <fieldset key={path} disabled={busy} style={{ minWidth: 0, marginBottom: 12 }}><legend>{path}</legend><p>{field.value ?? "Unknown"}</p>
      {field.source && <blockquote>Imported source: {field.source.line}</blockquote>}
      {fieldValueChanges(packet, path).map(({ entry, index }) => <p key={index}>Preserved correction provenance: {String(entry.previous ?? "unknown")} → {String(entry.next ?? "unknown")} · source {entry.source ?? "not recorded"} · reported by {entry.by} at {entry.at}. This history does not grant current QC authority.</p>)}
      <label>Decision<select style={inputStyle} value={decisions[path]?.action ?? ""} onChange={e => set(path, { action: e.target.value as PacketEdit["action"], value: undefined, source: undefined })}>
        <option value="">Choose a decision</option><option value="confirm">Checked as written (unknown stays unknown)</option><option value="settle">Correct or supply an answer</option><option value="mark_unknown">Keep or mark unknown</option><option value="strike">Exclude from the guide</option>
      </select></label>
      {decisions[path]?.action === "settle" && <><label>Corrected value<textarea style={inputStyle} maxLength={2000} value={decisions[path].value ?? ""} onChange={e => set(path, { value: e.target.value })} /></label><label>Source for this correction<input style={inputStyle} maxLength={2000} value={decisions[path].source ?? ""} onChange={e => set(path, { source: e.target.value })} /></label></>}
    </fieldset>)}
    {error && <p role="alert">{error}</p>}
    <button type="button" style={button} disabled={busy || !complete} onClick={async () => {
      if (inFlight.current) return; inFlight.current = true; setBusy(true); setError(null);
      try {
        if (!pending.current) {
          const content = { seq: record.snapshot.seq, snapshotId: record.snapshotId, baseCandidateId: record.closeout?.id ?? null, decisions: targets.map(({ path }) => decisions[path] as PacketEdit) };
          pending.current = { ...content, clientRequestId: await instructionRequestId(`closeout:${scopeId}:${record.snapshot.jobId}`, content) };
        }
        const response = await apiCloseout(record.lineage.notebookId, record.snapshot.jobId, pending.current);
        if (!response.ok) throw new Error(errorText(response.body.error));
        await onSaved();
      } catch (e) { setError(e instanceof Error ? e.message : "Closeout was interrupted. Retry."); }
      finally { inFlight.current = false; setBusy(false); }
    }}>{busy ? "Saving QC…" : "Save technician QC as draft candidate"}</button>
  </section>;
}

export function LivingInstructionControls({ notebookId, scopeId, view, pendingCount, onPrintMode, onSelection }: { notebookId: string; scopeId: string; view: SheetView; pendingCount: number; onPrintMode: (active: boolean) => void; onSelection: (selection: AssetMemorySelection | null, scope: { notebookId: string; jobId: string; seq: number }) => void }) {
  const [record, setRecord] = useState<AssetMemoryRecord | null>(null); const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [qcOpen, setQcOpen] = useState(false);
  const alive = useRef(true); const callbacks = useRef({ onSelection, onPrintMode });
  useLayoutEffect(() => { callbacks.current = { onSelection, onPrintMode }; }, [onSelection, onPrintMode]);
  const gate = useMemo(() => createAssetMemoryLoadGate(), []);
  const key = `${notebookId}:${view.jobId}:${view.seq}:${pendingCount > 0 ? "pending" : "saved"}`;
  const active = useRef({ key: "", token: 0 });
  // Layout synchronization invalidates the committed previous scope before
  // another event or asynchronous completion can publish its selection.
  useLayoutEffect(() => {
    active.current = { key, token: gate.begin(key) };
    callbacks.current.onSelection(null, { notebookId, jobId: view.jobId, seq: view.seq });
    return () => {
      if (active.current.key === key && gate.invalidate(key, active.current.token)) callbacks.current.onSelection(null, { notebookId, jobId: view.jobId, seq: view.seq });
    };
  }, [gate, key, notebookId, view.jobId, view.seq]);
  const load = useCallback(async () => {
    if (active.current.key !== key) return;
    const scope = { notebookId, jobId: view.jobId, seq: view.seq };
    const token = gate.begin(key); active.current = { key, token };
    callbacks.current.onSelection(null, scope);
    if (pendingCount > 0) return;
    const response = await apiAssetMemoryRecord(notebookId, view.jobId);
    if (!alive.current || !gate.current(key, token)) return;
    if (!response.ok) throw new Error("The saved guide could not be reopened. Retry when connected.");
    if (response.body.snapshot.seq !== view.seq || response.body.snapshot.jobId !== view.jobId) throw new Error("The job changed. Reopen the job before reviewing this guide.");
    setRecord(response.body); setQcOpen(false);
    callbacks.current.onSelection({ notebookId, jobId: view.jobId, selector: response.body.assetMemory.selector }, scope);
  }, [gate, key, notebookId, view.jobId, view.seq, pendingCount]);
  useEffect(() => {
    alive.current = true;
    void Promise.resolve().then(load).catch(e => { if (alive.current && active.current.key === key) setError((e as Error).message); });
  }, [load, key]);
  useEffect(() => () => { alive.current = false; callbacks.current.onPrintMode(false); }, []);
  const visibleRecord = record?.snapshot.seq === view.seq && record.snapshot.jobId === view.jobId && pendingCount === 0 ? record : null;
  return <section data-testid="living-instruction-controls">
    <button type="button" style={button} disabled={busy || pendingCount > 0} onClick={async () => { setBusy(true); setError(null); try { await load(); if (alive.current) { setOpen(true); onPrintMode(true); } } catch (e) { if (alive.current) setError((e as Error).message); } finally { if (alive.current) setBusy(false); } }}>{view.template.instruction ? "Reopen illustrated repair guide" : "Open saved job memory"}</button>
    {error && <p role="alert">{error}</p>}
    {open && visibleRecord && <><div data-no-print><button type="button" style={button} disabled={pendingCount > 0} onClick={() => window.print()}>Print / save guide as PDF</button><button type="button" style={button} onClick={() => { setOpen(false); setQcOpen(false); onPrintMode(false); }}>Close guide</button>
      {pendingCount > 0 && <p>Save pending job updates before printing or closeout QC.</p>}
      {view.finished && view.template.instruction && <button type="button" style={button} disabled={pendingCount > 0} onClick={() => setQcOpen(v => !v)}>Record closeout QC</button>}
      {visibleRecord.closeout && <p>Saved technician QC candidate revision {visibleRecord.closeout.revision}. Reusable acceptance not recorded.</p>}
    </div><LivingInstructionGuide record={visibleRecord} />{qcOpen && pendingCount === 0 && <CloseoutQCForm key={`${visibleRecord.snapshotId}:${visibleRecord.closeout?.id ?? "source"}`} record={visibleRecord} scopeId={scopeId} onSaved={load} />}</>}
  </section>;
}
