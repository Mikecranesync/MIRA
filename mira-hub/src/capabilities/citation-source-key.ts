/**
 * The ONE identity of a citable source page (#6030 F3).
 *
 * A notebook (v2) chunk is bound to an admitted document: two documents can share a file name and a
 * physical page (a re-upload, a copy) and must get separate citation numbers, chips and validations.
 * So a document-bound chunk is keyed by (document id, file, physical page). A chunk with no document id
 * (the shared-OEM lane) keeps the legacy (file, page) key byte-for-byte.
 *
 * Pure and import-free so the prompt builder, the chat route, the source/claim validators and the
 * safety-statement reader all share it without a cycle. Numbering everywhere is "n-th distinct key in
 * chunk order": change the key here and every site moves together.
 */
export function citationSourceKey(c: { docId?: string | null; sourceUrl: string; sourcePage: number | null }): string {
  const page = `${c.sourceUrl}::${c.sourcePage ?? ""}`;
  return c.docId ? `${c.docId}::${page}` : page;
}
