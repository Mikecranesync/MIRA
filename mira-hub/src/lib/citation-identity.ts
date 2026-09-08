/**
 * Citation identity — the name a TECHNICIAN sees on a cited source (gate E-1).
 *
 * The product's whole claim is grounded answers with cited sources. The
 * 2026-09-07 mobile teardown found the claim rendering as:
 *
 *     FILE  nameplate-12ac8c22-018a-4104-a247-d81c37bdb292.txt   p. 1
 *
 * under the answer "Serial number 49849 is listed on the nameplate [1]." The
 * `[1]` marker, the kind label and the page number were all correct. The name
 * was a database key. A technician cannot tell which document that is, cannot
 * say it aloud to a colleague, and cannot check it — a citation in form only.
 *
 * Two halves live here because they fix the same defect at different ends:
 *
 *   `nameplateDocTitle`   — the PRODUCER. A derived document's stored filename
 *                           IS its citation label (retrieval reads
 *                           `metadata->>'filename'` into `ManualChunk.title`,
 *                           and that becomes `sourceTitle`), so a generated doc
 *                           must be given a name a human would choose.
 *   `humanCitationTitle`  — the READ path. Documents already stored under a
 *                           generated name keep it forever, and they are the
 *                           ones being cited today. The reader refuses to hand
 *                           a database key to a person.
 *
 * Uploaded PDFs never had this problem: their stored filename is the name the
 * technician gave the file, which is why real citations off a handset read
 * "…_End_Trucks_Owners_Manual (2).pdf p.7". Only DERIVED documents needed a
 * name chosen for them.
 */

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Just enough of a confirmed nameplate identity to name the document. */
export type NameplateIdentityFields = {
  manufacturer?: string | null;
  model?: string | null;
  catalogNumber?: string | null;
};

/**
 * The filename — and therefore the citation label — for a technician-confirmed
 * nameplate document.
 *
 * Safe to change from the old `nameplate-<photo-uuid>.txt`: the filename is a
 * label, not a key. Re-confirmation dedups on the canonical file hash, and the
 * origin photo is found by `fileId` via `findVisibleOriginSource`; neither
 * reads this string.
 *
 * Deterministic, like the bytes it names — same identity in, same name out — so
 * a replayed confirmation still reuses its document rather than minting one.
 *
 * Never invents a machine: with no confirmed make or model it falls back to the
 * notebook, then to the bare kind. It never emits a UUID at any branch.
 */
export function nameplateDocTitle(opts: {
  identity: NameplateIdentityFields;
  notebookName: string;
}): string {
  const model = (opts.identity.model || opts.identity.catalogNumber || "").trim();
  const machine = [(opts.identity.manufacturer ?? "").trim(), model]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (machine) return `Nameplate — ${machine}.txt`;
  const notebook = opts.notebookName.trim();
  if (notebook) return `Nameplate — ${notebook}.txt`;
  return "Nameplate.txt";
}

/** Why a citation label is not the stored title. Kept out of the UI; the point
 *  is that the trace can tell these apart even when the screen cannot. */
export type CitationTitleReason = "stored" | "missing" | "generated_key";

export type CitationTitleResult = {
  title: string;
  reason: CitationTitleReason;
};

/**
 * Resolve the label for a cited source, and say WHY it is what it is.
 *
 * A floor that silently rewrote every unreadable title to "Attached document"
 * would collapse *"the title lookup broke"* and *"this document has no name"*
 * into one indistinguishable outcome — a green surface that cannot tell a
 * working lookup from a dead one. So the reason is returned rather than
 * inferred, and callers log it. Same discipline as an ungrounded answer having
 * to SAY it is ungrounded instead of merely omitting its citations.
 */
export function resolveCitationTitle(rawTitle: string | null | undefined): CitationTitleResult {
  const title = (rawTitle ?? "").trim();
  if (!title) return { title: "Attached document", reason: "missing" };
  if (!UUID_RE.test(title)) return { title, reason: "stored" };

  // A generated name from before `nameplateDocTitle`. Keep whatever human
  // prefix it carries ("nameplate-<uuid>.txt" -> "Nameplate"); never invent a
  // machine name that the stored title did not contain.
  const prefix = title.split(UUID_RE)[0].replace(/[-_\s]+$/, "").trim();
  const cleaned = prefix ? prefix.charAt(0).toUpperCase() + prefix.slice(1) : "Attached document";
  return { title: cleaned, reason: "generated_key" };
}
