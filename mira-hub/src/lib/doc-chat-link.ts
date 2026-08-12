// ARPK Phase 1d — the one place the per-document Chat deep link is built.
// A v2 upload is chattable at its namespace node with `doc=` scope; the
// documents list + detail surfaces both link here, and NodeChat reads the
// params in (hub)/namespace/page.tsx.

export interface DocChatTarget {
  doc_id: string | null;
  node_id: string | null;
  title: string;
}

/** Deep link into the namespace Ask MIRA panel scoped to ONE document. */
export function docChatHref(doc: DocChatTarget): string {
  return `/namespace?node=${doc.node_id}&chat=1&doc=${doc.doc_id}&docname=${encodeURIComponent(doc.title)}`;
}

/** A row is chattable when it carries the v2 keys (the caller's own upload). */
export function isDocChattable(doc: Pick<DocChatTarget, "doc_id" | "node_id">): boolean {
  return Boolean(doc.doc_id && doc.node_id);
}
