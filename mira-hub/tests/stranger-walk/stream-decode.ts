/**
 * Chat stream text as the Hub sent it (#4460). The event stream carries no charset, so
 * Playwright's `res.text()` read it as Windows-1252 (⚠ → "âš "). Capture decodes the bytes as
 * UTF-8; recordings made before that fix are repaired byte-for-byte (stream-decode.test.ts).
 */

export function decodeChatBody(bytes: Uint8Array): string {
  return repairIfMisdecoded(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf8"));
}

/**
 * #5988: over CDP to Android Chrome (CV_TARGET=tablet) Playwright's `res.body()` itself hands back
 * the stream already read as Windows-1252, so ⛔ arrives as "â›”". Repair it only when the text is a
 * byte-wise mis-decode whose bytes are valid UTF-8; a correctly decoded stream (any character above
 * U+00FF, or a repair that would produce U+FFFD) is returned unchanged.
 */
export function repairIfMisdecoded(text: string): string {
  let repaired: string;
  try {
    repaired = repairMisdecodedStream(text);
  } catch {
    return text;
  }
  return repaired.includes("\uFFFD") && !text.includes("\uFFFD") ? text : repaired;
}

// Windows-1252 code points for bytes 0x80-0x9F; any other char < 0x100 is its own byte.
const CP1252 = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ";

export function repairMisdecodedStream(misdecoded: string): string {
  const bytes = [...misdecoded].map((ch) => {
    const i = CP1252.indexOf(ch);
    if (i >= 0) return 0x80 + i;
    const c = ch.codePointAt(0)!;
    if (c > 0xff) throw new Error(`not a byte-wise mis-decode: U+${c.toString(16)}`);
    return c;
  });
  return Buffer.from(bytes).toString("utf8");
}
