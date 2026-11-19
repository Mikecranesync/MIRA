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
  focusStep,
  readBench,
  readSameSerialNotice,
  reconcileBench,
  reportSameSerial,
  retakeCard,
  revisionBodyFor,
  sameSerialButtonName,
  sameSerialNoticeCurrent,
  sameSerialPlace,
  sameSerialTarget,
  savedNotRefreshedMessage,
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
  type SameSerialMatch,
  type SameSerialNotice,
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
  border: "1px solid var(--fl-line)", background: "var(--fl-accent)", color: "var(--fl-surface)", cursor: "pointer",
};
const QUIET_BUTTON: CSSProperties = { ...BUTTON_STYLE, background: "var(--fl-surface)", color: "var(--fl-ink)" };
const CHIP: Record<"ok" | "warn" | "muted", CSSProperties> = {
  ok: { background: "var(--fl-ok-bg)", color: "var(--fl-ok-ink, var(--fl-ok))" },
  warn: { background: "var(--fl-warn-bg)", color: "var(--fl-warn)" },
  muted: { background: "var(--fl-bg)", color: "var(--fl-muted)" },
};
const CHIP_BASE: CSSProperties = { borderRadius: "var(--fl-radius-pill, 999px)", padding: "2px 8px", fontSize: "var(--fl-fs-xs)", marginInlineStart: 8 };
// Amber is the warning state (ui-style rule 3). The text stays ink so it reads on the amber ground.
const SERIAL_WARNING_STYLE: CSSProperties = {
  margin: "8px 0", padding: "var(--fl-space-3, 12px)", borderRadius: "var(--fl-radius)",
  border: "1px solid var(--fl-warn)", background: "var(--fl-warn-bg)", color: "var(--fl-ink)",
};

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
  focus = null,
  onFocusDone,
  onOpenEquipment,
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
  /**
   * A component the equipment navigator found for this conversation (#5625 r2, Mike's B): the
   * checklist opens on it, once, and the technician selects it here. Nothing is written for it.
   */
  focus?: { componentId: string; token: number } | null;
  /** How the hand-off ended; the host drops it then, so a remounted checklist never shows it again. */
  onFocusDone?: (token: number, outcome: { ok: true } | { ok: false; message: string }) => void;
  /**
   * Opens a component the repeated-serial warning names (#5649), through the host's equipment
   * hand-off: the same routes and rules as a Find equipment answer. Without it, matches are named only.
   */
  onOpenEquipment?: (target: ReturnType<typeof sameSerialTarget>) => void;
}) {
  const [bench, setBench] = useState<BenchState | null>(null);
  const [available, setAvailable] = useState(true);
  const [open, setOpen] = useState(false);
  const [card, setCard] = useState<Card | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState({ localTag: "", kind: "", rawLabel: "" });
  const [handled, setHandled] = useState<ComponentTurnFrame | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  // Counts every component shown, so showing the one that is already marked scrolls to it again (#5657 F4).
  const [shown, setShown] = useState(0);
  // #5649: what the last confirmed save's reply said about its serial number on other components.
  const [serialNotice, setSerialNotice] = useState<SameSerialNotice | null>(null);
  // Which save that notice may come from. A new save, closing the sheet and opening a label all move
  // it on, so a reply that is read late is not shown for a save the technician has already moved past.
  const serialSave = useRef(0);
  const addRequest = useRef<AddRequest | null>(null);

  // #5504 Codex r3 F6: the host refuses a send until this read has answered (or the
  // checklist is known to be unavailable), so a saved component is never skipped.
  // #5504 post-cap F10: a read still in flight when this conversation is left applies nothing.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const load = useCallback(async (): Promise<BenchState | null> => {
    const out = await readBench({
      gate,
      fetch: (url, init) => fetch(url, init),
      url: `${base(notebookId)}?threadId=${encodeURIComponent(threadId)}`,
      apply: (state) => {
        if (alive.current) onState(state);
      },
    });
    if (!alive.current) return null;
    if (out.kind === "unavailable") {
      setAvailable(false);
      return null;
    }
    if (out.kind === "failed") {
      setMessage("The component list couldn't be read just now.");
      setReadFailed(true);
      return null;
    }
    if (out.kind === "stale") return null;
    setReadFailed(false);
    setAvailable(true);
    setBench(out.state);
    return out.state;
  }, [notebookId, threadId, onState, gate]);

  useEffect(() => {
    void load();
  }, [load, refresh]);

  const select = useCallback(
    async (
      componentId: string | null,
      via: "picker" | "return" | "clarify" | "confirm",
      seen?: { expectedVersion: number | null; expectedRevision: number | null },
    ): Promise<{ ok: true } | { ok: false; message: string }> => {
      setSaving(true);
      setMessage(null);
      try {
        const out = await changeSelection({
          gate,
          fetch: (url, init) => fetch(url, init),
          url: `${base(notebookId)}selection/`,
          body: {
            threadId,
            componentId,
            via,
            expectedVersion: seen ? seen.expectedVersion : bench?.selectionVersion ?? null,
            ...(seen && seen.expectedRevision !== null ? { expectedRevision: seen.expectedRevision } : {}),
            clientRequestId: crypto.randomUUID(),
          },
          load,
        });
        if (!out.ok) setMessage(out.message);
        return out;
      } finally {
        setSaving(false);
      }
    },
    [notebookId, threadId, bench, load, gate],
  );

  // The navigator never writes a selection: it opens the checklist on what it found.
  const consumedFocus = useRef(new Set<number>());
  // One fresh read per hand-off before a component is called missing or the read failed (#5625 r3 F13, r4 F16).
  const reread = useRef(new Map<number, "pending" | "done">());
  const [rereadDone, setRereadDone] = useState(0);
  useEffect(() => {
    const again = focus ? reread.current.get(focus.token) : undefined;
    if (again === "pending") return;
    const step = focusStep(focus, consumedFocus.current, { bench, available, readFailed, reread: again === "done", editing: card !== null });
    if (!focus || step === "none" || step === "wait") return;
    if (step === "refresh") {
      const token = focus.token;
      reread.current.set(token, "pending");
      void load().finally(() => {
        reread.current.set(token, "done");
        if (alive.current) setRereadDone((n) => n + 1);
      });
      return;
    }
    consumedFocus.current.add(focus.token);
    if (step === "show") {
      setFocused(focus.componentId);
      setShown((n) => n + 1);
      setOpen(true);
      onFocusDone?.(focus.token, { ok: true });
      return;
    }
    const text = step === "missing"
      ? "That component isn't in this machine's checklist. Nothing was changed."
      : step === "failed"
        ? "The component list couldn't be read, so the component wasn't shown. Nothing was changed."
        : "The component list isn't available here, so the component wasn't shown. Nothing was changed.";
    setMessage(text);
    onFocusDone?.(focus.token, { ok: false, message: text });
  }, [focus, bench, available, readFailed, onFocusDone, load, rereadDone, card]);
  // Close is the technician saying they're done: a hand-off still waiting on an open label editor is
  // dropped, not replayed once the editor goes away (#5637). Save and the editor's Cancel keep it.
  const closeChecklist = useCallback(() => {
    if (focus && !consumedFocus.current.has(focus.token)) {
      consumedFocus.current.add(focus.token);
      onFocusDone?.(focus.token, { ok: true });
    }
    setOpen(false);
    setCard(null);
    setFocused(null);
    serialSave.current += 1;
    setSerialNotice(null);
  }, [focus, onFocusDone]);
  // The pill closes the sheet as well as opening it. Closing it ends a repeated-serial warning as Close
  // does, shown or still on its way; everything else about the sheet is left as it was.
  const togglePanel = useCallback(() => {
    if (open) {
      serialSave.current += 1;
      setSerialNotice(null);
    }
    setOpen(!open);
  }, [open]);
  // The warning belongs to the save it came from: opening any label to edit takes it away, so it cannot
  // come back when that card is cancelled. Adjusted while rendering, which React re-renders at once.
  if (card && serialNotice) setSerialNotice(null);
  // It is also about one revision only (#5656): once the checklist holds a later one, corrected here
  // or on another screen, the label beside the warning is no longer the one that was checked.
  else if (serialNotice && !sameSerialNoticeCurrent(serialNotice, bench)) setSerialNotice(null);
  // The same holds for a warning still on its way: once a label has been opened it is not shown,
  // whether its reply is read while the card is open or after the card is gone.
  const cardOpen = card !== null;
  useEffect(() => {
    if (cardOpen) serialSave.current += 1;
  }, [cardOpen]);
  // Confirm is at the bottom of the card and the save's result is at the top of the sheet, so on a short
  // screen the result would be left above the visible part. Bring it back into view, as a found row is.
  useEffect(() => {
    if (!serialNotice) return;
    // The warning starts directly under the save's own line, so bringing that line into view brings
    // the start of the warning with it. The later rows of a long warning are reached by scrolling.
    document.querySelector('[data-testid="bench-message"]')?.scrollIntoView?.({ block: "nearest" });
  }, [serialNotice]);
  useEffect(() => {
    if (open && focused) document.querySelector(`[data-testid="bench-component-${focused}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, focused, shown]);

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
      setSerialNotice(null);
      const save = ++serialSave.current;
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
        // #5649: the reply of a confirmed save says whether its serial number is already on other
        // components. It is read alongside the re-read below. It can neither fail the save nor hold its
        // result back: readSameSerialNotice never throws, and reportSameSerial does not wait for it.
        const serial = confirm ? readSameSerialNotice(res, { notebookId, componentId: card.componentId }) : null;
        setCard(null);
        // #5504 post-cap F9: a revision may commit even when its reply is lost, so Send stays
        // refused until a read that began after it settled has succeeded.
        const reread = await reconcileBench(gate, load);
        // The save is committed whether or not the re-read worked, so what its reply said still stands.
        // A reply read by now is shown together with the result below. One still on its way is shown
        // when it arrives, unless the sheet was closed, a label was opened or another save began meanwhile.
        if (serial) {
          await reportSameSerial(serial, (notice) => {
            if (alive.current && serialSave.current === save) setSerialNotice(notice);
          });
        }
        if (!reread) {
          // The server answered that the save is committed; only the list is out of date (#5661 A2).
          setMessage(savedNotRefreshedMessage(confirm));
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
      <button type="button" style={PILL_STYLE} data-testid="bench-asking-about" aria-expanded={open} onClick={togglePanel}>
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
            <button type="button" style={QUIET_BUTTON} onClick={closeChecklist}>Close</button>
          </header>
          <p data-testid="bench-panel-asking">{askingAbout(bench)}</p>
          {message && <p role="status" data-testid="bench-message">{message}</p>}
          {!card && serialNotice && (
            <SameSerialWarning
              notice={serialNotice}
              savedLabel={bench?.components.find((c) => c.id === serialNotice.componentId)?.label ?? null}
              disabled={saving || busy}
              onOpen={onOpenEquipment ? (match) => onOpenEquipment(sameSerialTarget(match)) : undefined}
              onDismiss={() => setSerialNotice(null)}
            />
          )}

          {card && focus && !consumedFocus.current.has(focus.token) && (
            <p role="status" data-testid="bench-focus-waiting">
              {`${bench?.components.find((c) => c.id === focus.componentId)?.label ?? "The component you found"} will be shown when you finish this label.`}
            </p>
          )}
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
                    found={focused === c.id}
                    tally={bench?.tallies[c.id]}
                    saving={saving || busy}
                    onAsk={async () => {
                      // Checked against what this row shows (#5625 r2 F4): a record corrected since is refused.
                      const out = await select(c.id, "picker", { expectedVersion: bench?.selectionVersion ?? null, expectedRevision: c.current?.revision ?? null });
                      if (out.ok && c.status !== "confirmed") setCard(cardFor(c));
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

export function ComponentRow({ c, selected, found = false, tally, saving, onAsk, onCheck }: {
  c: ComponentView;
  selected: boolean;
  /** Opened from Find equipment: marked so the technician sees which row was found. */
  found?: boolean;
  tally: { answered: number; refused: number } | undefined;
  saving: boolean;
  onAsk: () => void;
  onCheck: () => void;
}) {
  // Selected for this project, names this number, and searchable: only then is it this component's manual.
  const own = c.documents.filter((d) => d.selected && d.model === "covers" && d.ready);
  const unselected = c.documents.filter((d) => !d.selected && d.model === "covers");
  return (
    <li
      data-testid={`bench-component-${c.id}`}
      data-status={c.status}
      data-found={found ? "true" : undefined}
      style={{ borderTop: "1px solid var(--fl-line)", padding: "8px 0", ...(found ? { outline: "2px solid var(--fl-accent)", outlineOffset: 2 } : {}) }}
    >
      <div>
        <strong>{c.label}</strong>
        <span style={{ ...CHIP_BASE, ...CHIP[statusTone(c.status)] }} data-testid="bench-status">{c.statusLabel}</span>
        {selected && <span style={{ ...CHIP_BASE, ...CHIP.muted }}>this chat</span>}
        {found && <span style={{ ...CHIP_BASE, ...CHIP.muted }} data-testid="bench-found">found</span>}
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

/**
 * The repeated-serial warning (#5649), shown where the confirmation card was once a confirmed save
 * has been reported. It names the other components that carry the same serial number so the
 * technician can tell them apart. It never shows the serial number, and it changes nothing: the
 * save stands, and no record is blocked, changed or merged.
 */
export function SameSerialWarning({ notice, savedLabel, disabled, onOpen, onDismiss }: {
  notice: SameSerialNotice;
  /** The checklist label of the component just confirmed, when the checklist has it. */
  savedLabel: string | null;
  /** A save or an answer is in progress: opening equipment waits for it. */
  disabled: boolean;
  /** Opens a match through the host's equipment hand-off. Without it, matches are named only. */
  onOpen?: (match: SameSerialMatch) => void;
  onDismiss: () => void;
}) {
  if (notice.kind === "not_run") {
    return (
      <p role="status" data-testid="bench-same-serial-not-run" style={{ fontSize: "var(--fl-fs-sm)", color: "var(--fl-muted)" }}>
        The check for this serial number on other components did not run this time. Your save is not affected.
      </p>
    );
  }
  const n = notice.matches.length;
  // "1 of 2" beside each match that reads like another one; null for the rest (#5661 A1).
  const places = notice.matches.map((m) => sameSerialPlace(notice.matches, m));
  const others = notice.more
    ? n === 1 ? "more than one other component" : `more than ${n} other components`
    : n === 1 ? "another component" : `${n} other components`;
  return (
    <div role="group" aria-label="Repeated serial number" data-testid="bench-same-serial" style={SERIAL_WARNING_STYLE}>
      <p role="status" data-testid="bench-same-serial-headline" style={{ margin: 0, fontWeight: 600 }}>
        {`This serial number is already on ${others}.`}
      </p>
      <p style={{ margin: "4px 0 0" }}>
        {`${savedLabel ?? "This component"} is saved as confirmed. This may be the same unit. Nothing was blocked, changed or merged.`}
      </p>
      <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
        {notice.matches.map((m, i) => (
          <li key={m.componentId} data-testid={`bench-same-serial-match-${m.componentId}`} style={{ borderTop: "1px solid var(--fl-line)", padding: "8px 0" }}>
            <strong>{m.label}</strong>{" "}
            {places[i] && <span data-testid={`bench-same-serial-place-${m.componentId}`} style={{ marginInlineStart: 4 }}>{`(${places[i]}) `}</span>}
            <span style={{ marginInlineStart: 4 }}>{!m.here ? `in ${m.notebookName}` : m.retired ? "on this machine" : "in this machine's checklist"}</span>
            {m.retired && " "}
            {m.retired && <span data-testid={`bench-same-serial-removed-${m.componentId}`} style={{ marginInlineStart: 4, color: "var(--fl-muted)" }}>(removed from the checklist)</span>}
            {onOpen && !m.retired && (
              <div>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={sameSerialButtonName(notice.matches, m)}
                  data-testid={`bench-same-serial-open-${m.componentId}`}
                  style={QUIET_BUTTON}
                  onClick={() => onOpen(m)}
                >
                  {m.here ? "Show in checklist" : "Open"}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {notice.more && (
        <p data-testid="bench-same-serial-more" style={{ margin: "4px 0 0", fontSize: "var(--fl-fs-sm)" }}>
          {n === 1 ? "Only one is listed." : `Only the first ${n} are listed.`}
        </p>
      )}
      <button type="button" data-testid="bench-same-serial-dismiss" style={QUIET_BUTTON} onClick={onDismiss}>OK</button>
    </div>
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
