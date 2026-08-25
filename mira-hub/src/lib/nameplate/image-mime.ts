/**
 * Magic-byte image sniffing for the nameplate intake routes.
 *
 * Why this exists: mobile pickers lie about MIME. A real JPEG can arrive
 * declared `application/octet-stream` (the image half of the picker-mime
 * problem #3403 fixed for PDFs), and a declared-MIME-only gate then rejects a
 * perfectly good photo with 415. The bytes are the truth — sniff them before
 * rejecting, and only 415 when BOTH the declared and the sniffed type fail
 * the safelist. This never widens the safelist: a file whose bytes are not a
 * recognized raster image is still rejected regardless of what it claims.
 */

/** Returns the sniffed raster-image MIME, or null when the bytes match none. */
export function sniffImageMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }
  if (buf.length >= 6) {
    const head6 = buf.subarray(0, 6).toString("latin1");
    if (head6 === "GIF87a" || head6 === "GIF89a") return "image/gif";
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * The effective MIME for an uploaded image: the declared type when it is on
 * the safelist, else the sniffed type when THAT is on the safelist, else null
 * (reject). Declared wins when both pass — it may be more specific.
 */
export function effectiveImageMime(
  declared: string,
  buf: Buffer,
  allowed: readonly string[],
): string | null {
  const norm = (declared || "").toLowerCase().split(";")[0].trim();
  if (allowed.includes(norm)) return norm;
  const sniffed = sniffImageMime(buf);
  if (sniffed && allowed.includes(sniffed)) return sniffed;
  return null;
}
