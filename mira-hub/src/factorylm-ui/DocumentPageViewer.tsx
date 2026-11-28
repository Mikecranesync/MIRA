"use client";
/**
 * Draws cited pages and embedded PDFs with the PDF.js build the Hub already
 * uses for text extraction. A native viewer can still open the original in a
 * standalone tab.
 */
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import {
  failureMessage,
  filenameFromDisposition,
  isPdf,
  pageCaption,
  pageToShow,
  parseViewerRequest,
  requestBytesHref,
  requestId,
  viewerMode,
  type ViewerRequest,
} from "./document-page-viewer-logic";

type PdfDoc = Awaited<ReturnType<typeof import("unpdf").getDocumentProxy>>;
type RenderTask = ReturnType<Awaited<ReturnType<PdfDoc["getPage"]>>["render"]>;

type ViewState =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; name: string; numPages: number; page: number; outOfRange: boolean; rendered: boolean };

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

  useEffect(() => {
    const req = parseViewerRequest(window.location.search);
    setRequest(req);
    if (!req) {
      setState({ kind: "failed", message: "No document was given to open." });
      return;
    }
    const embedded = window.self !== window.top;
    if (viewerMode(navigator.pdfViewerEnabled, { embedded, page: req.page }) === "native") {
      window.location.replace(requestBytesHref(req, null));
      return;
    }
    const abort = new AbortController();
    let loaded: PdfDoc | null = null;
    void (async () => {
      try {
        const res = await fetch(requestBytesHref(req, null), {
          credentials: "same-origin",
          signal: abort.signal,
        });
        if (abort.signal.aborted) return;
        if (!res.ok) {
          setState({ kind: "failed", message: failureMessage(res.status) });
          return;
        }
        if (!isPdf(res.headers.get("content-type"))) {
          if (embedded) {
            setState({ kind: "failed", message: "Use Open document to view the original file." });
          } else {
            window.location.replace(requestBytesHref(req, null));
          }
          return;
        }
        const name = filenameFromDisposition(res.headers.get("content-disposition")) ?? "Document";
        const data = new Uint8Array(await res.arrayBuffer());
        const { getDocumentProxy } = await import("unpdf");
        if (abort.signal.aborted) return;
        // Keep PDF-supplied code disabled and use the bundled PDF.js runtime.
        const pdf = await getDocumentProxy(data, { isEvalSupported: false });
        if (abort.signal.aborted) {
          await pdf.destroy();
          return;
        }
        loaded = pdf;
        const shown = pageToShow(req.page, pdf.numPages);
        setDoc(pdf);
        setState({ kind: "ready", name, numPages: pdf.numPages, ...shown, rendered: false });
      } catch (err) {
        if (abort.signal.aborted) return;
        console.error("[DocumentPageViewer]", err);
        setState({ kind: "failed", message: failureMessage(500) });
      }
    })();
    return () => {
      abort.abort();
      void loaded?.destroy().catch(() => {});
    };
  }, []);

  const page = state.kind === "ready" ? state.page : 0;
  useEffect(() => {
    if (!doc || page < 1) return;
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    void (async () => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) throw new Error("PDF canvas unavailable");
      const p = await doc.getPage(page);
      if (cancelled) return;
      const cssWidth = Math.max(240, canvas.parentElement?.clientWidth ?? window.innerWidth);
      const scale = (cssWidth / p.getViewport({ scale: 1 }).width) * Math.min(window.devicePixelRatio || 1, 3);
      const viewport = p.getViewport({ scale });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      renderTask = p.render({ canvas, canvasContext: context, viewport });
      await renderTask.promise;
      if (!cancelled) {
        setState((current) => current.kind === "ready" && current.page === page
          ? { ...current, rendered: true }
          : current);
      }
    })().catch((err) => {
      if (cancelled) return;
      console.error("[DocumentPageViewer] render", err);
      setState({ kind: "failed", message: failureMessage(500) });
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [doc, page]);

  const go = (delta: number) => setState((current) => {
    if (current.kind !== "ready" || !current.rendered) return current;
    const nextPage = Math.min(current.numPages, Math.max(1, current.page + delta));
    if (nextPage === current.page) return current;
    return { ...current, page: nextPage, outOfRange: false, rendered: false };
  });
  const rendered = state.kind === "ready" && state.rendered;
  const openDocument = request ? (
    <a href={requestBytesHref(request, request.page)} target="_blank" rel="noopener noreferrer">Open document</a>
  ) : null;

  return (
    <main style={wrap} data-viewer-state={state.kind === "ready" && !rendered ? "loading" : state.kind}>
      {state.kind === "loading" ? (
        <>
          <p role="status">Opening the cited page…</p>
          {openDocument ? <p>{openDocument}</p> : null}
        </>
      ) : null}
      {state.kind === "failed" ? (
        <div role="alert">
          <p>{state.message}</p>
          {openDocument ? <p>{openDocument}</p> : null}
        </div>
      ) : null}
      {state.kind === "ready" && request ? (
        <>
          {rendered ? (
            <p data-testid="viewer-caption" style={{ margin: "0 0 var(--fl-workspace-space-1)", fontWeight: 700, overflowWrap: "anywhere" }}>
              {pageCaption(state.name, state.page, state.numPages, requestId(request))}
            </p>
          ) : <p role="status">Opening page {state.page}…</p>}
          {rendered && state.outOfRange ? (
            <p role="status" style={{ margin: "0 0 var(--fl-workspace-space-1)", color: "var(--fl-workspace-muted)" }}>
              The cited page {request.page} isn&apos;t in this file; showing page 1.
            </p>
          ) : null}
          <nav style={bar} aria-label="Pages">
            <button type="button" style={button} onClick={() => go(-1)} disabled={!rendered || state.page <= 1}>Previous page</button>
            <button type="button" style={button} onClick={() => go(1)} disabled={!rendered || state.page >= state.numPages}>Next page</button>
            {openDocument}
          </nav>
        </>
      ) : null}
      <canvas
        ref={canvasRef}
        style={rendered ? canvasStyle : { display: "none" }}
        aria-label={rendered ? `Page ${state.page} of ${state.name}` : undefined}
        data-rendered-page={rendered ? state.page : undefined}
      />
    </main>
  );
}
