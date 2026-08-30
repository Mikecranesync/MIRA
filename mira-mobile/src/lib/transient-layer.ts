// Transient-layer BACK registry (Commodity PRD §11, Phase 3).
//
// One LIFO stack of "transient UI layers" — surfaces that sit on top of a
// screen and must be closed by hardware BACK before any navigation happens
// (fullscreen media viewer today; sheets join in the Sheet-consolidation
// step). Layers register a closer on open; the app-level backButton listener
// consults `closeTopTransientLayer()` BEFORE the per-tab `backRef` chains, so
// BACK always closes the most recently opened layer first (proven ordering:
// viewer → sheet → conversation, Phase-2 device acceptance 2026-08-27).
//
// Grew out of #3429's viewer-only registry; renamed and moved here so it is
// the ONE home for BACK-ordering state instead of a per-component invention.

import { useEffect, useRef } from "react";

let stack: Array<() => void> = [];

/** Register an open layer's closer; returns an idempotent unregister. */
export function registerTransientLayer(close: () => void): () => void {
  const entry = () => close();
  stack.push(entry);
  return () => {
    stack = stack.filter((e) => e !== entry);
  };
}

/** Close the most recently opened layer. True if BACK was consumed. */
export function closeTopTransientLayer(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top();
  return true;
}

export function _resetTransientLayersForTest(): void {
  stack = [];
}

/**
 * Hook form for components that keep their own chrome (e.g. the centered
 * delete-confirm alertdialog): registers this mounted surface as a transient
 * layer for the hardware-BACK stack. Registers once; the latest `close` is
 * read through a ref so re-renders never reorder the LIFO stack.
 */
export function useTransientLayer(close: () => void): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => registerTransientLayer(() => closeRef.current()), []);
}
