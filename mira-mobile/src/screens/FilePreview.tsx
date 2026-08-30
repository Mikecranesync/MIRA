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
import { useEffect, useState } from "react";
import { requestBinary } from "../api/client";
import { fileBytesPath } from "../api/resources";
import { Loading, ErrorState } from "./common";
import { MediaViewer } from "./MediaViewer";
import { canHandOffNatively, openWithDevice, type HandoffResult } from "../lib/open-with";

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

export function isText(mimeType: string): boolean {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  return base.startsWith("text/") || base === "application/json";
}

/** Inline image — photos of nameplates/panels render here. Tapping opens the
 *  approved MediaViewer (commodity lightbox: pinch/zoom/double-tap); closing
 *  it lands back exactly here, sheet and scroll untouched. */
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
      {full && <MediaViewer url={url} filename={filename} onClose={() => setFull(false)} />}
    </>
  );
}


/** The one "open this with the device" control (Phase 3 item 3). On device
 *  the old blob-URL `<a download>` did NOTHING (no DownloadListener in the
 *  shell — audit §3.2), so native uses the OS share sheet via open-with.ts;
 *  the web build keeps the anchor, which browsers handle natively. */
function OpenWithButton({ url, filename, label }: { url: string; filename: string; label: string }) {
  const [state, setState] = useState<"idle" | "busy" | HandoffResult>("idle");
  const style = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
    width: "auto",
    padding: "0 18px",
    textDecoration: "none",
    color: "var(--fl-accent)",
  } as const;
  if (!canHandOffNatively()) {
    return (
      <a className="btn" href={url} download={filename} style={style}>
        {label}
      </a>
    );
  }
  return (
    <>
      <button
        className="btn"
        style={style}
        disabled={state === "busy"}
        onClick={async () => {
          setState("busy");
          setState(await openWithDevice(url, filename));
        }}
      >
        {state === "busy" ? "Preparing…" : label}
      </button>
      {state === "too_large" && (
        <div className="meta" style={{ marginTop: 6 }}>
          This file is too large to hand off to another app on the phone.
        </div>
      )}
      {state === "failed" && (
        <div className="meta" style={{ marginTop: 6 }}>
          Couldn&apos;t hand this file to the device — try again.
        </div>
      )}
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
      <OpenWithButton url={url} filename={filename} label="Open in your PDF viewer" />
    </div>
  );
}

/** Plain text renders directly (PRD §8 allows; audit gap "Text viewing").
 *  Provenance sidecars and pasted notes are small; anything bigger is
 *  truncated honestly with the handoff door still available below. */
const TEXT_PREVIEW_MAX_CHARS = 20_000;

function TextPreview({ url, filename }: { url: string; filename: string }) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetch(url)
      .then((r) => r.text())
      .then((t) => {
        if (!cancelled) setText(t);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  if (failed) return <OpaquePreview url={url} filename={filename} contentType="text/plain" />;
  if (text === null) return <Loading what="the text" />;
  const truncated = text.length > TEXT_PREVIEW_MAX_CHARS;
  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <pre
        style={{
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontSize: 13,
          lineHeight: 1.45,
          maxHeight: "60vh",
          overflowY: "auto",
          margin: 0,
        }}
      >
        {truncated ? text.slice(0, TEXT_PREVIEW_MAX_CHARS) : text}
      </pre>
      {truncated && (
        <div className="meta" style={{ marginTop: 8 }}>
          Showing the first part of {filename} — open it with another app for the full file.
        </div>
      )}
      {truncated && <OpenWithButton url={url} filename={filename} label="Open with another app" />}
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
      <OpenWithButton url={url} filename={filename} label="Open with another app" />
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
  if (isText(type)) return <TextPreview url={bytes.url} filename={filename} />;
  return <OpaquePreview url={bytes.url} filename={filename} contentType={type} />;
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
