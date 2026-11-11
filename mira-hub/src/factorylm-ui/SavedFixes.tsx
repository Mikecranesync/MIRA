"use client";
/**
 * #5089: the fixes a technician saved on this project, visible again after a reload (Hub adapter,
 * outside the frozen legacy trees). One button in the notebook-actions column; the list opens in
 * the same bottom sheet the machine-state panel uses.
 *
 * Read-only: GET /fixes only. Renders nothing while there is no saved fix, while the picked
 * machine is unconfirmed, or when the read fails. Saved fixes are technician notes; they are not
 * checked against a manual and do not feed MIRA's answers, and the panel says so.
 * Styling uses the shared --fl-* tokens only.
 */
import { useCallback, useEffect, useReducer, useRef, useState, type CSSProperties } from "react";
import { API_BASE } from "@/lib/config";
import { OBS_PILL_STYLE } from "./MachineObservations";
import {
  fixWhenLabel,
  fixesReducer,
  loadSavedFixes,
  savedFixesHeading,
  savedFixesPillLabel,
  type SavedFix,
} from "./saved-fixes-logic";

const PANEL_STYLE: CSSProperties = {
  position: "fixed", inset: "auto 0 0 0", maxHeight: "80vh", overflowY: "auto", zIndex: 60,
  background: "var(--fl-surface)", color: "var(--fl-text)", borderTop: "1px solid var(--fl-line)",
  boxShadow: "var(--fl-shadow)", padding: "var(--fl-space-4, 16px)", fontFamily: "var(--fl-font)",
};

const BUTTON_STYLE: CSSProperties = {
  minHeight: 44, padding: "8px 16px", borderRadius: "var(--fl-radius)", border: "1px solid var(--fl-line)",
  background: "var(--fl-surface)", color: "var(--fl-text)", cursor: "pointer",
};

const ITEM_STYLE: CSSProperties = {
  listStyle: "none", padding: "12px 0", borderTop: "1px solid var(--fl-line)",
};

const MUTED_STYLE: CSSProperties = { color: "var(--fl-muted)", fontSize: "var(--fl-fs-sm)" };

export interface SavedFixesViewProps {
  fixes: SavedFix[];
  hasMore: boolean;
  loadingMore: boolean;
  moreError: string | null;
  open: boolean;
  assetConfirmed: boolean | null;
  locale?: string;
  timeZone?: string;
  onToggle: () => void;
  onClose: () => void;
  onMore: () => void;
}

/** What is drawn for a loaded list. No fix, no button. */
export function SavedFixesView(props: SavedFixesViewProps) {
  const { fixes, hasMore, loadingMore, moreError, open, assetConfirmed, locale, timeZone } = props;
  if (fixes.length === 0) return null;
  const heading = savedFixesHeading(assetConfirmed);
  return (
    <>
      <button type="button" style={OBS_PILL_STYLE} data-testid="saved-fixes-pill" aria-expanded={open} onClick={props.onToggle}>
        {savedFixesPillLabel(fixes.length, hasMore)}
      </button>
      {open && (
        <section role="dialog" aria-label={heading} style={PANEL_STYLE} data-testid="saved-fixes-panel">
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: "var(--fl-fs-lg, 18px)" }}>{heading}</h2>
            <button type="button" style={BUTTON_STYLE} onClick={props.onClose}>Close</button>
          </header>
          <p style={MUTED_STYLE}>
            Technician notes. They are not checked against the manual, and MIRA does not use them in its answers.
          </p>
          <ul style={{ margin: 0, padding: 0 }}>
            {fixes.map((f) => {
              const when = fixWhenLabel(f.createdAt, locale, timeZone);
              return (
                <li key={f.id} style={ITEM_STYLE} data-testid="saved-fix">
                  <div style={MUTED_STYLE}>Problem</div>
                  <div>{f.symptom}</div>
                  {f.faultCode && <div style={MUTED_STYLE}>Fault code {f.faultCode}</div>}
                  <div style={{ ...MUTED_STYLE, marginTop: 8 }}>What fixed it</div>
                  <div style={{ whiteSpace: "pre-wrap" }}>{f.fix}</div>
                  {when && <div style={{ ...MUTED_STYLE, marginTop: 8 }}>Saved {when}</div>}
                </li>
              );
            })}
          </ul>
          {moreError && <p role="alert" style={MUTED_STYLE}>{moreError}</p>}
          {hasMore && (
            <button type="button" style={BUTTON_STYLE} disabled={loadingMore} data-testid="saved-fixes-more" onClick={props.onMore}>
              {loadingMore ? "Loading…" : "Show more"}
            </button>
          )}
        </section>
      )}
    </>
  );
}

/**
 * The project's saved fixes. `refresh` is a counter the host bumps after a successful save, so
 * the new fix is listed without a reload; a reload reads the same route from scratch.
 * What the list holds as reads come back is decided in `fixesReducer` (tested there).
 */
export function SavedFixes({ notebookId, refresh }: { notebookId: string; refresh: number }) {
  const [state, dispatch] = useReducer(fixesReducer, null);
  const [open, setOpen] = useState(false);
  // Set in the effect's setup, not only at first render: StrictMode runs cleanup then setup again.
  const mounted = useRef(true);
  // A newer read from the top (a save) wins over an older one still in flight.
  const latest = useRef(0);

  useEffect(() => {
    mounted.current = true;
    const mine = ++latest.current;
    void loadSavedFixes(fetch, API_BASE, notebookId).then((page) => {
      if (mounted.current && mine === latest.current) dispatch({ type: "first-page", page });
    });
    return () => { mounted.current = false; };
  }, [notebookId, refresh]);

  const before = state?.cursor ?? null;
  const loadingMore = state?.loadingMore ?? false;
  const onMore = useCallback(() => {
    if (!before || loadingMore) return;
    dispatch({ type: "more-started" });
    void loadSavedFixes(fetch, API_BASE, notebookId, before).then((page) => {
      if (mounted.current) dispatch({ type: "more-loaded", before, page });
    });
  }, [before, loadingMore, notebookId]);

  if (!state) return null;
  return (
    <SavedFixesView
      fixes={state.fixes} hasMore={state.cursor !== null} loadingMore={state.loadingMore} moreError={state.moreError}
      open={open} assetConfirmed={state.assetConfirmed}
      onToggle={() => setOpen((v) => !v)} onClose={() => setOpen(false)} onMore={onMore}
    />
  );
}
