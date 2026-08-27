// In-app preview of an AUTHENTICATED file's original bytes.
//
// Everything here starts from `requestBinary` — never `window.open(url)`. On
// native the session cookie lives in our persisted jar, so an external open of
// a Hub URL lands on a login page, and handing the cookie to an external
// browser would breach the ADR-0034 trust boundary. We fetch the bytes with
// the session we already hold, wrap them in a `blob:` URL (which carries no
// credentials and is scoped to this WebView), and render locally. No remote
// application UI is ever loaded into the shell.
//
// ── PDF SEAM ───────────────────────────────────────────────────────────────
// `PdfPreview` below is the ONE place a real page renderer would plug in.
// The app currently has NO PDF rendering dependency and this lane did not add
// one: a PDF.js viewer is a substantial new package (worker bundle, its own
// asset-loading model) and adding it silently inside a UI task would be the
// wrong call. So the PDF path is honest instead of fake — it names the page
// the citation points at, offers the bytes to the device's own PDF viewer, and
// says plainly that in-app page rendering isn't available. Swapping in a
// renderer means replacing this one component; nothing else changes.
import { useEffect, useRef, useState } from "react";
import { requestBinary } from "../api/client";
import { fileBytesPath } from "../api/resources";
import { Loading, ErrorState } from "./common";

interface Bytes {
  url: string;
  contentType: string;
  sizeBytes: number;
}

export function useFileBytes(fileId: string | null | undefined): {
  state: "idle" | "loading" | "ready" | "error";
  bytes: Bytes | null;
  error: unknown;
} {
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [bytes, setBytes] = useState<Bytes | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!fileId) {
      setState("idle");
      setBytes(null);
      return;
    }
    let url: string | null = null;
    let cancelled = false;
    setState("loading");
    setError(null);
    void requestBinary(fileBytesPath(fileId))
      .then((r) => {
        if (cancelled) return;
        const blob = new Blob([r.bytes.slice().buffer as ArrayBuffer], { type: r.contentType });
        url = URL.createObjectURL(blob);
        setBytes({ url, contentType: r.contentType, sizeBytes: r.bytes.length });
        setState("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e);
        setState("error");
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [fileId]);

  return { state, bytes, error };
}

export function isImage(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

export function isPdf(mimeType: string): boolean {
  return mimeType === "application/pdf" || mimeType.endsWith("/pdf");
}

/** Inline image — photos of nameplates/panels render here. Tapping opens the
 *  conventional full-screen viewer (pinch/zoom/double-tap) below; closing it
 *  lands back exactly here, sheet and scroll untouched. */
function ImagePreview({ url, filename }: { url: string; filename: string }) {
  const [full, setFull] = useState(false);
  return (
    <>
      <img
        src={url}
        alt={filename}
        onClick={() => setFull(true)}
        style={{
          width: "100%",
          maxHeight: "60vh",
          objectFit: "contain",
          borderRadius: "var(--fl-radius)",
          background: "var(--fl-surface)",
          border: "1px solid var(--fl-line)",
          cursor: "zoom-in",
        }}
      />
      {full && <FullscreenImageViewer url={url} filename={filename} onClose={() => setFull(false)} />}
    </>
  );
}

/** See the PDF SEAM note at the top of this file. */
function PdfPreview({
  url,
  filename,
  page,
}: {
  url: string;
  filename: string;
  page?: number | null;
}) {
  return (
    <div
      className="card"
      style={{ marginBottom: 0, textAlign: "center", padding: "20px 14px" }}
    >
      <div style={{ fontSize: 34, lineHeight: 1 }}>📄</div>
      <div className="title" style={{ marginTop: 8 }}>
        {filename}
      </div>
      <div className="meta" style={{ marginTop: 4 }}>
        {page ? `Cited at page ${page}. ` : ""}
        The original opened successfully, but this app can't render PDF pages
        in-app yet — open it with your device's PDF viewer to see the page.
      </div>
      <a
        className="btn"
        href={url}
        download={filename}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          marginTop: 12,
          width: "auto",
          padding: "0 18px",
          textDecoration: "none",
          color: "var(--fl-accent)",
        }}
      >
        Open in your PDF viewer
      </a>
    </div>
  );
}

/** Anything we can neither render nor sensibly hand off. */
function OpaquePreview({
  url,
  filename,
  contentType,
}: {
  url: string;
  filename: string;
  contentType: string;
}) {
  return (
    <div className="card" style={{ marginBottom: 0, textAlign: "center" }}>
      <div style={{ fontSize: 34, lineHeight: 1 }}>🗄</div>
      <div className="title" style={{ marginTop: 8 }}>
        {filename}
      </div>
      <div className="meta">No in-app preview for {contentType}.</div>
      <a
        className="btn"
        href={url}
        download={filename}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          marginTop: 12,
          width: "auto",
          padding: "0 18px",
          textDecoration: "none",
          color: "var(--fl-accent)",
        }}
      >
        Open with another app
      </a>
    </div>
  );
}

/** Fetch-and-render the original. `page` is display context only — it labels
 *  what the citation pointed at; it never fakes a scroll to that page. */
export function FilePreview({
  fileId,
  filename,
  mimeType,
  page,
}: {
  fileId: string;
  filename: string;
  mimeType?: string | null;
  page?: number | null;
}) {
  const { state, bytes, error } = useFileBytes(fileId);
  if (state === "loading") return <Loading what="the original" />;
  if (state === "error") return <ErrorState error={error} />;
  if (!bytes) return null;
  const type = mimeType || bytes.contentType;
  if (isImage(type)) return <ImagePreview url={bytes.url} filename={filename} />;
  if (isPdf(type)) return <PdfPreview url={bytes.url} filename={filename} page={page} />;
  return <OpaquePreview url={bytes.url} filename={filename} contentType={type} />;
}

// ── Full-screen image viewer ────────────────────────────────────────────────
// Conventional controls a technician expects from every photo app: tap the
// inline image → full screen; pinch to zoom; drag to pan; double-tap to
// toggle zoom; close/back returns to exactly where you were (the underlying
// sheet never unmounts, so scroll position survives). Dependency-free by
// design (PRD §4 posture) — the transform math lives in pure functions below
// so it is unit-testable without a DOM.

export interface ZoomState {
  scale: number;
  tx: number;
  ty: number;
}

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 6;

export function clampZoom(z: ZoomState): ZoomState {
  const scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z.scale));
  // At scale 1 the image is fitted — panning away from center is meaningless
  // and lets the photo get "lost" off-screen. Pin translation toward zero as
  // scale approaches 1; at higher scales allow proportional pan.
  const range = (scale - 1) * 600; // generous bound; the img is object-fit contained
  return {
    scale,
    tx: Math.min(range, Math.max(-range, z.tx)),
    ty: Math.min(range, Math.max(-range, z.ty)),
  };
}

/** Pinch update: scale about the midpoint so the pinched spot stays put. */
export function pinchZoom(
  z: ZoomState,
  factor: number,
  midX: number,
  midY: number,
  viewportW: number,
  viewportH: number,
): ZoomState {
  const next = z.scale * factor;
  const cx = midX - viewportW / 2;
  const cy = midY - viewportH / 2;
  return clampZoom({
    scale: next,
    tx: cx - (cx - z.tx) * factor,
    ty: cy - (cy - z.ty) * factor,
  });
}

export function panBy(z: ZoomState, dx: number, dy: number): ZoomState {
  return clampZoom({ ...z, tx: z.tx + dx, ty: z.ty + dy });
}

/** Double-tap: zoomed → reset; fitted → 2.5x about the tapped point. */
export function doubleTapZoom(
  z: ZoomState,
  x: number,
  y: number,
  viewportW: number,
  viewportH: number,
): ZoomState {
  if (z.scale > 1.01) return { scale: 1, tx: 0, ty: 0 };
  return pinchZoom(z, 2.5, x, y, viewportW, viewportH);
}

// ── Close-tap + hardware-back plumbing (#3427) ─────────────────────────────
// On the Pixel the ✕ was dead to taps: the browser refuses to synthesize a
// click when the finger's micro-movement exceeds its tap slop (proven in a
// Chromium touch harness at ~20px; worse on glass, worse while zoomed) — but
// pointerup still reaches the button every time. So the button decides
// "was that a tap?" itself, on pointerup, with a slop generous enough for a
// real thumb. Pure function so it is unit-testable without a DOM.

export const CLOSE_TAP_SLOP = 32;

export function isCloseTap(downX: number, downY: number, upX: number, upY: number): boolean {
  return Math.hypot(upX - downX, upY - downY) <= CLOSE_TAP_SLOP;
}

// The viewer lives in private state deep inside whichever screen rendered the
// preview, so the per-screen backRef chains can't see it. Open viewers
// register here; the app-level backButton listener consults this FIRST, so
// hardware BACK closes viewer-then-sheet in order instead of tearing down the
// whole sheet with the viewer inside it.

let viewerBackStack: Array<() => void> = [];

/** Register an open viewer's closer; returns an idempotent unregister. */
export function registerViewerBack(close: () => void): () => void {
  const entry = () => close();
  viewerBackStack.push(entry);
  return () => {
    viewerBackStack = viewerBackStack.filter((e) => e !== entry);
  };
}

/** Close the most recently opened viewer. True if BACK was consumed. */
export function closeTopViewer(): boolean {
  const top = viewerBackStack[viewerBackStack.length - 1];
  if (!top) return false;
  top();
  return true;
}

export function _resetViewerBackForTest(): void {
  viewerBackStack = [];
}

export function FullscreenImageViewer({
  url,
  filename,
  onClose,
}: {
  url: string;
  filename: string;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState<ZoomState>({ scale: 1, tx: 0, ty: 0 });
  // Hardware BACK closes the viewer (not the sheet under it). Register once;
  // read the latest onClose through a ref so re-renders don't reorder the
  // LIFO stack.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => registerViewerBack(() => closeRef.current()), []);
  // The ✕ decides "tap or drag?" itself on pointerup — click synthesis is
  // unreliable on this surface (#3427).
  const closeDown = useRef<{ x: number; y: number } | null>(null);
  // Pointer bookkeeping for pinch/pan without any gesture library.
  const pointers = useState(() => new Map<number, { x: number; y: number }>())[0];
  const lastTap = useState(() => ({ t: 0 }))[0];
  const pinchDist = useState(() => ({ d: 0 }))[0];

  const dist = () => {
    const p = [...pointers.values()];
    return p.length < 2 ? 0 : Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  };
  const mid = () => {
    const p = [...pointers.values()];
    return p.length < 2
      ? { x: 0, y: 0 }
      : { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.92)",
        display: "flex",
        flexDirection: "column",
        // Root keeps touch-action none (no handlers): without it the browser
        // claims a jittery header tap as a native gesture and pointerup never
        // reaches the ✕ at all. The gesture HANDLERS live on the content
        // container below so header taps never enter pan/double-tap state.
        touchAction: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          // Device acceptance 2026-08-27: the overlay is position:fixed under
          // viewport-fit=cover, so without this inset the header renders inside
          // the Android status bar's input frame ([0,0][1080,152] on the Pixel
          // 9a) and the system consumes every tap on the ✕ before the WebView
          // sees it — the button was structurally unreachable (#3427's real
          // device mechanism, on top of the click-synthesis slop issue).
          padding: "calc(10px + env(safe-area-inset-top, 0px)) 14px 10px",
          color: "#fff",
          gap: 10,
        }}
      >
        <div
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 14,
            opacity: 0.9,
          }}
        >
          {filename}
        </div>
        <button
          aria-label="Close"
          onClick={onClose}
          onPointerDown={(e) => {
            e.stopPropagation();
            closeDown.current = { x: e.clientX, y: e.clientY };
          }}
          onPointerUp={(e) => {
            e.stopPropagation();
            const d = closeDown.current;
            closeDown.current = null;
            if (d && isCloseTap(d.x, d.y, e.clientX, e.clientY)) onClose();
          }}
          style={{
            background: "rgba(255,255,255,0.12)",
            color: "#fff",
            border: "none",
            borderRadius: 999,
            width: 36,
            height: 36,
            fontSize: 18,
            flex: "0 0 auto",
          }}
        >
          ✕
        </button>
      </div>
      <div
        style={{ flex: 1, overflow: "hidden", display: "flex", touchAction: "none" }}
        onPointerDown={(e) => {
          pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.size === 2) pinchDist.d = dist();
          if (pointers.size === 1) {
            const now = Date.now();
            if (now - lastTap.t < 300) {
              setZoom((z) =>
                doubleTapZoom(z, e.clientX, e.clientY, window.innerWidth, window.innerHeight),
              );
              lastTap.t = 0;
            } else {
              lastTap.t = now;
            }
          }
        }}
        onPointerMove={(e) => {
          const prev = pointers.get(e.pointerId);
          if (!prev) return;
          const dx = e.clientX - prev.x;
          const dy = e.clientY - prev.y;
          pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.size === 2) {
            const d = dist();
            if (pinchDist.d > 0 && d > 0) {
              const m = mid();
              setZoom((z) =>
                pinchZoom(z, d / pinchDist.d, m.x, m.y, window.innerWidth, window.innerHeight),
              );
            }
            pinchDist.d = d;
          } else if (pointers.size === 1) {
            setZoom((z) => (z.scale > 1.01 ? panBy(z, dx, dy) : z));
          }
        }}
        onPointerUp={(e) => {
          pointers.delete(e.pointerId);
          pinchDist.d = pointers.size === 2 ? dist() : 0;
        }}
        onPointerCancel={(e) => {
          pointers.delete(e.pointerId);
          pinchDist.d = 0;
        }}
      >
        <img
          src={url}
          alt={filename}
          draggable={false}
          style={{
            margin: "auto",
            maxWidth: "100%",
            maxHeight: "100%",
            objectFit: "contain",
            transform: `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.scale})`,
            transformOrigin: "center center",
            transition: pointers.size ? "none" : "transform 120ms ease-out",
            userSelect: "none",
          }}
        />
      </div>
    </div>
  );
}

/** Tiny authenticated thumbnail for a source row — the attachment-card
 *  affordance. Renders the image when the file IS an image, a conventional
 *  frame glyph while loading, and nothing exotic ever (no custom iconography:
 *  a JPEG looks like a JPEG). */
export function SourceThumb({ fileId }: { fileId: string }) {
  const { state, bytes } = useFileBytes(fileId);
  if (state === "ready" && bytes && isImage(bytes.contentType)) {
    return (
      <img
        src={bytes.url}
        alt=""
        style={{
          width: 40,
          height: 40,
          objectFit: "cover",
          borderRadius: 6,
          border: "1px solid var(--fl-line)",
          flex: "0 0 auto",
        }}
      />
    );
  }
  return <span aria-hidden>🖼</span>;
}
