"use client";
/**
 * Mission 001 (#5088): report a technician observation on the bound machine and read back the
 * machine state FactoryLM derives from it (Hub adapter, outside the frozen legacy trees).
 *
 * Flow: the technician types what they saw → Preview (the server parses it, writes nothing) →
 * they correct the fields → Confirm (one durable observation, retry-safe by request id) → the
 * panel shows "confirmed" only once a fresh readback lists the new observation. Renders nothing
 * while the capability is off (404 observations_disabled) or unavailable.
 * Styling uses the shared --fl-* tokens only.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { API_BASE } from "@/lib/config";
import {
  createObservationRequestIds,
  factLine,
  observationSaveMessage,
  type FactState,
  type ObservationPreview,
  type ObservedStateView,
} from "./machine-observations-logic";

type Phase =
  | { kind: "idle" }
  | { kind: "previewing" }
  | { kind: "review"; preview: ObservationPreview }
  | { kind: "pending"; preview: ObservationPreview }
  | { kind: "failed"; preview: ObservationPreview; message: string }
  | { kind: "confirmed"; observationId: string };

// Placed by the host's notebook-actions stack (hub-host.tsx), so it never sits on another button.
export const OBS_PILL_STYLE: CSSProperties = {
  background: "var(--fl-surface)", color: "var(--fl-text)", border: "1px solid var(--fl-line)",
  borderRadius: "var(--fl-radius-pill, 999px)", padding: "8px 14px", fontSize: "var(--fl-fs-sm)",
  minHeight: 44, cursor: "pointer",
};

const PANEL_STYLE: CSSProperties = {
  position: "fixed", inset: "auto 0 0 0", maxHeight: "80vh", overflowY: "auto", zIndex: 60,
  background: "var(--fl-surface)", color: "var(--fl-text)", borderTop: "1px solid var(--fl-line)",
  boxShadow: "var(--fl-shadow)", padding: "var(--fl-space-4, 16px)", fontFamily: "var(--fl-font)",
};

const FIELD_STYLE: CSSProperties = {
  display: "block", width: "100%", minHeight: 44, marginTop: 4, padding: "8px",
  border: "1px solid var(--fl-line)", borderRadius: "var(--fl-radius)", background: "var(--fl-surface)",
  color: "var(--fl-text)", fontSize: "var(--fl-fs-md, 16px)", boxSizing: "border-box",
};

const BUTTON_STYLE: CSSProperties = {
  minHeight: 44, padding: "8px 16px", marginInlineEnd: 8, borderRadius: "var(--fl-radius)",
  border: "1px solid var(--fl-line)", background: "var(--fl-accent)", color: "var(--fl-surface)", cursor: "pointer",
};

function base(notebookId: string): string {
  return `${API_BASE}/api/equipment-notebooks/${encodeURIComponent(notebookId)}/observations/`;
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function FactLine({ fact }: { fact: FactState }) {
  const entries = fact.contested ? fact.conflicting : [fact.current];
  return (
    <li data-testid={`observed-fact-${fact.factKey}`} data-state={fact.state} style={{ marginBottom: 8 }}>
      <strong>{factLine(fact)}</strong>
      {entries.map((e) => (
        <div key={e.observationId} style={{ fontSize: "var(--fl-fs-sm)", color: "var(--fl-muted)" }}>
          {fact.contested ? `${e.factValue}: ` : ""}reported by {e.author ?? "a technician"} · observed{" "}
          {new Date(e.observedAt).toLocaleString()} · recorded {new Date(e.recordedAt).toLocaleString()} ·{" "}
          {e.verificationMethod === "self_reported" ? "self-reported, not verified" : e.verificationMethod}
        </div>
      ))}
    </li>
  );
}

function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export function MachineObservations({ notebookId }: { notebookId: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [state, setState] = useState<ObservedStateView | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const requestIds = useMemo(() => createObservationRequestIds(), []);
  // StrictMode replays effects (setup, cleanup, setup): set the flag in setup, not only at
  // init, or the replayed cleanup leaves it false and the panel never shows (#5091 Codex r2 F3).
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const readBack = useCallback(async (observationId?: string): Promise<ObservedStateView | null> => {
    const url = observationId ? `${base(notebookId)}?observation=${encodeURIComponent(observationId)}` : base(notebookId);
    const res = await fetch(url, { credentials: "include", headers: { accept: "application/json" } });
    if (res.status === 404) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (body?.error === "observations_disabled") { if (mounted.current) setEnabled(false); return null; }
    }
    // No confirmed machine on this notebook yet: there is no machine state to show or report against.
    if (res.status === 409) { if (mounted.current) setEnabled(false); return null; }
    if (!res.ok) throw new Error(`readback ${res.status}`);
    const view = (await res.json()) as ObservedStateView;
    if (mounted.current) { setEnabled(true); setState(view); setReadError(null); }
    return view;
  }, [notebookId]);

  useEffect(() => {
    readBack().catch(() => { if (mounted.current) { setEnabled(true); setReadError("Machine state could not be loaded."); } });
  }, [readBack]);

  const onPreview = useCallback(async () => {
    const report = text.trim();
    if (!report) return;
    setPhase({ kind: "previewing" });
    try {
      const res = await fetch(`${base(notebookId)}preview/`, {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        // The device is at the plant: its zone is how a bare "09:10" is meant (and how review shows it).
        body: JSON.stringify({ text: report, timeZone: deviceTimeZone() }),
      });
      const body = (await res.json().catch(() => null)) as ({ preview?: ObservationPreview; error?: string; message?: string }) | null;
      if (!res.ok || !body?.preview) {
        setPhase({ kind: "failed", preview: { factKey: null, factValue: null, observedAt: null, rawReport: report, needs: [] }, message: observationSaveMessage(body?.error, body?.message) });
        return;
      }
      setPhase({ kind: "review", preview: { ...body.preview, factValue: body.preview.factValue ?? "present" } });
    } catch {
      setPhase({ kind: "failed", preview: { factKey: null, factValue: null, observedAt: null, rawReport: report, needs: [] }, message: "No reply from the server. Try Preview again." });
    }
  }, [notebookId, text]);

  const onConfirm = useCallback(async (preview: ObservationPreview) => {
    const clientRequestId = requestIds.idFor(preview);
    setPhase({ kind: "pending", preview });
    try {
      const res = await fetch(base(notebookId), {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          confirmed: true, factKey: preview.factKey, factValue: preview.factValue,
          observedAt: preview.observedAt, rawReport: preview.rawReport, clientRequestId,
        }),
      });
      const body = (await res.json().catch(() => null)) as { observation?: { id: string }; error?: string; message?: string } | null;
      if (!res.ok || !body?.observation?.id) {
        if (res.status >= 400 && res.status < 500) requestIds.settle(preview);
        setPhase({ kind: "failed", preview, message: observationSaveMessage(body?.error, body?.message) });
        return;
      }
      const id = body.observation.id;
      // Confirmed only once the machine state read back from the server lists this observation.
      // Read back by id: history is paged, so a late report may not be on the first page (#5098).
      const view = await readBack(id);
      const listed = view?.observation?.id === id;
      if (!listed) {
        setPhase({ kind: "failed", preview, message: "Saved, but the machine state has not shown it yet. Retry to check again." });
        return;
      }
      requestIds.settle(preview);
      setText("");
      setPhase({ kind: "confirmed", observationId: id });
    } catch {
      // Timeout or network loss: the save may or may not have landed. Retrying reuses the same request id,
      // so the server returns the stored observation instead of a duplicate.
      setPhase({ kind: "failed", preview, message: "No reply from the server. Retry — it will not create a duplicate." });
    }
  }, [notebookId, readBack, requestIds]);

  if (!enabled) return null;

  const editing = phase.kind === "review" || phase.kind === "failed" || phase.kind === "pending" ? phase.preview : null;
  const setPreview = (next: ObservationPreview) => {
    if (phase.kind === "review" || phase.kind === "failed") setPhase({ ...phase, preview: next } as Phase);
  };

  return (
    <>
      <button type="button" style={OBS_PILL_STYLE} data-testid="machine-state-pill" onClick={() => setOpen((v) => !v)}>
        Machine state
      </button>
      {open && (
        <section role="dialog" aria-label="Machine state" style={PANEL_STYLE} data-testid="machine-state-panel">
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ fontSize: "var(--fl-fs-lg, 18px)", margin: 0 }}>Machine state</h2>
            <button type="button" style={{ ...BUTTON_STYLE, background: "var(--fl-surface)", color: "var(--fl-text)" }} onClick={() => setOpen(false)}>Close</button>
          </header>

          {readError && <p role="alert">{readError}</p>}
          {state && state.state.facts.length === 0 && <p data-testid="machine-state-empty">No technician reports for this machine yet.</p>}
          {state && state.state.facts.length > 0 && (
            <ul style={{ paddingInlineStart: 16 }} data-testid="machine-state-facts" data-state-version={state.state.stateVersion}>
              {state.state.facts.map((f) => <FactLine key={f.factKey} fact={f} />)}
            </ul>
          )}
          {state && (
            <p style={{ fontSize: "var(--fl-fs-sm)", color: "var(--fl-muted)" }} data-testid="machine-state-limits">
              Technician reports are not machine measurements. Root cause, machine health and safe-to-operate status are not established by them.
            </p>
          )}

          <h3 style={{ fontSize: "var(--fl-fs-md, 16px)" }}>Report what you see</h3>
          <label>
            Observation
            <textarea
              data-testid="observation-text" style={{ ...FIELD_STYLE, minHeight: 72 }} value={text}
              placeholder="e.g. seal leaking, observed at 09:10" onChange={(e) => setText(e.target.value)}
            />
          </label>
          <button type="button" style={BUTTON_STYLE} data-testid="observation-preview" onClick={onPreview} disabled={!text.trim() || phase.kind === "previewing" || phase.kind === "pending"}>
            {phase.kind === "previewing" ? "Reading…" : "Preview"}
          </button>

          {editing && (
            <div data-testid="observation-review" style={{ marginTop: 12 }}>
              <p>Check what MIRA understood, correct anything wrong, then confirm.</p>
              <label>
                What
                <select data-testid="observation-fact" style={FIELD_STYLE} value={editing.factKey ?? ""} disabled={phase.kind === "pending"} onChange={(e) => setPreview({ ...editing, factKey: (e.target.value || null) as ObservationPreview["factKey"] })}>
                  <option value="">Choose…</option>
                  <option value="seal_leak">Seal leak</option>
                  <option value="abnormal_noise">Abnormal noise</option>
                  <option value="vibration">Vibration</option>
                  <option value="overheating">Overheating</option>
                </select>
              </label>
              <label>
                Status
                <select data-testid="observation-value" style={FIELD_STYLE} value={editing.factValue ?? "present"} disabled={phase.kind === "pending"} onChange={(e) => setPreview({ ...editing, factValue: e.target.value as ObservationPreview["factValue"] })}>
                  <option value="present">Seen</option>
                  <option value="absent">Not seen</option>
                  <option value="repaired">Repair reported</option>
                </select>
              </label>
              <label>
                Observed at
                <input type="datetime-local" data-testid="observation-time" style={FIELD_STYLE} value={toLocalInput(editing.observedAt)} disabled={phase.kind === "pending"} onChange={(e) => setPreview({ ...editing, observedAt: fromLocalInput(e.target.value) })} />
              </label>
              <button type="button" style={BUTTON_STYLE} data-testid="observation-confirm" disabled={!editing.factKey || !editing.observedAt || phase.kind === "pending"} onClick={() => onConfirm(editing)}>
                {phase.kind === "pending" ? "Saving…" : phase.kind === "failed" ? "Retry" : "Confirm"}
              </button>
            </div>
          )}

          <p aria-live="polite" data-testid="observation-status" data-phase={phase.kind}>
            {phase.kind === "pending" && "Saving — not confirmed yet."}
            {phase.kind === "failed" && phase.message}
            {phase.kind === "confirmed" && "Confirmed. It is now part of this machine's state."}
          </p>
        </section>
      )}
    </>
  );
}
