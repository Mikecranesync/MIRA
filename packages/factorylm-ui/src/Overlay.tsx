import { useEffect, useRef, type ReactNode } from "react";
import { trapTab, useFocusReturn } from "./focus";

export type LayerName = "source" | "attachment-menu" | "inspector" | "navigation";

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
  readonly children: ReactNode;
}

/**
 * One wrapper for every closable layer. It owns focus trapping and focus
 * return only; closing precedence and the scrim live in `FactoryLMShell` so
 * there is exactly one Back/Escape decision.
 */
export function Overlay({ layer, active, modal, children }: OverlayProps) {
  const root = useRef<HTMLDivElement>(null);
  const trapping = active && modal;
  useFocusReturn(trapping, root);

  useEffect(() => {
    if (!trapping) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (root.current) trapTab(event, root.current);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [trapping]);

  return <div ref={root} className="fl-overlay" data-layer={layer} data-active={active} data-modal={modal}>
    {children}
  </div>;
}
