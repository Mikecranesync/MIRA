// The ONE bottom-sheet chrome (Commodity PRD §11, Phase 3 item 2).
//
// Nine screens hand-rolled the same backdrop/stopPropagation pair, and BACK
// only closed the sheets a screen's backRef happened to enumerate (AssetsTab's
// file sheet was closable ONLY by the backdrop). This component centralizes
// the chrome and — the load-bearing part — registers every open sheet in the
// transient-layer stack, so hardware BACK closes layers strictly LIFO
// (viewer → sheet → navigation) without any per-screen bookkeeping.
//
// Deliberately a tiny custom component, not a dialog library: the chrome is
// ~20 lines of already-proven markup (app.css .sheet-backdrop/.sheet) and the
// interaction logic lives in the shared stack. If focus-trap requirements
// grow beyond aria-modal + Escape, the §13 evaluation names Radix Dialog as
// the upgrade path — swap the internals here, nowhere else.
import { useEffect, useRef, type ReactNode } from "react";
import { useTransientLayer } from "../lib/transient-layer";

export function Sheet({
  onClose,
  label,
  children,
}: {
  onClose: () => void;
  /** Accessible name for the dialog (screen readers announce it on open). */
  label: string;
  children: ReactNode;
}) {
  useTransientLayer(onClose);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Escape closes on the web build; harmless on device.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Renderless BACK registration for a surface that keeps its own chrome (the
 * centered delete-confirm alertdialog). Mount it INSIDE the conditional block
 * so registration exists exactly while the surface is open.
 */
export function BackDismiss({ onDismiss }: { onDismiss: () => void }) {
  useTransientLayer(onDismiss);
  return null;
}
