/**
 * Print isolation for the Living Work Sheet printouts (job sheet, shift
 * report). The print copy is rendered as a direct child of <body>, and in
 * @media print every OTHER body child is display:none — so the printout gets
 * the full page width and no blank pages from the hidden app underneath.
 *
 * Found by the §12 PDF inspection: a visibility mask over a copy nested
 * inside the on-screen panel inherited that panel's shrink-to-fit width
 * (one word per line) and left blank trailing pages.
 *
 * Before mount (SSR / renderToStaticMarkup) the children render inline, so
 * static tests still see them.
 */
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const PRINT_PORTAL_CLASS = "fl-print-portal";

export const PRINT_PORTAL_CSS = `
@media print {
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  body > *:not(.${PRINT_PORTAL_CLASS}) { display: none !important; }
  .${PRINT_PORTAL_CLASS} { display: block !important; position: static !important; width: auto !important; }
}
@media screen {
  .${PRINT_PORTAL_CLASS} { display: none !important; }
}
`;

export function PrintPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || typeof document === "undefined") return <>{children}</>;
  return createPortal(children, document.body);
}
