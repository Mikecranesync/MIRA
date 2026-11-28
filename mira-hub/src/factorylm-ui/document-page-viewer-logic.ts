/**
 * Pure rules for the cited-page viewer (#5333). Kept free of the DOM so the
 * page's decisions (which file, which page, native viewer or drawn page, what
 * the technician is told) are testable without a browser.
 *
 * Why the viewer exists: Android Chrome has no inline PDF viewer
 * (`navigator.pdfViewerEnabled === false`). A framed PDF is swapped for a
 * `data:` placeholder, which the page CSP (`frame-src 'self'`) blocks, so the
 * source viewer showed "This content is blocked" on phones. Draw pages in an
 * embed or for an explicit citation. A standalone uncited file can open natively.
 */
import { API_BASE } from "@/lib/config";
import { isOemSourceAddress } from "@/capabilities/oem-source-hosts";

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

/** #6119: the same viewer for a public manufacturer manual, by its shared-library row id.
 *  The vendor's own address rides along (allowlisted hosts only) as the Open document fallback. */
export function viewerHrefForOem(entryId: string, page: number | null | undefined, sourceUrl?: string | null): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "/hub";
  const query = new URLSearchParams({ oem: entryId });
  if (page && page > 0) query.set("page", String(page));
  if (sourceUrl && isOemSourceAddress(sourceUrl)) query.set("src", sourceUrl);
  return `${base}/v3/source/?${query.toString()}`;
}

/** A parked upload (`?file=`) or a public manufacturer manual (`?oem=`, #6119). */
export type ViewerRequest =
  | { readonly fileId: string; readonly page: number | null }
  | { readonly oemId: string; readonly page: number | null; readonly sourceUrl?: string };

/** Reads `?file=…&page=…` or `?oem=…&page=…`. Neither, or both, is no request; a bad page is no page. */
export function parseViewerRequest(search: string): ViewerRequest | null {
  const params = new URLSearchParams(search);
  const fileId = (params.get("file") ?? "").trim();
  const oemId = (params.get("oem") ?? "").trim();
  if (fileId && oemId) return null;
  if (!fileId && !oemId) return null;
  const raw = params.get("page");
  const n = raw !== null && /^\d+$/.test(raw) ? Number(raw) : NaN;
  const page = Number.isSafeInteger(n) && n > 0 ? n : null;
  if (fileId) return { fileId, page };
  const src = params.get("src") ?? "";
  return isOemSourceAddress(src) ? { oemId, page, sourceUrl: src } : { oemId, page };
}

/** The byte route the viewer reads, at the page for a native viewer. */
export function requestBytesHref(req: ViewerRequest, page: number | null): string {
  if ("fileId" in req) return nativeFileHref(req.fileId, page);
  return `${API_BASE}/api/oem-sources/${encodeURIComponent(req.oemId)}/${page ? `#page=${page}` : ""}`;
}

/** Open document: the vendor's own allowlisted address when known (never fetched, only linked),
 *  otherwise the byte route. A manual the Hub can't load still opens at the vendor. */
export function openDocumentHref(req: ViewerRequest, page: number | null): string {
  if ("oemId" in req && req.sourceUrl) {
    if (req.sourceUrl.includes("#") || !page) return req.sourceUrl;
    return `${req.sourceUrl}#page=${page}`;
  }
  return requestBytesHref(req, page);
}

/** The id the caption names: the parked file, or the manual's shared-library row. */
export function requestId(req: ViewerRequest): string {
  return "fileId" in req ? req.fileId : req.oemId;
}

/** The platform handles only a standalone opening with no cited page. */
export function viewerMode(
  pdfViewerEnabled: boolean | undefined,
  request: { readonly embedded: boolean; readonly page: number | null },
): "native" | "render" {
  return pdfViewerEnabled === true && !request.embedded && request.page === null ? "native" : "render";
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
  // #6119: the Hub could not get its own copy of a manufacturer's manual.
  if (status === 502) return "This manual can't be loaded here. Use Open document.";
  return "This page couldn't be shown. Use Open document to try the file itself.";
}

/** The line that names exactly what is on screen: source, page and revision. */
export function pageCaption(name: string, page: number, numPages: number, fileId: string): string {
  return `${name} · page ${page} of ${numPages} · file ${fileId.slice(0, 8)}`;
}

/**
 * #6119: the Hub's copy of a manufacturer manual is the first good copy it fetched, and it is not
 * checked against the edition that was indexed, so the viewer says so. A parked upload is the
 * customer's own file and gets no notice.
 */
export function oemCopyNotice(req: ViewerRequest, fetchedAtHeader: string | null): string | null {
  if (!("oemId" in req)) return null;
  const t = fetchedAtHeader ? Date.parse(fetchedAtHeader) : NaN;
  const when = Number.isFinite(t) ? ` fetched ${new Date(t).toISOString().slice(0, 10)}` : "";
  return `Hub copy${when}, not checked against the indexed edition.`;
}
