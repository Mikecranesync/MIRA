// mira-hub/src/lib/fetch-adapters.ts
import { composeTimeout, isAbortError } from "./abort-helpers";
import { assertSafeUrl } from "./ssrf-guard";

const MAX_REDIRECTS = 3;

/**
 * Returns a Response object whose body is the file stream, plus parsed
 * metadata. Caller is responsible for forwarding the body to mira-ingest.
 */
export interface FetchedFile {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  sizeBytes: number | null;
}

const DRIVE_TIMEOUT_MS = 60_000;
const SIGNED_URL_TIMEOUT_MS = 60_000;

export async function streamFromGoogleDrive(
  fileId: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<FetchedFile> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
    fileId,
  )}?alt=media&supportsAllDrives=true`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: composeTimeout(signal, DRIVE_TIMEOUT_MS),
    });
  } catch (err) {
    if (isAbortError(err)) throw new Error(`timeout: drive fetch (${DRIVE_TIMEOUT_MS}ms)`);
    throw err;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`drive fetch ${res.status}: ${body.slice(0, 200)}`);
  }
  if (!res.body) throw new Error("drive response has no body");
  const lenHeader = res.headers.get("content-length");
  return {
    stream: res.body,
    contentType: res.headers.get("content-type") ?? "application/pdf",
    sizeBytes: lenHeader ? Number(lenHeader) : null,
  };
}

export async function streamFromSignedUrl(
  url: string,
  signal?: AbortSignal,
): Promise<FetchedFile> {
  // Validate the user-controlled URL before any network I/O — protocol,
  // hostname allowlist, no IP literals. Throws SsrfBlockedError on
  // rejection (caller catches and surfaces as upload failure).
  let target = assertSafeUrl(url);

  // Manual redirect handling: every Location must re-pass the SSRF check
  // so a 302 from dropboxusercontent.com to 169.254.169.254 is rejected.
  const composedSignal = composeTimeout(signal, SIGNED_URL_TIMEOUT_MS);
  let res: Response | null = null;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    try {
      res = await fetch(target.toString(), {
        signal: composedSignal,
        redirect: "manual",
      });
    } catch (err) {
      if (isAbortError(err)) throw new Error(`timeout: signed url fetch (${SIGNED_URL_TIMEOUT_MS}ms)`);
      throw err;
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error(`signed url ${res.status} with no location`);
      // Resolve relative redirects against the previous target
      target = assertSafeUrl(new URL(location, target).toString());
      continue;
    }
    break;
  }
  if (!res) throw new Error("signed url: redirect loop");
  if (res.status >= 300 && res.status < 400) {
    throw new Error(`signed url: too many redirects (>${MAX_REDIRECTS})`);
  }
  if (!res.ok) {
    throw new Error(`signed url fetch ${res.status}`);
  }
  if (!res.body) throw new Error("signed url response has no body");
  const lenHeader = res.headers.get("content-length");
  return {
    stream: res.body,
    contentType: res.headers.get("content-type") ?? "application/pdf",
    sizeBytes: lenHeader ? Number(lenHeader) : null,
  };
}
