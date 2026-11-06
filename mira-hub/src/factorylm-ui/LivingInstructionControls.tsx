"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { SheetView } from "@/capabilities/living-sheet/reduce";
import type { InstructionRecordV2 } from "@/capabilities/living-sheet/instruction-record-v2";
import type { CloseoutInput } from "@/capabilities/living-sheet/packet-intake";
import type { PacketEdit } from "@/capabilities/work-packet/types";
import { qcTargets } from "@/capabilities/living-sheet/instruction-fields";
import { apiIntakePacket, apiCloseout, apiInstructionRecord, localStorageStore } from "./living-sheet-client";
import { instructionRequestId, localInstructionInput } from "./living-instruction-client";
import { LivingInstructionGuide } from "./LivingInstructionGuide";

const button: CSSProperties = { minHeight: 48, padding: "10px 14px", margin: "6px 6px 6px 0", fontSize: 17, color: "var(--fl-text)", background: "var(--fl-surface)", border: "1px solid var(--fl-line)", borderRadius: 8 };
const inputStyle: CSSProperties = { display: "block", boxSizing: "border-box", minHeight: 48, width: "100%", fontSize: 17, margin: "6px 0", padding: 8, color: "var(--fl-text)", background: "var(--fl-surface)", border: "1px solid var(--fl-line)" };
const errorText = (error: string | undefined) => ({ identity_mismatch: "The packet does not match this notebook’s confirmed identity.", snapshot_conflict: "The saved job changed. Reopen the guide and review its current snapshot.", wrong_technician: "Only the authenticated technician who finished this job can save closeout QC.", request_id_conflict: "This request ID belongs to different content or another technician. Reopen the saved job to inspect its history." }[error ?? ""] ?? `Could not save: ${error ?? "connection interrupted"}. Retry the same request.`);

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
  const packet = record.sourceEvidence!.packet;
  const targets = qcTargets(packet);
  const [decisions, setDecisions] = useState<Record<string, Partial<PacketEdit>>>({});
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const pending = useRef<CloseoutInput | null>(null); const inFlight = useRef(false);
  const set = (path: string, value: Partial<PacketEdit>) => { pending.current = null; setDecisions(prev => ({ ...prev, [path]: { ...prev[path], ...value, path } })); };
  const complete = targets.every(({ path }) => decisions[path]?.action && (decisions[path].action !== "settle" || (decisions[path].value?.trim() && decisions[path].source?.trim())));
  return <section data-no-print data-testid="closeout-qc"><h2>Performing technician closeout QC</h2><p>Make an explicit decision for every field and step. Unknowns may stay unknown. Corrections need their own source. This creates a DRAFT candidate; reusable acceptance remains separate.</p>
    {targets.map(({ path, field }) => <fieldset key={path} disabled={busy} style={{ minWidth: 0, marginBottom: 12 }}><legend>{path}</legend><p>{field.value ?? "Unknown"}</p>
      {field.source && <blockquote>Imported source: {field.source.line}</blockquote>}
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
          const content = { seq: record.snapshot.seq, snapshotId: record.snapshotId, decisions: targets.map(({ path }) => decisions[path] as PacketEdit) };
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

export function LivingInstructionControls({ notebookId, scopeId, view, pendingCount, onPrintMode }: { notebookId: string; scopeId: string; view: SheetView; pendingCount: number; onPrintMode: (active: boolean) => void }) {
  const [record, setRecord] = useState<InstructionRecordV2 | null>(null); const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [qcOpen, setQcOpen] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; onPrintMode(false); }; }, [onPrintMode]);
  const load = async () => {
    const response = await apiInstructionRecord(notebookId, view.jobId);
    if (!response.ok) throw new Error("The saved guide could not be reopened. Retry when connected.");
    if (response.body.snapshot.seq !== view.seq) throw new Error("The job changed. Reopen the job before reviewing this guide.");
    if (alive.current) { setRecord(response.body); setQcOpen(false); }
  };
  if (!view.template.instruction) return null;
  return <section data-testid="living-instruction-controls">
    <button type="button" style={button} disabled={busy} onClick={async () => { setBusy(true); setError(null); try { await load(); if (alive.current) { setOpen(true); onPrintMode(true); } } catch (e) { if (alive.current) setError((e as Error).message); } finally { if (alive.current) setBusy(false); } }}>Reopen illustrated repair guide</button>
    {error && <p role="alert">{error}</p>}
    {open && record && <><div data-no-print><button type="button" style={button} disabled={pendingCount > 0} onClick={() => window.print()}>Print / save guide as PDF</button><button type="button" style={button} onClick={() => { setOpen(false); setQcOpen(false); onPrintMode(false); }}>Close guide</button>
      {pendingCount > 0 && <p>Save pending job updates before printing or closeout QC.</p>}
      {view.finished && <button type="button" style={button} disabled={pendingCount > 0} onClick={() => setQcOpen(v => !v)}>Record closeout QC</button>}
      {record.closeout && <p>Saved technician QC candidate revision {record.closeout.revision}. Reusable acceptance not recorded.</p>}
    </div><LivingInstructionGuide record={record} />{qcOpen && pendingCount === 0 && <CloseoutQCForm key={record.snapshotId} record={record} scopeId={scopeId} onSaved={load} />}</>}
  </section>;
}
