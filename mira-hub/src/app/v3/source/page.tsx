"use client";
/**
 * /v3/source/?file=ID&page=N, the cited-page viewer the shared SourceViewer
 * frames for a parked document (#5333). Presentation lives in the adapter
 * (`src/factorylm-ui/DocumentPageViewer.tsx`); this file only mounts it under
 * the /v3 shell's theme. Phones have no inline PDF viewer, so a framed PDF was
 * blocked; this same-origin page draws the cited page instead, and desktop
 * browsers are handed straight to the file at its page.
 */
import "@factorylm/theme/workspace.css";
import { DocumentPageViewer } from "@/factorylm-ui/DocumentPageViewer";

export default function V3SourcePage() {
  return <DocumentPageViewer />;
}
