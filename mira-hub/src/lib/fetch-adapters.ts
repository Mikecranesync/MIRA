// mira-hub/src/lib/fetch-adapters.ts
/**
 * Returns a Response object whose body is the file stream, plus parsed
 * metadata. Caller is responsible for forwarding the body to mira-ingest.
 */
export interface FetchedFile {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  sizeBytes: number | null;
}

export async function streamFromGoogleDrive(
  fileId: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<FetchedFile> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
    fileId,
  )}?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  });
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
  const res = await fetch(url, { signal });
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
