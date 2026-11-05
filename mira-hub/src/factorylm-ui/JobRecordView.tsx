"use client";
/**
 * Work Packet job record — the controls a technician uses to record what they actually did:
 * per-step "performed", measured values, findings / unresolved issues, and job photos, plus the
 * completion summary that goes on screen and on paper.
 *
 * Pure presentation over `@/capabilities/work-packet/job-record` (every change goes through those
 * functions; nothing here decides what counts as done). Nothing is ever recorded by default: a
 * step stays unperformed until the technician taps it, and the summary never says the equipment
 * is safe, repaired or returned to service.
 */
import { useEffect, useRef, useState, type CSSProperties, type ChangeEvent } from "react";
import {
  addNote,
  addPhoto,
  completionSummary,
  MAX_JOB_PHOTOS,
  recordMeasurement,
  removePhoto,
  setNoteResolved,
  setStepPerformed,
  type JobNote,
  type JobPhoto,
  type JobRecord,
} from "@/capabilities/work-packet/job-record";
import type { WorkPacket } from "@/capabilities/work-packet/types";
import { LABEL_LEGEND, badgeText } from "./work-packet-view";

const S: Record<string, CSSProperties> = {
  box: { marginTop: 6, padding: "8px 10px", border: "1px dashed var(--fl-line-strong)", borderRadius: "var(--fl-radius-sm)", fontSize: "var(--fl-fs-sm)" },
  muted: { color: "var(--fl-muted)", fontSize: "var(--fl-fs-xs)" },
  btn: { minHeight: 44, padding: "0 14px", border: "1px solid var(--fl-line-strong)", borderRadius: "var(--fl-radius-sm)", background: "var(--fl-surface)", color: "var(--fl-ink)", font: "inherit", cursor: "pointer" },
  input: { minHeight: 44, width: "100%", boxSizing: "border-box", padding: "0 10px", border: "1px solid var(--fl-line-strong)", borderRadius: "var(--fl-radius-sm)", background: "var(--fl-surface)", color: "var(--fl-ink)", font: "inherit" },
  row: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 },
  ok: { color: "var(--fl-ok)" },
  photo: { display: "block", maxWidth: "100%", width: 220, height: "auto", border: "1px solid var(--fl-line)", borderRadius: "var(--fl-radius-sm)" },
  issue: { background: "var(--fl-warn-bg)", color: "var(--fl-warn)", padding: "6px 8px", borderRadius: "var(--fl-radius-sm)", marginTop: 6 },
  summary: { marginTop: 8, padding: "10px 12px", border: "1px solid var(--fl-line-strong)", borderRadius: "var(--fl-radius-sm)", background: "var(--fl-surface)" },
};

const stamp = (by: string, at: string) => `${by}, ${at.slice(0, 16).replace("T", " ")} UTC`;
const noteId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `n-${Date.now()}`);

/** What the packet is, what the labels mean, and what it is not — shown at the top of the packet. */
export function PacketCoverage({ packet }: { packet: Pick<WorkPacket, "steps" | "measurements" | "parts" | "tools" | "documents"> }) {
  return (
    <section style={{ ...S.box, borderStyle: "solid" }} data-testid="wp-coverage">
      <strong>What this packet covers.</strong>{" "}
      A draft job plan built only from the attached manufacturer documents ({packet.documents.length} document
      {packet.documents.length === 1 ? "" : "s"}): {packet.steps.length} procedure steps, {packet.parts.length} parts,{" "}
      {packet.tools.length} tools and {packet.measurements.length} torque/measurement values. It is a draft for a qualified
      person to review. It does not contain your site&apos;s isolation procedure and does not authorize work or return to service.
      <ul style={{ margin: "6px 0 0 0", padding: "0 0 0 18px" }} data-testid="wp-legend">
        {LABEL_LEGEND.map((e) => (
          <li key={e.label}><strong>{badgeText(e.label)}</strong> — {e.meaning}</li>
        ))}
      </ul>
    </section>
  );
}

/** Per-step "performed" record. A struck step cannot be recorded as performed. */
export function StepRecordControls({ index, struck, text, record, by, onChange }: {
  index: number; struck: boolean; text?: string | null; record: JobRecord; by: string; onChange: (r: JobRecord) => void;
}) {
  const ticked = record.steps[index];
  // A tick given before the step's text was edited is not a record for the new text (Codex EGM F35).
  const changed = !!ticked && text !== undefined && ticked.text !== undefined && ticked.text !== text;
  const done = changed ? undefined : ticked;
  if (struck) return <div style={S.muted} data-testid={`wp-step-record-${index}`}>Struck as not applicable — not recorded as performed.</div>;
  return (
    <div style={S.row} data-testid={`wp-step-record-${index}`}>
      {done ? (
        <>
          <span style={S.ok}>✓ Recorded as performed by {stamp(done.by, done.at)}</span>
          <button type="button" data-no-print style={S.btn} onClick={() => onChange(setStepPerformed(record, index, false, by, new Date().toISOString()))}>Undo</button>
        </>
      ) : (
        <>
          <span className="wp-print-only" style={S.muted}>☐ Not recorded as performed</span>
          {changed && <span style={S.muted}>Was recorded as performed by {stamp(ticked!.by, ticked!.at)}, but the step&apos;s text has changed since — record it again if it was done as it reads now.</span>}
          <button type="button" data-no-print data-testid={`wp-step-done-${index}`} style={S.btn}
            onClick={() => onChange(setStepPerformed(record, index, true, by, new Date().toISOString(), text))}>
            Mark step performed
          </button>
        </>
      )}
    </div>
  );
}

/** The value the technician actually measured, kept apart from the manual's value above it. */
export function MeasurementRecordInput({ index, record, by, onChange }: {
  index: number; record: JobRecord; by: string; onChange: (r: JobRecord) => void;
}) {
  const saved = record.measurements[index];
  const [text, setText] = useState(saved?.value ?? "");
  return (
    <div style={S.box} data-testid={`wp-measure-record-${index}`}>
      <div>Measured on this job: {saved ? <strong>{saved.value}</strong> : <em>not recorded</em>}{saved && <span style={S.muted}> — {stamp(saved.by, saved.at)}, technician entry</span>}</div>
      <div style={S.row} data-no-print>
        <input aria-label="Measured value" data-testid={`wp-measure-input-${index}`} style={{ ...S.input, flex: "1 1 160px", width: "auto" }} value={text} onChange={(e) => setText(e.target.value)} placeholder="As measured, with units" />
        <button type="button" data-testid={`wp-measure-save-${index}`} style={S.btn} onClick={() => onChange(recordMeasurement(record, index, text, by, new Date().toISOString()))}>Save</button>
      </div>
    </div>
  );
}

/** Findings and unresolved issues. An issue stays open until someone marks it resolved. */
export function JobNotesSection({ record, by, steps, onChange }: {
  record: JobRecord; by: string; steps: number; onChange: (r: JobRecord) => void;
}) {
  const [kind, setKind] = useState<JobNote["kind"]>("finding");
  const [text, setText] = useState("");
  const [step, setStep] = useState("");
  const add = () => {
    if (!text.trim()) return;
    onChange(addNote(record, { id: noteId(), kind, text, stepIndex: step === "" ? null : Number(step), by, at: new Date().toISOString() }));
    setText("");
  };
  return (
    <section style={{ marginTop: 16 }} data-testid="wp-notes">
      <h3 style={{ margin: "0 0 6px 0", fontSize: "var(--fl-fs)" }}>Findings &amp; open issues (technician notes — not from the manual)</h3>
      {record.notes.length === 0 && <div style={S.muted}>None recorded.</div>}
      {record.notes.map((n) => (
        <div key={n.id} style={n.kind === "issue" && !n.resolved ? S.issue : S.box} data-testid={`wp-note-${n.kind}`}>
          <strong>{n.kind === "issue" ? (n.resolved ? "Issue (resolved)" : "Open issue") : "Finding"}</strong>
          {n.stepIndex !== null && ` · step ${n.stepIndex + 1}`}: {n.text}
          <div style={S.muted}>{stamp(n.by, n.at)}{n.resolved && n.resolvedBy && n.resolvedAt ? ` · resolved by ${stamp(n.resolvedBy, n.resolvedAt)}` : ""}</div>
          {n.kind === "issue" && (
            <button type="button" data-no-print style={{ ...S.btn, marginTop: 6 }} onClick={() => onChange(setNoteResolved(record, n.id, !n.resolved, by, new Date().toISOString()))}>
              {n.resolved ? "Reopen issue" : "Mark resolved"}
            </button>
          )}
        </div>
      ))}
      <div data-no-print style={{ marginTop: 8 }}>
        <div style={S.row}>
          <select aria-label="Note type" data-testid="wp-note-kind" style={{ ...S.input, width: "auto" }} value={kind} onChange={(e) => setKind(e.target.value as JobNote["kind"])}>
            <option value="finding">Finding</option>
            <option value="issue">Unresolved issue</option>
          </select>
          <select aria-label="Step" style={{ ...S.input, width: "auto" }} value={step} onChange={(e) => setStep(e.target.value)}>
            <option value="">Whole job</option>
            {Array.from({ length: steps }, (_, i) => <option key={i} value={i}>Step {i + 1}</option>)}
          </select>
        </div>
        <textarea aria-label="Note" data-testid="wp-note-text" style={{ ...S.input, minHeight: 72, padding: 8, marginTop: 6 }} value={text} onChange={(e) => setText(e.target.value)} />
        <button type="button" data-testid="wp-note-add" style={{ ...S.btn, marginTop: 6 }} disabled={!text.trim()} onClick={add}>Add note</button>
      </div>
    </section>
  );
}

/** Downscale a camera photo to a small JPEG so the record fits in this device's storage. */
async function downscale(file: File, maxPx = 1024): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.7);
}

/** Decode a photo, then add it to the record as it is NOW — not as it was when decoding started —
 *  so work recorded meanwhile is kept (Codex review F5). Null when the packet changed meanwhile. */
export async function addPhotoWhenDecoded(
  decode: () => Promise<string>,
  latest: () => JobRecord | null,
  packetId: string,
  makePhoto: (image: string) => JobPhoto,
): Promise<JobRecord | null> {
  const image = await decode();
  const now = latest();
  if (!now || now.packetId !== packetId) return null;
  return addPhoto(now, makePhoto(image));
}

export function JobPhotosSection({ record, by, onChange, onError, synthetic = false }: {
  record: JobRecord; by: string; onChange: (r: JobRecord) => void; onError: (msg: string) => void;
  /** A demo job: its photos are test images and say so where they are shown (Codex EGM F13). */
  synthetic?: boolean;
}) {
  const [caption, setCaption] = useState("");
  // The record as last rendered; null once unmounted, so a late photo is dropped, not written.
  const latest = useRef<JobRecord | null>(record);
  useEffect(() => {
    latest.current = record;
  }, [record]);
  useEffect(() => () => {
    latest.current = null;
  }, []);
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const text = caption.trim();
    try {
      const next = await addPhotoWhenDecoded(() => downscale(file), () => latest.current, record.packetId, (image) => ({ id: noteId(), image, caption: text, stepIndex: null, by, at: new Date().toISOString() }));
      if (!next) return;
      onChange(next);
      setCaption("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "That photo could not be added.");
    }
  };
  return (
    <section style={{ marginTop: 16 }} data-testid="wp-photos">
      <h3 style={{ margin: "0 0 6px 0", fontSize: "var(--fl-fs)" }}>{synthetic ? "Test images — synthetic job, not a real job" : "Job photos (taken on this job)"}</h3>
      {record.photos.length === 0 && <div style={S.muted}>None added.</div>}
      {record.photos.map((p) => (
        <figure key={p.id} style={{ margin: "8px 0" }} data-testid="wp-job-photo">
          {/* eslint-disable-next-line @next/next/no-img-element -- an inline data: URL photo; next/image cannot optimise it */}
          <img src={p.image} alt={p.caption || (synthetic ? "Test image" : "Job photo")} style={S.photo} />
          <figcaption style={S.muted}>{p.caption ? `${p.caption} · ` : ""}{synthetic ? "Test image" : "Job photo"} by {stamp(p.by, p.at)}</figcaption>
          <button type="button" data-no-print style={{ ...S.btn, marginTop: 4 }} onClick={() => onChange(removePhoto(record, p.id))}>Remove</button>
        </figure>
      ))}
      {record.photos.length < MAX_JOB_PHOTOS ? (
        <div data-no-print style={S.row}>
          <input aria-label="Photo caption" style={{ ...S.input, flex: "1 1 160px", width: "auto" }} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption (optional)" />
          <label style={{ ...S.btn, display: "inline-flex", alignItems: "center" }}>
            Add photo
            <input type="file" accept="image/*" capture="environment" data-testid="wp-photo-input" style={{ display: "none" }} onChange={(e) => void onFile(e)} />
          </label>
        </div>
      ) : (
        <div data-no-print style={S.muted}>This record holds at most {MAX_JOB_PHOTOS} photos.</div>
      )}
    </section>
  );
}

/** Where the job stands, in words. Printed with the packet. Never claims a return to service. */
export function CompletionBlock({ packet, record }: { packet: Pick<WorkPacket, "steps" | "measurements">; record: JobRecord }) {
  const s = completionSummary(packet, record);
  return (
    <section style={S.summary} data-testid="wp-completion" data-status={s.status}>
      <strong>Work record status (draft)</strong>
      <div style={{ marginTop: 4 }}>{s.text}</div>
    </section>
  );
}
