/**
 * /v3 viewport (#5074). On Android Chrome the on-screen keyboard defaults to resizing only the
 * visual viewport, so the shell's sticky composer stayed at the bottom of the layout viewport —
 * behind the keyboard — and the technician typed blind. `resizes-content` shrinks the layout
 * viewport instead, so the composer rides above the keyboard. Next merges this onto its default
 * (`width=device-width, initial-scale=1`). It lives here because page.tsx is a client component
 * and Next accepts `viewport` only from Server Components.
 */
import type { Viewport } from "next";
import type { ReactNode } from "react";

export const viewport: Viewport = { interactiveWidget: "resizes-content" };

export default function V3Layout({ children }: { children: ReactNode }) {
  return children;
}
