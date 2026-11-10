/**
 * Pure rules for the cited-page viewer (#5333). Kept free of the DOM so the
 * page's decisions (which file, which page, native viewer or drawn page, what
 * the technician is told) are testable without a browser.
 *
 * Why the viewer exists: Android Chrome has no inline PDF viewer
 * (`navigator.pdfViewerEnabled === false`). A framed PDF is swapped for a
 * `data:` placeholder, which the page CSP (`frame-src 'self'`) blocks, so the
 * source viewer showed "This content is blocked" on every phone. Desktop
 * browsers keep their own viewer: the page hands straight over to the file.
 */
import { API_BASE } from "@/lib/config";

/** The same-origin page that shows one cited page of a parked document. */
export function viewerHref(fileId: string, page: number | null | undefined): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "/hub";
  const query = new URLSearchParams({ file: fileId });
  if (page && page > 0) query.set("page", String(page));
  return `${base}/v3/source/?${query.toString()}`;
}

/** The byte route of the parked original, at its cited page for a native viewer. */
export function nativeFileHref(fileId: string, page: number | null): string {
  return `${API_BASE}/api/namespace/files/${encodeURIComponent(fileId)}/${page ? `#page=${page}` : ""}`;
}

export interface ViewerRequest {
  readonly fileId: string;
  readonly page: number | null;
}

/** Reads `?file=…&page=…`. A missing file is no request; a bad page is no page. */
export function parseViewerRequest(search: string): ViewerRequest | null {
  const params = new URLSearchParams(search);
  const fileId = (params.get("file") ?? "").trim();
  if (!fileId) return null;
  const raw = params.get("page");
  const n = raw !== null && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return { fileId, page: Number.isSafeInteger(n) && n > 0 ? n : null };
}

/** Native viewer when the browser has one; otherwise MIRA draws the page. */
export function viewerMode(pdfViewerEnabled: boolean | undefined): "native" | "render" {
  return pdfViewerEnabled === true ? "native" : "render";
}

/** The page actually shown: the cited one when it exists, else the first. */
export function pageToShow(cited: number | null, numPages: number): { page: number; outOfRange: boolean } {
  if (cited === null) return { page: 1, outOfRange: false };
  if (cited > numPages) return { page: 1, outOfRange: true };
  return { page: cited, outOfRange: false };
}

/** `inline; filename="GS10 manual.pdf"` → `GS10 manual.pdf`. */
export function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* fall through to the plain form */
    }
  }
  const plain = /filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;]+)/i.exec(header);
  const name = (plain?.[1] ?? plain?.[2] ?? "").trim();
  if (!name) return null;
  // The file route percent-encodes the stored name (spaces left as spaces).
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

export function isPdf(contentType: string | null): boolean {
  return /^application\/pdf\b/i.test(contentType ?? "");
}

/** What the technician reads when the page cannot be shown. Plain words, one next step. */
export function failureMessage(status: number): string {
  if (status === 401 || status === 403) return "You're signed out. Sign in again, then reopen this source.";
  if (status === 404) return "This document is no longer in this workspace.";
  return "This page couldn't be shown. Use Open document to try the file itself.";
}

/** The line that names exactly what is on screen: source, page and revision. */
export function pageCaption(name: string, page: number, numPages: number, fileId: string): string {
  return `${name} · page ${page} of ${numPages} · file ${fileId.slice(0, 8)}`;
}
