"use client";
/**
 * WP-1 guided troubleshooting on the notebook (Hub adapter, outside the frozen legacy trees).
 * Shows one manufacturer step at a time with its page; the server decides every outcome and keeps
 * the session, so closing this panel (or the phone) and coming back resumes the same step.
 * Styling uses the shared --fl-* tokens only.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { API_BASE } from "@/lib/config";
import type { SessionView } from "@/capabilities/diagnostic-plan/guided";

type Applicability =
  | { applies: true; revision: "exact" | "not_attached"; notice: string }
  | { applies: false; reason: string; message: string };
type SessionPayload = { sessionId: string; recordCount: number; revision: string; view: SessionView; askMira: string | null } | null;
type Procedure = { templateId: string; title: string; applicability: Applicability; session: SessionPayload };

const S: Record<string, CSSProperties> = {
  pill: {
    position: "fixed", top: "calc(var(--fl-header, 56px) + 8px)", right: 12, zIndex: 40,
    background: "var(--fl-accent)", color: "var(--fl-accent-ink)", border: "none",
    borderRadius: "var(--fl-radius-pill, 999px)", padding: "8px 14px", fontSize: "var(--fl-fs-sm)",
    minHeight: 44, cursor: "pointer",
  },
  dialog: {
    border: "none", padding: 0, margin: "0 auto", width: "100%", maxWidth: 640, height: "100%", maxHeight: "100%",
    background: "var(--fl-surface)", color: "var(--fl-ink)",
  },
  sheet: { height: "100%", overflowY: "auto", padding: "var(--fl-pad, 16px)", boxSizing: "border-box", fontFamily: "var(--fl-font)" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12 },
  title: { fontSize: "var(--fl-fs)", fontWeight: 600, margin: 0 },
  muted: { color: "var(--fl-muted)", fontSize: "var(--fl-fs-xs)" },
  card: { border: "1px solid var(--fl-line)", borderRadius: "var(--fl-radius-card, 10px)", padding: 14, marginTop: 12 },
  warn: { background: "var(--fl-warn-bg)", border: "1px solid var(--fl-warn)", borderRadius: "var(--fl-radius-sm, 6px)", padding: 12, whiteSpace: "pre-wrap", fontSize: "var(--fl-fs-sm)" },
  cite: { color: "var(--fl-muted)", fontSize: "var(--fl-fs-xs)", marginTop: 8 },
  btn: {
    display: "block", width: "100%", textAlign: "left", marginTop: 8, padding: "12px 14px", minHeight: 44,
    border: "1px solid var(--fl-line-strong)", borderRadius: "var(--fl-radius, 8px)", background: "var(--fl-surface)",
    color: "var(--fl-ink)", fontSize: "var(--fl-fs-sm)", cursor: "pointer",
  },
  primary: { background: "var(--fl-accent)", color: "var(--fl-accent-ink)", borderColor: "var(--fl-accent)" },
  input: { width: "100%", boxSizing: "border-box", padding: 10, minHeight: 44, border: "1px solid var(--fl-line-strong)", borderRadius: "var(--fl-radius-sm, 6px)", fontSize: "var(--fl-fs)" },
  ok: { background: "var(--fl-ok-bg)", border: "1px solid var(--fl-ok)", borderRadius: "var(--fl-radius-sm, 6px)", padding: 12 },
  fault: { background: "var(--fl-fault-bg)", border: "1px solid var(--fl-fault)", borderRadius: "var(--fl-radius-sm, 6px)", padding: 12 },
};

const UNIT_LABEL: Record<string, string> = { ohm: "Ω", kohm: "kΩ" };

function Guidance({ g }: { g: NonNullable<SessionView["guidance"]> }) {
  return (
    <div data-testid="guided-guidance" style={S.card}>
      <strong style={{ fontSize: "var(--fl-fs-sm)" }}>Possible causes</strong>
      <ul style={{ margin: "6px 0 10px 18px", padding: 0, fontSize: "var(--fl-fs-sm)" }}>{g.causes.map((c) => <li key={c}>{c}</li>)}</ul>
      <strong style={{ fontSize: "var(--fl-fs-sm)" }}>Possible solutions</strong>
      <ul style={{ margin: "6px 0 0 18px", padding: 0, fontSize: "var(--fl-fs-sm)" }}>{g.solutions.map((s) => <li key={s}>{s}</li>)}</ul>
      <div style={S.cite}>From {g.cite.ref}, p.{g.cite.page}</div>
    </div>
  );
}

export function GuidedProcedure({ notebookId, onAskMira }: { notebookId: string; onAskMira: (question: string) => void }) {
  const [procs, setProcs] = useState<Procedure[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [readings, setReadings] = useState<Record<string, string>>({});
  const [unit, setUnit] = useState("ohm");
  const [note, setNote] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const url = `${API_BASE}/api/equipment-notebooks/${encodeURIComponent(notebookId)}/procedure/`;

  // A native modal <dialog> (Codex #4573 F5): the browser traps focus and closes it on Escape, and
  // the shell's Back handler closes an open dialog before anything underneath. Focus returns to
  // the button that opened it.
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(url, { credentials: "include", headers: { accept: "application/json" } });
      if (!res.ok) return setProcs([]);
      const body = (await res.json()) as { procedures?: Procedure[] };
      setProcs(body.procedures ?? []);
    } catch {
      setProcs([]);
    }
  }, [url]);
  useEffect(() => {
    setProcs(null);
    setOpen(false);
    void load();
  }, [load]);

  const proc = procs?.[0];
  if (!proc) return null;
  const session = proc.session;
  const view = session?.view;
  const step = view?.status === "active" ? view.step : undefined;

  async function call(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ templateId: proc!.templateId, ...body }),
      });
      const data = (await res.json().catch(() => ({}))) as { session?: SessionPayload; message?: string; error?: string };
      if (data.session) setProcs((p) => (p ? [{ ...p[0], session: data.session ?? null }, ...p.slice(1)] : p));
      if (!res.ok && res.status !== 409) setError(data.message ?? "That answer could not be saved. Try again.");
      if (res.status === 409 && !data.session) setError(data.message ?? "This session changed. Reload to continue.");
      setReadings({});
      setNote("");
    } catch {
      setError("No connection. Your progress is saved; try again when you're back online.");
    } finally {
      setBusy(false);
    }
  }
  const answer = (input: Record<string, unknown>) =>
    call({ op: "answer", sessionId: session!.sessionId, recordCount: session!.recordCount, input: { stepId: step!.id, ...input } });

  const pillLabel = !proc.applicability.applies
    ? "Guided troubleshooting unavailable"
    : view?.status === "active" && (view.history.length ?? 0) > 0 ? "Resume troubleshooting" : "Guided troubleshooting";

  return (
    <>
      <button type="button" ref={openerRef} data-testid="guided-open" style={S.pill} onClick={() => setOpen(true)}>{pillLabel}</button>
      <dialog
        ref={dialogRef}
        style={S.dialog}
        aria-label={proc.title}
        data-testid="guided-dialog"
        onClose={() => { setOpen(false); openerRef.current?.focus(); }}
      >
        {open && (
          <div style={S.sheet} data-testid="guided-sheet">
            <div style={S.head}>
              <div>
                <h2 style={S.title}>{proc.title}</h2>
                <div style={S.muted}>
                  {proc.applicability.applies ? proc.applicability.notice : proc.applicability.message}
                </div>
              </div>
              <button type="button" data-testid="guided-close" style={{ ...S.btn, width: "auto", marginTop: 0 }} onClick={() => setOpen(false)}>Close</button>
            </div>

            {proc.applicability.applies && !session && (
              <button type="button" data-testid="guided-start" disabled={busy} style={{ ...S.btn, ...S.primary }} onClick={() => call({ op: "start" })}>
                Start the manufacturer's troubleshooting
              </button>
            )}

            {view && view.history.length > 0 && (
              <details style={S.card} data-testid="guided-history">
                <summary style={{ fontSize: "var(--fl-fs-sm)" }}>Steps so far ({view.history.length})</summary>
                <ol style={{ margin: "8px 0 0 18px", padding: 0, fontSize: "var(--fl-fs-xs)" }}>
                  {view.history.map((h, i) => <li key={i}>{h.answer} <span style={S.muted}>(p.{h.page})</span></li>)}
                </ol>
              </details>
            )}

            {step && (
              <div style={S.card} data-testid={`guided-step-${step.id}`} data-step-kind={step.kind}>
                <div style={{ fontSize: "var(--fl-fs)", fontWeight: 600 }}>{step.prompt}</div>
                {step.safetyWording && <div style={{ ...S.warn, marginTop: 10 }} data-testid="guided-safety">{step.safetyWording}</div>}
                {step.expected && <div style={{ ...S.muted, marginTop: 8 }}>{step.expected}</div>}

                {step.kind === "safety" && (
                  <>
                    <button type="button" data-testid="guided-ack" disabled={busy} style={{ ...S.btn, ...S.primary }} onClick={() => answer({ kind: "acknowledge", acknowledged: true })}>I have read these and will follow them</button>
                    <button type="button" data-testid="guided-decline" disabled={busy} style={S.btn} onClick={() => answer({ kind: "acknowledge", acknowledged: false })}>I can't do this safely</button>
                  </>
                )}

                {step.kind === "isolation" && (
                  <>
                    <label style={{ display: "block", marginTop: 10, fontSize: "var(--fl-fs-sm)" }}>
                      Name of the person confirming
                      <input data-testid="guided-name" style={S.input} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                    </label>
                    <button type="button" data-testid="guided-isolated" disabled={busy || !name.trim()} style={{ ...S.btn, ...S.primary }} onClick={() => answer({ kind: "isolation", confirmed: true, reportedBy: name })}>Main power is disconnected</button>
                    <button type="button" data-testid="guided-not-isolated" disabled={busy || !name.trim()} style={S.btn} onClick={() => answer({ kind: "isolation", confirmed: false, reportedBy: name })}>It is not disconnected</button>
                  </>
                )}

                {step.kind === "choice" && (
                  <>
                    {step.options?.map((o) => (
                      <button type="button" key={o.key} data-testid={`guided-choice-${o.key}`} disabled={busy} style={S.btn} onClick={() => answer({ kind: "choice", choice: o.key })}>{o.label}</button>
                    ))}
                    <button type="button" data-testid="guided-choice-none" disabled={busy} style={{ ...S.btn, color: "var(--fl-muted)" }} onClick={() => answer({ kind: "choice", choice: null })}>None of these</button>
                  </>
                )}

                {step.kind === "measure" && step.measure && (
                  <form onSubmit={(e) => { e.preventDefault(); void answer({ kind: "measurement", readings: step.measure!.points.map((point) => ({ point, value: Number(readings[point]), unit })) }); }}>
                    <label style={{ display: "block", marginTop: 10, fontSize: "var(--fl-fs-sm)" }}>
                      Unit
                      <select data-testid="guided-unit" style={S.input} value={unit} onChange={(e) => setUnit(e.target.value)}>
                        {Object.entries(UNIT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </label>
                    {step.measure.points.map((point) => (
                      <label key={point} style={{ display: "block", marginTop: 10, fontSize: "var(--fl-fs-sm)" }}>
                        {point}
                        <input data-testid={`guided-reading-${point}`} style={S.input} inputMode="decimal" value={readings[point] ?? ""} onChange={(e) => setReadings((r) => ({ ...r, [point]: e.target.value }))} />
                      </label>
                    ))}
                    <button type="submit" data-testid="guided-submit-readings" disabled={busy || step.measure.points.some((p) => !(readings[p] ?? "").trim())} style={{ ...S.btn, ...S.primary }}>Record readings</button>
                  </form>
                )}

                {step.kind === "result" && (
                  <>
                    {step.guidance && <Guidance g={step.guidance} />}
                    <label style={{ display: "block", marginTop: 10, fontSize: "var(--fl-fs-sm)" }}>
                      What you found (optional)
                      <input data-testid="guided-note" style={S.input} value={note} onChange={(e) => setNote(e.target.value)} />
                    </label>
                    <button type="button" data-testid="guided-fixed" disabled={busy} style={{ ...S.btn, ...S.primary }} onClick={() => answer({ kind: "result", fixed: true, note })}>That fixed it</button>
                    <button type="button" data-testid="guided-not-fixed" disabled={busy} style={S.btn} onClick={() => answer({ kind: "result", fixed: false, note })}>Still not fixed</button>
                  </>
                )}

                <div style={S.cite} data-testid="guided-cite">{step.cite.publication} · p.{step.cite.page} · {step.cite.ref}</div>
              </div>
            )}

            {view && view.status !== "active" && (
              <div style={{ marginTop: 12 }} data-testid="guided-end" data-status={view.status}>
                <div style={view.status === "resolved" ? S.ok : view.status === "escalate" ? S.warn : S.fault}>{view.endReason}</div>
                {view.guidance && <Guidance g={view.guidance} />}
                {view.status === "escalate" && session?.askMira && (
                  <button type="button" data-testid="guided-ask-mira" style={{ ...S.btn, ...S.primary }} onClick={() => { setOpen(false); onAskMira(session.askMira!); }}>
                    Ask MIRA about this (beyond the manual)
                  </button>
                )}
                <button type="button" data-testid="guided-restart" disabled={busy} style={S.btn} onClick={() => call({ op: "restart" })}>Start again</button>
              </div>
            )}

            {error && <div role="alert" style={{ ...S.fault, marginTop: 12 }} data-testid="guided-error">{error}</div>}
          </div>
        )}
      </dialog>
    </>
  );
}
