import { useEffect, useRef, type ReactNode } from "react";
import { focusableWithin, trapTab, useFocusReturn } from "./focus";

export type LayerName = "source" | "attachment-menu" | "inspector" | "navigation";

/** Closing precedence, top-most first (mirrors `topLayer` in FactoryLMShell). */
const LAYER_ORDER: readonly LayerName[] = ["source", "attachment-menu", "inspector", "navigation"];

/**
 * When a layer closes while another modal layer is still open (the attachment
 * sheet over the drawer), focus must land inside that layer, not on the opener
 * behind its scrim. Returns the element to focus, or `null` to use the opener.
 */
function focusTargetBehind(opener: HTMLElement | null): HTMLElement | null {
  for (const layer of LAYER_ORDER) {
    const open = document.querySelector<HTMLElement>(
      `.fl-overlay[data-layer="${layer}"][data-active="true"][data-modal="true"]`,
    );
    if (!open) continue;
    if (opener && open.contains(opener)) return null;
    return focusableWithin(open)[0] ?? null;
  }
  return null;
}

export interface OverlayProps {
  readonly layer: LayerName;
  /** The layer is currently shown. */
  readonly active: boolean;
  /**
   * The layer covers the page (drawer, sheet, dialog): focus is trapped while
   * it is open and returned to the opening control when it closes. A layer
   * that is a static panel on this profile passes `modal={false}`.
   */
  readonly modal: boolean;
  /**
   * Only the top-most open layer (by `topLayer` precedence) traps Tab. Two
   * modal layers can be open at once (drawer + attachment sheet); each keeps
   * its own focus return, but if both trapped Tab their listeners would fight
   * and focus would bounce between roots. Defaults to `modal`.
   */
  readonly trapsTab?: boolean;
  readonly children: ReactNode;
}

/**
 * One wrapper for every closable layer. It owns focus trapping and focus
 * return only; closing precedence and the scrim live in `FactoryLMShell` so
 * there is exactly one Back/Escape decision.
 */
export function Overlay({ layer, active, modal, trapsTab, children }: OverlayProps) {
  const root = useRef<HTMLDivElement>(null);
  const trapping = active && modal;
  // A closed modal layer is only moved off-screen by a transform, so it keeps a
  // bounding box and stays focusable: Tab reaches "Close navigation" inside a
  // drawer the user cannot see. Mark it inert while it is closed so keyboard and
  // assistive tech skip it. Only when modal — the desktop sidebar is a permanent
  // region (modal=false) and must stay reachable.
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    node.toggleAttribute("inert", Boolean(modal) && !active);
  }, [modal, active]);

  useFocusReturn(trapping, root, focusTargetBehind);

  const trapping_tab = trapping && (trapsTab ?? true);
  useEffect(() => {
    if (!trapping_tab) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (root.current) trapTab(event, root.current);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [trapping_tab]);

  return <div ref={root} className="fl-overlay" data-layer={layer} data-active={active} data-modal={modal}>
    {children}
  </div>;
}
