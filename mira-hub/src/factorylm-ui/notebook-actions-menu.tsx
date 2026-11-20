"use client";
/**
 * One "More" button for the notebook's tools (Mike, 2026-11-20: the pills cluttered the screen).
 *
 * Each tool keeps its own availability check and its own open state; it registers an item here with
 * `useMenuItem` and stops drawing its own pill while inside the provider. What it opens (a dialog, a
 * panel, a sheet) is unchanged and still draws where it did. The list is a native modal <dialog>,
 * not a popover, because the shell's Back handler closes `dialog[open]` and nothing else
 * (FactoryLMShell): Back, Escape and a tap outside all close it, and focus returns to More.
 * Not role=menu: the items open views, so it is a disclosure button over a plain list of buttons.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { groupItems, moreBadge, orderItems, type MenuItem, type MenuItemId } from "./notebook-actions-menu-logic";

interface Entry { item: MenuItem; open: () => void }
/** The part the next question is about, beside More. None while the whole machine is the subject. */
export interface MenuChip { label: string; onOpen: () => void; onClear: (() => void) | null }
interface Registry {
  register: (item: MenuItem, open: () => void) => () => void;
  setChip: (chip: MenuChip | null) => void;
  focusMore: () => void;
  moreRef: React.RefObject<HTMLButtonElement | null>;
}

const RegistryContext = createContext<Registry | null>(null);
const EntriesContext = createContext<ReadonlyMap<MenuItemId, Entry>>(new Map());
const ChipContext = createContext<MenuChip | null>(null);

export function NotebookActionsMenuProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<ReadonlyMap<MenuItemId, Entry>>(new Map());
  const [chip, setChip] = useState<MenuChip | null>(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const registry = useMemo<Registry>(() => ({
    register: (item, open) => {
      const entry: Entry = { item, open };
      setEntries((m) => new Map(m).set(item.id, entry));
      // Remove only this registration: a later one for the same tool (its label changed) stays.
      return () => setEntries((m) => {
        if (m.get(item.id) !== entry) return m;
        const next = new Map(m);
        next.delete(item.id);
        return next;
      });
    },
    setChip,
    focusMore: () => moreRef.current?.focus(),
    moreRef,
  }), []);
  return (
    <RegistryContext.Provider value={registry}>
      <EntriesContext.Provider value={entries}>
        <ChipContext.Provider value={chip}>{children}</ChipContext.Provider>
      </EntriesContext.Provider>
    </RegistryContext.Provider>
  );
}

/**
 * Put a tool in the More list while `item` is non-null. Call it above every early return.
 * `inMenu` is true inside the provider: the tool then draws no pill of its own.
 * `focusMore` is where focus goes back to when the tool's own dialog closes.
 */
export function useMenuItem(item: MenuItem | null, onOpen: () => void): { inMenu: boolean; focusMore: () => void } {
  const registry = useContext(RegistryContext);
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  });
  const key = item ? JSON.stringify(item) : null;
  useEffect(() => {
    if (!registry || key === null) return;
    return registry.register(JSON.parse(key) as MenuItem, () => onOpenRef.current());
  }, [registry, key]);
  return { inMenu: registry !== null, focusMore: registry?.focusMore ?? NOOP };
}
const NOOP = () => {};

/** Show `chip` beside More while it is non-null. Returns true inside the provider. */
export function useMenuChip(chip: MenuChip | null): boolean {
  const registry = useContext(RegistryContext);
  const latest = useRef(chip);
  useEffect(() => {
    latest.current = chip;
  });
  const key = chip ? `${chip.label}\u0000${chip.onClear ? 1 : 0}` : null;
  useEffect(() => {
    if (!registry || key === null) return;
    registry.setChip({
      label: latest.current!.label,
      onOpen: () => latest.current?.onOpen(),
      onClear: latest.current!.onClear ? () => latest.current?.onClear?.() : null,
    });
    return () => registry.setChip(null);
  }, [registry, key]);
  return registry !== null;
}

/** The More button and its list. Renders nothing while no tool is available. */
export function NotebookActionsMenu({ covered }: { covered: boolean }) {
  const registry = useContext(RegistryContext);
  const entries = useContext(EntriesContext);
  const chip = useContext(ChipContext);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; right: number } | null>(null);
  // A choice closes the list and hands focus to what it opens; only a plain close returns it to More.
  const choosing = useRef(false);

  const items = useMemo(() => orderItems([...entries.values()].map((e) => e.item)), [entries]);

  const show = useCallback(() => {
    const more = registry?.moreRef.current;
    const d = dialogRef.current;
    if (!more || !d) return;
    const r = more.getBoundingClientRect();
    setPlace({ top: Math.round(r.bottom + 8), right: Math.max(12, Math.round(window.innerWidth - r.right)) });
    setOpen(true);
    if (!d.open) d.showModal();
  }, [registry]);

  // A layer covering the column (#5546) closes the list; the button itself stays mounted.
  useEffect(() => {
    if (covered) dialogRef.current?.close();
  }, [covered]);

  if (!registry || (items.length === 0 && !chip)) return null;
  const choose = (id: MenuItemId) => {
    choosing.current = true;
    // Closed first, so the shell's Back finds the tool's own dialog, not this one.
    dialogRef.current?.close();
    entries.get(id)?.open();
  };

  return (
    <div data-testid="notebook-more-row" style={ROW}>
      <style>{MENU_CSS}</style>
      {chip ? (
        <span style={CHIP} data-testid="notebook-chip">
          <button type="button" style={CHIP_LABEL} data-testid="bench-asking-about" onClick={chip.onOpen}>{chip.label}</button>
          {chip.onClear ? (
            <button type="button" style={CHIP_CLEAR} aria-label="Back to whole machine" data-testid="notebook-chip-clear" onClick={chip.onClear}>
              <Icon d={CROSS} />
            </button>
          ) : null}
        </span>
      ) : null}
      {items.length > 0 ? <button
        type="button"
        ref={registry.moreRef}
        data-testid="notebook-more"
        aria-haspopup="dialog"
        aria-expanded={open}
        style={open ? { ...MORE, ...MORE_OPEN } : MORE}
        onClick={() => (open ? dialogRef.current?.close() : show())}
      >
        <Icon d={DOTS} />
        More
        {moreBadge(items) ? <span data-testid="notebook-more-dot" aria-label="Something is under way" style={DOT} /> : null}
      </button> : null}
      <dialog
        ref={dialogRef}
        className="fl-more"
        aria-label="Notebook tools"
        data-testid="notebook-more-menu"
        style={place ? { ...SHEET, top: place.top, right: place.right } : SHEET}
        onClick={(e) => { if (e.target === dialogRef.current) dialogRef.current?.close(); }}
        onClose={() => {
          setOpen(false);
          if (!choosing.current) registry.focusMore();
          choosing.current = false;
        }}
      >
        {open ? groupItems(items).map(({ group, items: groupItemsList }) => (
          <div key={group} className={`fl-more__group fl-more__group--${group.toLowerCase()}`} role="group" aria-label={group}>
            <h2 style={HEADING}>{group}</h2>
            {groupItemsList.map((item) => (
              <button key={item.id} type="button" style={ITEM} data-testid={`notebook-more-item-${item.id}`} onClick={() => choose(item.id)}>
                <span style={ICON_BOX}><Icon d={ICONS[item.id]} /></span>
                <span style={{ minWidth: 0 }}>
                  <span style={LABEL}>
                    {item.label}
                    {item.status ? <span style={STATUS}>{item.status}</span> : null}
                  </span>
                  <span style={DESCRIPTION}>{item.description}</span>
                </span>
              </button>
            ))}
          </div>
        )) : null}
      </dialog>
    </div>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

const DOTS = "M5 12h.01M12 12h.01M19 12h.01";
const CROSS = "M6 6l12 12M18 6L6 18";
const ICONS: Record<MenuItemId, string> = {
  equipment: "M11 4.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13M20 20l-4.2-4.2",
  part: "M4 7h16M4 12h16M4 17h10M17 15l2 2 3-4",
  guided: "M5 4h10l4 4v12H5zM9 12h6M9 16h4",
  "machine-state": "M3 12h4l2-6 4 12 2-6h6",
  "saved-fixes": "M6 4h12v16l-6-4-6 4z",
  "work-packet": "M4 7h16v13H4zM9 7V5h6v2",
  "job-sheet": "M5 3h14v18H5zM9 8h6M9 12h6M9 16h3",
};

// Two columns on a short, wide screen (a tablet in landscape), so every tool shows without scrolling.
const MENU_CSS = `
.fl-more::backdrop { background: transparent; }
@media (min-width: 900px) and (max-height: 760px) {
  .fl-more[open] { width: min(680px, calc(100vw - 24px)); display: grid; grid-template-columns: 1fr 1fr; column-gap: 8px; }
  .fl-more__group--find { grid-column: 1; grid-row: 1; }
  .fl-more__group--fix { grid-column: 2; grid-row: 1 / span 2; }
  .fl-more__group--job { grid-column: 1; grid-row: 2; }
}`;

const ROW: CSSProperties = { display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 };
const CHIP: CSSProperties = {
  display: "inline-flex", alignItems: "center", minHeight: 48, maxWidth: "min(56vw, 320px)", paddingInlineEnd: 4,
  borderRadius: "var(--fl-radius-pill, 999px)", background: "var(--fl-accent-tint)", color: "var(--fl-accent-ink)",
  border: "1px solid var(--fl-line)",
};
const CHIP_LABEL: CSSProperties = {
  minHeight: 46, padding: "0 6px 0 16px", border: 0, background: "none", color: "inherit", font: "inherit", fontWeight: 600,
  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", cursor: "pointer", textAlign: "start", minWidth: 0,
};
const CHIP_CLEAR: CSSProperties = {
  flex: "none", width: 40, height: 40, borderRadius: "50%", border: 0, background: "none", color: "inherit",
  display: "grid", placeItems: "center", cursor: "pointer",
};
const MORE: CSSProperties = {
  position: "relative", display: "inline-flex", alignItems: "center", gap: 8, minHeight: 48, padding: "0 18px",
  borderRadius: "var(--fl-radius-pill, 999px)", border: "1px solid var(--fl-line-strong)",
  background: "var(--fl-surface)", color: "var(--fl-ink)", font: "inherit", fontWeight: 600, cursor: "pointer",
  boxShadow: "var(--fl-shadow)",
};
const MORE_OPEN: CSSProperties = { background: "var(--fl-accent-tint)", color: "var(--fl-accent-ink)" };
const DOT: CSSProperties = {
  position: "absolute", top: 8, right: 10, width: 9, height: 9, borderRadius: "50%",
  background: "var(--fl-warn)", border: "2px solid var(--fl-surface)",
};
const SHEET: CSSProperties = {
  position: "fixed", margin: 0, left: "auto", bottom: "auto", width: "min(360px, calc(100vw - 24px))",
  maxHeight: "calc(100dvh - 140px)", overflowY: "auto", padding: 8, color: "var(--fl-ink)",
  background: "var(--fl-surface)", border: "1px solid var(--fl-line)", borderRadius: "var(--fl-radius-card, 16px)",
  boxShadow: "var(--fl-shadow-pop)",
};
const HEADING: CSSProperties = {
  margin: "6px 10px", fontSize: 12, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--fl-muted)", fontWeight: 700,
};
const ITEM: CSSProperties = {
  display: "flex", gap: 14, alignItems: "center", width: "100%", minHeight: 60, padding: "8px 10px", border: 0,
  background: "none", borderRadius: 12, textAlign: "start", font: "inherit", color: "inherit", cursor: "pointer",
};
const ICON_BOX: CSSProperties = {
  flex: "none", width: 40, height: 40, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--fl-bg)",
};
const LABEL: CSSProperties = { display: "block", fontSize: 16, fontWeight: 600 };
const DESCRIPTION: CSSProperties = { display: "block", fontSize: 13.5, color: "var(--fl-muted)", marginTop: 2 };
const STATUS: CSSProperties = {
  display: "inline-block", marginInlineStart: 6, verticalAlign: 2, padding: "3px 9px", borderRadius: 999,
  fontSize: 11.5, fontWeight: 700, color: "var(--fl-ink)", background: "var(--fl-warn-bg)", border: "1px solid var(--fl-warn)",
};
