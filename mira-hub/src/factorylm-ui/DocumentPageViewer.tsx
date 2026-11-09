"use client";
/**
 * The cited-page viewer (#5333): shows one page of a parked document so a
 * citation opens the right source at the right page on a phone.
 *
 * Commodity first (`.claude/rules/commodity-before-custom.md`): the platform
 * viewer is used wherever the browser has one — desktop hands straight over
 * to the file at `#page=N`. Android Chrome has none, so the page is drawn by
 * pdf.js (the `unpdf` build the hub already ships for text extraction),
 * loaded only here. MIRA owns only which file and which page; pdf.js owns the
 * drawing. No zoom/gesture code: the canvas is drawn at screen width and the
 * browser's own pinch-zoom applies.
 */
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import {
  failureMessage,
  filenameFromDisposition,
  isPdf,
  nativeFileHref,
  pageCaption,
  pageToShow,
  parseViewerRequest,
  viewerMode,
  type ViewerRequest,
} from "./document-page-viewer-logic";

type PdfDoc = { numPages: number; getPage(n: number): Promise<PdfPage> };
type PdfPage = {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void> };
};

type ViewState =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; name: string; numPages: number; page: number; outOfRange: boolean };

const wrap: CSSProperties = {
  minHeight: "100dvh",
  margin: 0,
  padding: "var(--fl-workspace-space-2)",
  background: "var(--fl-workspace-bg)",
  color: "var(--fl-workspace-ink)",
  fontFamily: "var(--fl-workspace-font)",
  fontSize: "var(--fl-workspace-fs-sm)",
  boxSizing: "border-box",
};
const bar: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--fl-workspace-space-2)", marginBlockEnd: "var(--fl-workspace-space-2)" };
const button: CSSProperties = { minHeight: 44, minWidth: 44, padding: "0 var(--fl-workspace-space-3)", border: "1px solid var(--fl-workspace-line)", borderRadius: "var(--fl-workspace-radius-sm)", background: "var(--fl-workspace-surface)", color: "var(--fl-workspace-ink)", font: "inherit" };
const canvasStyle: CSSProperties = { display: "block", width: "100%", height: "auto", border: "1px solid var(--fl-workspace-line)" };

export function DocumentPageViewer() {
  const [request, setRequest] = useState<ViewerRequest | null | undefined>(undefined);
  const [state, setState] = useState<ViewState>({ kind: "loading" });
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Which file, which page; desktop browsers with a viewer get the file itself.
  useEffect(() => {
    const req = parseViewerRequest(window.location.search);
    setRequest(req);
    if (!req) {
      setState({ kind: "failed", message: "No document was given to open." });
      return;
    }
    if (viewerMode(navigator.pdfViewerEnabled) === "native") {
      window.location.replace(nativeFileHref(req.fileId, req.page));
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(nativeFileHref(req.fileId, null), { credentials: "same-origin" });
        if (!res.ok) {
          if (!cancelled) setState({ kind: "failed", message: failureMessage(res.status) });
          return;
        }
        if (!isPdf(res.headers.get("content-type"))) {
          // Not a PDF (a photo or other original): let the browser open it.
          window.location.replace(nativeFileHref(req.fileId, null));
          return;
        }
        const name = filenameFromDisposition(res.headers.get("content-disposition")) ?? "Document";
        const data = new Uint8Array(await res.arrayBuffer());
        const { getDocumentProxy } = await import("unpdf");
        // The page CSP has no 'unsafe-eval'; tell pdf.js not to probe for it.
        const pdf = (await getDocumentProxy(data, { isEvalSupported: false })) as unknown as PdfDoc;
        if (cancelled) return;
        const shown = pageToShow(req.page, pdf.numPages);
        setDoc(pdf);
        setState({ kind: "ready", name, numPages: pdf.numPages, page: shown.page, outOfRange: shown.outOfRange });
      } catch (err) {
        console.error("[DocumentPageViewer]", err);
        if (!cancelled) setState({ kind: "failed", message: failureMessage(500) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const page = state.kind === "ready" ? state.page : 0;
  useEffect(() => {
    if (!doc || page < 1) return;
    let cancelled = false;
    void (async () => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;
      const p = await doc.getPage(page);
      if (cancelled) return;
      const cssWidth = Math.max(240, canvas.parentElement?.clientWidth ?? window.innerWidth);
      const scale = (cssWidth / p.getViewport({ scale: 1 }).width) * Math.min(window.devicePixelRatio || 1, 3);
      const viewport = p.getViewport({ scale });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await p.render({ canvas, canvasContext: context, viewport }).promise;
      if (!cancelled) canvas.dataset.renderedPage = String(page);
    })().catch((err) => console.error("[DocumentPageViewer] render", err));
    return () => {
      cancelled = true;
    };
  }, [doc, page]);

  const go = (delta: number) =>
    setState((s) => (s.kind === "ready" ? { ...s, page: Math.min(s.numPages, Math.max(1, s.page + delta)), outOfRange: false } : s));
  const openHref = request ? nativeFileHref(request.fileId, request.page) : undefined;

  return (
    <main style={wrap} data-viewer-state={state.kind}>
      {state.kind === "loading" ? <p role="status">Opening the cited page…</p> : null}
      {state.kind === "failed" ? (
        <div role="alert">
          <p>{state.message}</p>
          {openHref ? <p><a href={openHref} target="_blank" rel="noopener noreferrer">Open document</a></p> : null}
        </div>
      ) : null}
      {state.kind === "ready" && request ? (
        <>
          <p data-testid="viewer-caption" style={{ margin: "0 0 var(--fl-workspace-space-1)", fontWeight: 700, overflowWrap: "anywhere" }}>
            {pageCaption(state.name, state.page, state.numPages, request.fileId)}
          </p>
          {state.outOfRange ? (
            <p role="status" style={{ margin: "0 0 var(--fl-workspace-space-1)", color: "var(--fl-workspace-muted)" }}>
              The cited page {request.page} isn&apos;t in this file; showing page 1.
            </p>
          ) : null}
          <nav style={bar} aria-label="Pages">
            <button type="button" style={button} onClick={() => go(-1)} disabled={state.page <= 1}>Previous page</button>
            <button type="button" style={button} onClick={() => go(1)} disabled={state.page >= state.numPages}>Next page</button>
          </nav>
        </>
      ) : null}
      <canvas ref={canvasRef} style={state.kind === "ready" ? canvasStyle : { display: "none" }} aria-label={state.kind === "ready" ? `Page ${state.page} of ${state.name}` : undefined} />
    </main>
  );
}
