"use client";

/**
 * Bench components on the tablet: "Asking about …", the component checklist,
 * the one confirmation card, and the Return / Switch / Stay / Confirm offers a
 * reply comes back with. Logic and every request shape: bench-components-logic.ts.
 *
 * Renders nothing when the components routes are not there (404/503), so a
 * build that reaches a database without migration 115 is unchanged.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { API_BASE } from "@/lib/config";
import { exactMatches, lookAlikes, type LookAlike } from "@/capabilities/bench-components/lookalike";
import {
  lastAnswerNotice,
  CARD_FIELDS,
  CONNECTION_MESSAGE,
  CHANGE_BLOCKED_MESSAGE,
  WHOLE_MACHINE,
  actionLabel,
  addRequestFor,
  askingAbout,
  cardFor,
  cardIsEmpty,
  changeSelection,
  componentErrorMessage,
  readBench,
  reconcileBench,
  retakeCard,
  revisionBodyFor,
  selectedComponent,
  selectionChangeFor,
  statusTone,
  type AddRequest,
  type BenchSendGate,
  type BenchState,
  type Card,
  type ComponentAction,
  type ComponentTurnFrame,
  type ComponentView,
} from "./bench-components-logic";

const PILL_STYLE: CSSProperties = {
  background: "var(--fl-surface)", color: "var(--fl-ink)", border: "1px solid var(--fl-line)",
  borderRadius: "var(--fl-radius-pill, 999px)", padding: "8px 14px", fontSize: "var(--fl-fs-sm)",
  minHeight: 44, maxWidth: "min(80vw, 360px)", cursor: "pointer", textAlign: "start",
};
const PANEL_STYLE: CSSProperties = {
  position: "fixed", inset: "auto 0 0 0", maxHeight: "85vh", overflowY: "auto", zIndex: 60,
  background: "var(--fl-surface)", color: "var(--fl-ink)", borderTop: "1px solid var(--fl-line)",
  boxShadow: "var(--fl-shadow)", padding: "var(--fl-space-4, 16px)", fontFamily: "var(--fl-font)",
};
const FIELD_STYLE: CSSProperties = {
  display: "block", width: "100%", minHeight: 44, marginTop: 4, padding: 8, boxSizing: "border-box",
  border: "1px solid var(--fl-line)", borderRadius: "var(--fl-radius)", background: "var(--fl-surface)",
  color: "var(--fl-ink)", fontSize: "var(--fl-fs-body, 16px)",
};
const BUTTON_STYLE: CSSProperties = {
  minHeight: 44, padding: "8px 16px", marginInlineEnd: 8, marginTop: 8, borderRadius: "var(--fl-radius)",
  border: "1px solid var(--fl-line)", background: "var(--fl-accent)", color: "var(--fl-accent-ink, var(--fl-surface))", cursor: "pointer",
};
const QUIET_BUTTON: CSSProperties = { ...BUTTON_STYLE, background: "var(--fl-surface)", color: "var(--fl-ink)" };
const CHIP: Record<"ok" | "warn" | "muted", CSSProperties> = {
  ok: { background: "var(--fl-ok-bg)", color: "var(--fl-ok-ink, var(--fl-ok))" },
  warn: { background: "var(--fl-warn-bg)", color: "var(--fl-warn)" },
  muted: { background: "var(--fl-bg)", color: "var(--fl-muted)" },
};
const CHIP_BASE: CSSProperties = { borderRadius: "var(--fl-radius-pill, 999px)", padding: "2px 8px", fontSize: "var(--fl-fs-xs)", marginInlineStart: 8 };

const base = (notebookId: string) => `${API_BASE}/api/equipment-notebooks/${encodeURIComponent(notebookId)}/components/`;

async function errorCode(res: Response): Promise<string> {
  try {
    return String(((await res.json()) as { error?: unknown }).error ?? "");
  } catch {
    return "";
  }
}

export function BenchComponents({
  notebookId,
  threadId,
  refresh,
  busy,
  frame,
  gate,
  onState,
}: {
  notebookId: string;
  threadId: string;
  /** Bumped by the host after every chat turn (tallies, a correction made by a reply). */
  refresh: number;
  /** An answer is coming in: the component can't change until it has (#5504 Codex F1). */
  busy: boolean;
  /** The component frame of this conversation's newest reply, if it had one. */
  frame: ComponentTurnFrame | null;
  /** Shared with the host's send path: a change and a send never overlap (#5504 Codex r2). */
  gate: BenchSendGate;
  /** The state the header shows — the host builds the chat rider from it. */
  onState: (state: BenchState | null) => void;
}) {
  const [bench, setBench] = useState<BenchState | null>(null);
  const [available, setAvailable] = useState(true);
  const [open, setOpen] = useState(false);
  const [card, setCard] = useState<Card | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState({ localTag: "", kind: "", rawLabel: "" });
  const [handled, setHandled] = useState<ComponentTurnFrame | null>(null);
  const addRequest = useRef<AddRequest | null>(null);

  // #5504 Codex r3 F6: the host refuses a send until this read has answered (or the
  // checklist is known to be unavailable), so a saved component is never skipped.
  const load = useCallback(async (): Promise<BenchState | null> => {
    const out = await readBench({
      gate,
      fetch: (url, init) => fetch(url, init),
      url: `${base(notebookId)}?threadId=${encodeURIComponent(threadId)}`,
      apply: onState,
    });
    if (out.kind === "unavailable") {
      setAvailable(false);
      return null;
    }
    if (out.kind === "failed") {
      setMessage("The component list couldn't be read just now.");
      return null;
    }
    if (out.kind === "stale") return null;
    setAvailable(true);
    setBench(out.state);
    return out.state;
  }, [notebookId, threadId, onState, gate]);

  useEffect(() => {
    void load();
  }, [load, refresh]);

  const select = useCallback(
    async (componentId: string | null, via: "picker" | "return" | "clarify" | "confirm"): Promise<boolean> => {
      setSaving(true);
      setMessage(null);
      try {
        const out = await changeSelection({
          gate,
          fetch: (url, init) => fetch(url, init),
          url: `${base(notebookId)}selection/`,
          body: { threadId, componentId, via, expectedVersion: bench?.selectionVersion ?? null, clientRequestId: crypto.randomUUID() },
          load,
        });
        if (!out.ok) setMessage(out.message);
        return out.ok;
      } finally {
        setSaving(false);
      }
    },
    [notebookId, threadId, bench, load, gate],
  );

  const onAction = useCallback(
    async (a: ComponentAction) => {
      setHandled(frame);
      const change = selectionChangeFor(a);
      if (change) {
        await select(change.componentId, change.via);
        return;
      }
      const c = bench?.components.find((x) => x.id === a.componentId);
      if (c) {
        setCard(cardFor(c));
        setOpen(true);
      }
    },
    [frame, bench, select],
  );

  const saveCard = useCallback(
    async (confirm: boolean) => {
      if (!card) return;
      if (!gate.tryBeginChange()) {
        setMessage(CHANGE_BLOCKED_MESSAGE);
        return;
      }
      setSaving(true);
      setMessage(null);
      try {
        const res = await fetch(`${base(notebookId)}${encodeURIComponent(card.componentId)}/revisions/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(revisionBodyFor(card, confirm, threadId, crypto.randomUUID())),
        });
        if (!res.ok) {
          const code = await errorCode(res);
          setMessage(componentErrorMessage(code));
          gate.invalidate();
          const next = await load();
          const now = next?.components.find((c) => c.id === card.componentId);
          if (code === "component_changed" && now) setCard(cardFor(now));
          return;
        }
        setCard(null);
        // #5504 post-cap F9: a revision may commit even when its reply is lost, so Send stays
        // refused until a read that began after it settled has succeeded.
        if (!(await reconcileBench(gate, load))) {
          setMessage(CONNECTION_MESSAGE);
          return;
        }
        setMessage(confirm ? "Confirmed. Questions about it now use what you confirmed." : "Saved — not confirmed yet.");
      } catch {
        setMessage(CONNECTION_MESSAGE);
        await reconcileBench(gate, load);
      } finally {
        gate.endChange();
        setSaving(false);
      }
    },
    [card, notebookId, threadId, load, gate],
  );

  const add = useCallback(async () => {
    if (!gate.tryBeginChange()) {
      setMessage(CHANGE_BLOCKED_MESSAGE);
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const rawLabel = adding.rawLabel.trim();
      const draft = {
        origin: "technician",
        kind: adding.kind.trim() || null,
        revision: { rawLabel: rawLabel || null, localTag: adding.localTag.trim() || null, inputKind: "typed" },
      };
      const request = addRequestFor(addRequest.current, JSON.stringify(draft), () => crypto.randomUUID());
      addRequest.current = request;
      const res = await fetch(base(notebookId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, clientRequestId: request.id, position: bench?.components.length ?? 0 }),
      });
      if (!res.ok) {
        setMessage(componentErrorMessage(await errorCode(res)));
        return;
      }
      addRequest.current = null;
      setAdding({ localTag: "", kind: "", rawLabel: "" });
      const next = await load();
      const { componentId } = (await res.json().catch(() => ({}))) as { componentId?: string };
      const created = next?.components.find((c) => c.id === componentId);
      if (created) setCard(cardFor(created));
    } catch {
      setMessage(CONNECTION_MESSAGE);
    } finally {
      gate.endChange();
      setSaving(false);
    }
  }, [adding, bench, notebookId, load, gate]);

  const current = selectedComponent(bench);
  const actions = frame && frame !== handled ? frame.actions : [];

  if (!available) return null;

  return (
    <>
      <button type="button" style={PILL_STYLE} data-testid="bench-asking-about" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {askingAbout(bench)}
        {bench?.selection && !bench.selection.current && " (identity changed — next question re-checks it)"}
      </button>
      {lastAnswerNotice(bench) && (
        <p role="status" data-testid="bench-last-answer" style={{ margin: 0, fontSize: "var(--fl-fs-sm)", color: "var(--fl-warn, var(--fl-muted))" }}>
          {lastAnswerNotice(bench)}
        </p>
      )}
      {actions.length > 0 && (
        <div data-testid="bench-component-actions" role="group" aria-label="What to do next" style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {actions.map((a) => (
            <button key={`${a.action}-${a.componentId}`} type="button" style={a.action === "stay" ? QUIET_BUTTON : BUTTON_STYLE} disabled={saving || busy} data-testid={`bench-action-${a.action}`} onClick={() => void onAction(a)}>
              {actionLabel(a)}
            </button>
          ))}
        </div>
      )}
      {open && (
        <section role="dialog" aria-label="Components" style={PANEL_STYLE} data-testid="bench-components-panel">
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ fontSize: "var(--fl-fs-title, 18px)", margin: 0 }}>Components</h2>
            <button type="button" style={QUIET_BUTTON} onClick={() => { setOpen(false); setCard(null); }}>Close</button>
          </header>
          <p data-testid="bench-panel-asking">{askingAbout(bench)}</p>
          {message && <p role="status" data-testid="bench-message">{message}</p>}

          {card ? (
            <ConfirmationCard card={card} onChange={setCard} known={bench?.documentNumbers ?? []} saving={saving} onSave={saveCard} onCancel={() => setCard(null)} />
          ) : (
            <>
              <button type="button" style={QUIET_BUTTON} disabled={saving || busy || !current} data-testid="bench-whole-machine" onClick={() => void select(null, "picker")}>
                {WHOLE_MACHINE.replace(" — no component selected", "")}
              </button>
              <ul style={{ listStyle: "none", padding: 0 }} data-testid="bench-component-list">
                {(bench?.components ?? []).filter((c) => c.status !== "retired").map((c) => (
                  <ComponentRow
                    key={c.id}
                    c={c}
                    selected={current?.id === c.id}
                    tally={bench?.tallies[c.id]}
                    saving={saving || busy}
                    onAsk={async () => {
                      const ok = await select(c.id, "picker");
                      if (ok && c.status !== "confirmed") setCard(cardFor(c));
                    }}
                    onCheck={() => setCard(cardFor(c))}
                  />
                ))}
              </ul>
              <h3 style={{ fontSize: "var(--fl-fs-body, 16px)" }}>Add a component</h3>
              <label>Local tag<input data-testid="bench-add-tag" style={FIELD_STYLE} value={adding.localTag} onChange={(e) => setAdding({ ...adding, localTag: e.target.value })} placeholder="e.g. VFD1" /></label>
              <label>What it is<input data-testid="bench-add-kind" style={FIELD_STYLE} value={adding.kind} onChange={(e) => setAdding({ ...adding, kind: e.target.value })} placeholder="e.g. drive, contactor, photo-eye" /></label>
              <label>What the label says<textarea data-testid="bench-add-label" style={{ ...FIELD_STYLE, minHeight: 64 }} value={adding.rawLabel} onChange={(e) => setAdding({ ...adding, rawLabel: e.target.value })} /></label>
              <button type="button" style={BUTTON_STYLE} data-testid="bench-add" disabled={saving || (!adding.localTag.trim() && !adding.kind.trim() && !adding.rawLabel.trim())} onClick={() => void add()}>
                Add
              </button>
            </>
          )}
        </section>
      )}
    </>
  );
}

export function ComponentRow({ c, selected, tally, saving, onAsk, onCheck }: {
  c: ComponentView;
  selected: boolean;
  tally: { answered: number; refused: number } | undefined;
  saving: boolean;
  onAsk: () => void;
  onCheck: () => void;
}) {
  // Selected for this project, names this number, and searchable: only then is it this component's manual.
  const own = c.documents.filter((d) => d.selected && d.model === "covers" && d.ready);
  const unselected = c.documents.filter((d) => !d.selected && d.model === "covers");
  return (
    <li data-testid={`bench-component-${c.id}`} data-status={c.status} style={{ borderTop: "1px solid var(--fl-line)", padding: "8px 0" }}>
      <div>
        <strong>{c.label}</strong>
        <span style={{ ...CHIP_BASE, ...CHIP[statusTone(c.status)] }} data-testid="bench-status">{c.statusLabel}</span>
        {selected && <span style={{ ...CHIP_BASE, ...CHIP.muted }}>this chat</span>}
      </div>
      <div style={{ fontSize: "var(--fl-fs-sm)", color: "var(--fl-muted)" }}>
        {c.status !== "confirmed"
          ? "Manuals are not checked until its identity is confirmed."
          : own.length > 0
            ? `Manual: ${own.map((d) => d.filename ?? "attached document").join(", ")}`
            : unselected.length > 0
              ? `${unselected.map((d) => d.filename ?? "An attached document").join(", ")} names its number but is not selected for this project.`
              : "No attached manual names its number."}
        {tally && ` · answered ${tally.answered} · refused ${tally.refused} in this chat`}
      </div>
      <div style={{ fontSize: "var(--fl-fs-sm)", color: "var(--fl-muted)" }} data-testid="bench-evidence">Evidence: {c.evidence}</div>
      <button type="button" style={BUTTON_STYLE} disabled={saving || selected} onClick={onAsk}>Ask about this</button>
      <button type="button" style={QUIET_BUTTON} disabled={saving} onClick={onCheck}>{c.status === "confirmed" ? "Edit label" : "Check label"}</button>
    </li>
  );
}

function DiffText({ c }: { c: LookAlike }) {
  return (
    <span data-testid="bench-lookalike-diff" style={{ fontFamily: "var(--fl-mono)" }}>
      {c.diff.map((s, i) =>
        s.kind === "same" ? (
          <span key={i}>{s.text}</span>
        ) : s.kind === "missing" ? (
          <del key={i} style={{ color: "var(--fl-warn)" }} title={`you typed ${s.typed}`}>{s.typed}</del>
        ) : (
          <mark key={i} style={{ background: "var(--fl-warn-bg)", color: "var(--fl-warn)" }} title={s.kind === "changed" ? `you typed ${s.typed}` : "not in what you typed"}>{s.text}</mark>
        ),
      )}
    </span>
  );
}

export function ConfirmationCard({ card, onChange, known, saving, onSave, onCancel }: {
  card: Card;
  onChange: (card: Card) => void;
  known: readonly { label: string; from: string }[];
  saving: boolean;
  onSave: (confirm: boolean) => void;
  onCancel: () => void;
}) {
  const typed = card.notSure.catalogNumber ? "" : card.values.catalogNumber;
  const candidates = useMemo(() => (typed.trim() ? lookAlikes(typed, known) : []), [typed, known]);
  const exact = useMemo(() => (typed.trim() ? exactMatches(typed, known) : []), [typed, known]);
  const set = (field: (typeof CARD_FIELDS)[number][0], value: string) => onChange({ ...card, values: { ...card.values, [field]: value } });
  return (
    <div data-testid="bench-card">
      <p>Check each field against the label. Leave a field empty or tick Not sure — nothing is filled in for you.</p>
      <label>
        What the label says (exactly as written)
        <textarea data-testid="bench-card-raw" style={{ ...FIELD_STYLE, minHeight: 64 }} value={card.rawLabel} onChange={(e) => onChange({ ...card, rawLabel: e.target.value })} />
      </label>
      {CARD_FIELDS.map(([field, label]) => (
        <div key={field} style={{ marginTop: 8 }}>
          <label>
            {label}
            <input data-testid={`bench-card-${field}`} style={FIELD_STYLE} value={card.values[field]} disabled={card.notSure[field]} onChange={(e) => set(field, e.target.value)} />
          </label>
          <label style={{ fontSize: "var(--fl-fs-sm)" }}>
            <input type="checkbox" data-testid={`bench-card-${field}-notsure`} checked={card.notSure[field]} onChange={(e) => onChange({ ...card, notSure: { ...card.notSure, [field]: e.target.checked } })} /> Not sure
          </label>
          {field === "catalogNumber" && exact.length > 0 && (
            <p data-testid="bench-card-exact" style={{ fontSize: "var(--fl-fs-sm)", color: "var(--fl-ok)" }}>Written exactly like this in {exact.join(", ")}.</p>
          )}
          {field === "catalogNumber" && candidates.length > 0 && (
            <div data-testid="bench-card-lookalikes" style={{ fontSize: "var(--fl-fs-sm)" }}>
              <p style={{ margin: "4px 0" }}>Close to a number in the attached documents. Check the label — these are different numbers:</p>
              {candidates.map((c) => (
                <div key={c.label} style={{ marginBottom: 4 }}>
                  <DiffText c={c} /> <span style={{ color: "var(--fl-muted)" }}>({c.from}) — {c.summary}</span>{" "}
                  <button type="button" style={QUIET_BUTTON} onClick={() => set("catalogNumber", c.label)}>The label says {c.label}</button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      <div>
        <button type="button" style={BUTTON_STYLE} data-testid="bench-card-confirm" disabled={saving || cardIsEmpty(card)} onClick={() => onSave(true)}>Confirm</button>
        <button type="button" style={QUIET_BUTTON} data-testid="bench-card-save" disabled={saving || cardIsEmpty(card)} onClick={() => onSave(false)}>Save, not confirmed</button>
        <button type="button" style={QUIET_BUTTON} data-testid="bench-card-retake" disabled={saving} onClick={() => onChange(retakeCard(card))}>Retake</button>
        <button type="button" style={QUIET_BUTTON} disabled={saving} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
