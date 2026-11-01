/**
 * Work Packet (#4982) — the document revision a packet was drafted from.
 *
 * CAT Pumps data sheets and service manuals print a footer line such as
 * `PN 993450 Rev G 22083 5/22` (data sheet 5CP6120) or `PN 30009 Rev J 8405`
 * (service manual 35FR2Svc). The revision is read VERBATIM from that line,
 * with its page and line as the source, so the technician can confirm the
 * packet matches the paper manual in their hand. No footer → the revision is
 * `unknown`, never guessed from the filename or a date.
 */
import type { DocText, Field } from "./types";

/** `PN <digits> Rev <letters/digits>` at the start of a trimmed line. */
const FOOTER_RE = /^PN\s+(\d{3,})\s+Rev\.?\s+([A-Z0-9]{1,3})\b/;

export function documentRevision(doc: DocText): Field {
  for (const { page, text } of doc.pages) {
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      const m = FOOTER_RE.exec(line);
      if (!m) continue;
      return {
        value: `PN ${m[1]} Rev ${m[2]}`,
        label: "verified",
        source: { docId: doc.docId, fileId: doc.fileId, filename: doc.filename, page, line },
        basis: "document footer (part number and revision)",
      };
    }
  }
  return {
    value: null,
    label: "unknown",
    source: null,
    basis: "no 'PN … Rev …' footer found in this document — check the revision printed on your copy",
  };
}
