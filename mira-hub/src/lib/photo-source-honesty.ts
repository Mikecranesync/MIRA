/**
 * PHOTO-SOURCE HONESTY — notebook chat context is `ManualChunk[]`, i.e. TEXT
 * ONLY. When a technician attaches a nameplate or panel PHOTOGRAPH, the picture
 * is read by a vision model at confirm time and stored as an extracted-text
 * document; the image bytes themselves never reach the chat model.
 *
 * Whether a photograph is attached is therefore SERVER STATE (an
 * `equipment_notebook_sources` row), not something the chat model may infer
 * from the excerpts it was handed.
 *
 * THE DEFECT THIS FIXES (observed on a Pixel 9a against production,
 * 2026-09-02). A notebook had two photo-derived sources attached and
 * checkbox-included. The technician asked "Can you read the wire numbers from
 * the photo that's attached?" and MIRA answered "I can't read wire numbers
 * because no photo was provided", then, when pushed, "No photo was included in
 * the provided sources." Both are FALSE: the app's own Sources sheet was
 * showing the technician thumbnails and a "· photo" label for those exact rows.
 *
 * The model's LIMITATION is real — it cannot see the image. Denying the
 * photograph's EXISTENCE is the bug. And the denial is doubly wrong, because
 * the extracted text it was already holding was itself produced by a vision
 * reader looking at that photograph (`nameplate/confirm/route.ts` writes a
 * "RAW NAMEPLATE OBSERVATION (unedited vision extraction)" section). The
 * answer the technician deserved was either the wire numbers, read out of that
 * extraction, or "the extraction doesn't contain them" — never "there is no
 * photo".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INVARIANT — THIS MODULE NEVER READS OR MUTATES MODEL TEXT, AND EXPORTS NO
 * FUNCTION CAPABLE OF DOING SO.
 *
 * Two earlier designs were built and rejected under adversarial review; both
 * failures came from touching the answer, so this one cannot touch it at all.
 *
 *   ROUND 1 — a streaming transformer that REPLACED whole sentences of the
 *   answer with a server-authored constant. Refuted 3/3:
 *     · REFERENT MISMATCH — the server can prove "a photo is in scope", never
 *       "the photo you meant is attached". Truthful denials about a DIFFERENT
 *       picture ("No photo of the motor terminal box was provided") were
 *       rewritten into false affirmations: the original violation, inverted.
 *     · DESTROYED CORRECT REFUSALS — replacement was sentence-granular, so a
 *       true negative finding that merely MENTIONED a photo was deleted, from
 *       the stream and from the persisted turn.
 *     · CLASSIFICATION COUPLING — the injected constant satisfied `isRefusal`,
 *       so corrected answers flipped to `insufficient_evidence` and lost their
 *       citation chips.
 *     · NAIVE SENTENCE SPLITTER — splitting on `[.!?\n]` breaks on decimals and
 *       abbreviations. Verified output: "The nameplate lists 1." — a
 *       manufactured wrong technical value in a maintenance answer.
 *
 *   ROUND 2 — no mutation; a true notice APPENDED after classification.
 *   Non-destructive, but refuted on its own new harm: every row it could
 *   describe is a `.txt` document, so calling them "photographs attached to
 *   this notebook" was itself server-authored falsehood, and its closing clause
 *   ("nothing in this chat has been read off a picture") contradicted the
 *   vision extraction that produced the very chunks being cited.
 *
 * What survived both reviews is the part below: the PROOF (which rows are
 * pictures) and the PRIOR (telling the model the truth before it answers).
 * There is deliberately no detection of denial phrasings and no server-authored
 * prose in the answer stream. If the model disobeys the directive the defect
 * still ships — that residual is real, is unmeasured, and is why
 * `photoTurnObservation` emits a denominator.
 *
 * Lives in `src/lib/` rather than inside the route so `/api/assets/[id]/chat`
 * (same defect, its own source rows) can adopt it with no duplication.
 */

/** A source row this turn proved is a picture the technician can see.
 *  `role` separates a row the product deliberately marked as a photograph from
 *  one merely DERIVED from an attached file, so no caller can call the latter
 *  "a photograph". */
export type PhotoSourceRef = { docId: string; filename: string | null; role: "photo" | "derived" };

/** The two columns the mobile Sources sheet renders from (NotebookScreen.tsx):
 *  a thumbnail when `originFileId` is set, a "· photo" label when
 *  `sourceRole === "photo"`. Using exactly that union here is what makes the
 *  prompt and the technician's screen unable to disagree. */
export function isPhotoSource(s: { sourceRole: string | null; originFileId: string | null }): boolean {
  // `!= null` (not `!== null`) is deliberate: an ABSENT field is not evidence
  // of a photo. `originFileId !== null` is true for `undefined`, which would
  // make every row that merely omits the column read as photo-derived and arm
  // this module on turns with no photo at all. Presence of a real id is the
  // only positive signal.
  return s.sourceRole === "photo" || s.originFileId != null;
}

/** Intersect the notebook's sources with THIS turn's server-revalidated doc set
 *  (`validated.docIds`). That makes the result PROOF rather than a heuristic,
 *  and scopes it to the turn rather than the notebook: a picture the technician
 *  unchecked is attached but NOT selected, and must not be described as being
 *  in this chat. */
export function photoSourcesInScope(
  sources: { docId: string; filename: string | null; sourceRole: string | null; originFileId: string | null }[],
  docIds: string[],
): PhotoSourceRef[] {
  const scope = new Set(docIds);
  return sources
    .filter((s) => scope.has(s.docId) && isPhotoSource(s))
    .map((s) => ({
      docId: s.docId,
      filename: s.filename,
      role: s.sourceRole === "photo" ? ("photo" as const) : ("derived" as const),
    }));
}

/** The prompt-side statement of fact plus the honest formulation to use.
 *
 *  Returns EXACTLY "" when nothing is proven. That empty-string property is what
 *  keeps the composed prompt byte-identical on a no-photo turn, and it is
 *  pinned by a test.
 *
 *  `attachedCount` is the notebook-wide count of attached pictures; when it
 *  exceeds the in-scope count the directive supplies "attached but not selected"
 *  so the model does not reach for "not provided". */
export function photoSourceDirective(inScope: PhotoSourceRef[], attachedCount = inScope.length): string {
  const n = inScope.length;
  if (n === 0) return "";
  const photos = inScope.filter((s) => s.role === "photo").length;
  const derived = n - photos;

  // Bucketed so a document merely derived from an attached file is never called
  // a photograph. Round 2 was refuted for exactly that conflation.
  let head: string;
  if (derived === 0) {
    head =
      `${n} of the source documents listed above ${n === 1 ? "is text extracted from a photograph" : "are text extracted from photographs"} ` +
      `the technician attached to this notebook and can see, with thumbnails, in this app's Sources list right now.`;
  } else {
    const parts: string[] = [];
    if (photos > 0) parts.push(`${photos} from ${photos === 1 ? "a photograph" : "photographs"}`);
    parts.push(`${derived} from ${derived === 1 ? "another attached file" : "other attached files"} shown with thumbnails`);
    head =
      `${n} of the source documents listed above ${n === 1 ? "is text extracted from a picture" : "are text extracted from pictures"} ` +
      `the technician attached to this notebook and can see in this app's Sources list right now — ${parts.join(" and ")}.`;
  }

  const bullets: string[] = [
    // The falsehood, named. This is the observed production defect.
    `NEVER say that no photo was provided, that none was included or attached, or that there is no image. That is false, and it contradicts what the technician is looking at on their screen.`,
    // The limitation, in the model's own frame. "At most" rather than "ONLY"
    // because a general-mode turn may carry no extracted text at all.
    `You cannot see, view, or zoom into the picture itself — the image is never in your context. At most you receive text that was extracted from it.`,
    // The vision-extraction fact. Without this the model treats the extracted
    // text as ordinary document text and refuses photo questions it can
    // actually answer. This is the bullet that turns a refusal into an answer.
    `That extracted text was produced by a vision reader looking at the photograph, so it may already contain what is being asked for. Search it before you decline.`,
    // The exact shape of an honest answer to the question that produced the
    // production defect.
    `If asked to read something off a photo (wire numbers, terminal labels, a legend, a gauge, a rating plate): answer from the extracted text if it covers the question; if it does not, say the photograph IS attached but that the text extracted from it does not contain that detail. Never answer by denying the photograph.`,
    // The referent bullet. The server cannot resolve WHICH picture the
    // technician meant, so the model is told to name what is attached rather
    // than deny pictures in general.
    `If asked about a photo of something that is NOT among the attached sources, name which pictures ARE attached rather than denying photographs in general.`,
  ];

  const other = attachedCount - n;
  if (other > 0) {
    bullets.push(
      `Of the pictures attached to this notebook, ${n} ${n === 1 ? "is" : "are"} included in this chat; ` +
        `the ${other === 1 ? "other" : "others"} ${other === 1 ? "is" : "are"} attached but not selected right now — ` +
        `say "not selected for this chat", never "not provided".`,
    );
  }

  // The anti-hallucination floor. Not seeing the image is a limitation to
  // state, never a gap to fill.
  bullets.push(
    `Never describe, summarize, or infer what a picture looks like, and never state a wire number, label, terminal, or value you did not read in an excerpt.`,
  );

  return (
    `\n- ATTACHED PICTURES: ${head} This is verified server state, not an inference from the excerpts.` +
    bullets.map((b) => `\n  - ${b}`).join("")
  );
}

/** Structured observability for a served turn that had a picture attached.
 *
 *  The directive is a prompt instruction handed to a probabilistic model, so its
 *  compliance rate is unknown and currently unmeasurable. This emits the
 *  DENOMINATOR — how often photo turns happen at all — so that rate can be
 *  established later by joining to `equipment_notebook_turns` on
 *  (tenantId, notebookId, time). Deliberately carries no free text: the question
 *  and the answer already live in that table. */
export function photoTurnObservation(input: {
  tenantId: string;
  notebookId: string;
  photosAttached: number;
  photosInScope: number;
  answerStatus: string;
  citationCount: number;
  general: boolean;
}): Record<string, unknown> {
  return {
    service: "mira-hub",
    component: "notebook-chat",
    event: "photo.turn",
    tenantId: input.tenantId,
    notebookId: input.notebookId,
    photosAttached: input.photosAttached,
    photosInScope: input.photosInScope,
    answerStatus: input.answerStatus,
    citationCount: input.citationCount,
    general: input.general,
  };
}
