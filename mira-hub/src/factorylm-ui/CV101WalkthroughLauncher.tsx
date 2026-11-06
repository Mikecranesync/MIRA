"use client";
import { lazy, Suspense, useRef, useState } from "react";
const Walkthrough = lazy(() => import("./CV101Walkthrough").then(m => ({ default: m.CV101Walkthrough })));
export function CV101WalkthroughLauncher({ viewerScope }: { viewerScope: string }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  return <>
    <button type="button" ref={opener} data-testid="cv101-walkthrough-launcher" onClick={() => setOpen(true)}>CV-101 walkthrough</button>
    {open && <Suspense fallback={<p role="status">Loading CV-101 walkthrough…</p>}><Walkthrough key={viewerScope} viewerScope={viewerScope} onClose={() => { setOpen(false); requestAnimationFrame(() => opener.current?.focus()); }} /></Suspense>}
  </>;
}
