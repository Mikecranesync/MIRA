/**
 * Composer attachments for the unified shell.
 *
 * Owns the whole ChatGPT-shaped flow in ONE canonical place: the native pick,
 * holding the bytes while the technician types, the upload when they finally
 * send, and composing the evidence rider that upload produces.
 *
 * It does not own transport. Photos go through the EXISTING LOOK door
 * (`lookAtPhoto` — parks + links server-side, then returns the fileId the
 * `visualEvidence` rider carries) and documents through the EXISTING two-step
 * source upload (`uploadSourceToNotebook`). There is still exactly one upload
 * path per kind and one send path; this module only decides when they run.
 *
 * Why here and not in the notebook screen: the screen is a frozen legacy
 * rollback surface (docs/architecture/convergence/UNIFIED_UI_CUTOVER.md). New
 * product behaviour belongs to the shared shell, so the orchestration lives in
 * the canonical adapter tree and the screen keeps only its send path.
 */
import { useCallback, useRef } from "react";
import type { Attachment } from "@factorylm/interaction";
import {
  getNotebookDetail,
  lookAtPhoto,
  uploadSourceToNotebook,
} from "../api/resources";
import { uploadSourceWarningCopy } from "../lib/resource-copy";
import { PDF_MIME, capturePhoto, pickDocument, pickPhoto } from "../lib/native-pick";
import { lookQuestion } from "../lib/sensor";
import { claimAttachments, stashAttachments, type HeldAttachment } from "./attachment-handoff";

const PHOTO_ANALYSIS_UNAVAILABLE =
  "The photo was saved, but MIRA couldn't analyze it. Try another photo before asking about it.";

/** The rider shape the notebook's send path already accepts for Sensor. */
export interface VisualEvidenceRider {
  readonly visualEvidence: { fileId: string; capturedAt: string };
}

export interface ComposedSend {
  /** The question to send — the technician's words, or an honest default. */
  readonly question: string;
  /** Present only when a photo was attached and its upload succeeded. */
  readonly rider?: VisualEvidenceRider;
  /** Set when a document uploaded but could not be indexed. */
  readonly warning?: string;
  /** Set when the attachment failed outright; the caller must not send. */
  readonly failure?: string;
}

function describe(file: File): Attachment {
  return {
    id: crypto.randomUUID(),
    name: file.name,
    mediaType: file.type,
    kind: file.type.startsWith("image/") ? "photo" : file.type === PDF_MIME ? "pdf" : "file",
    status: "ready",
  };
}

/**
 * `notebookId` is null on HOME, where no notebook exists yet. Picking still
 * works there; the bytes are stashed for the thread the send creates.
 */
export function useUnifiedAttachments(notebookId: string | null) {
  // The shell only ever carries the small `Attachment` descriptor; the bytes
  // stay here, keyed by the id the chip shows.
  const held = useRef(new Map<string, File>());
  const claimed = useRef(false);

  // Anything handed over from HOME has no chip in THIS composer — it was
  // attached before this notebook existed — so it is claimed once and folded
  // into the same held map, then merged in at send time.
  const carried = useRef<readonly HeldAttachment[]>([]);
  if (!claimed.current && notebookId) {
    claimed.current = true;
    carried.current = claimAttachments();
    for (const item of carried.current) held.current.set(item.attachment.id, item.file);
  }

  /** True when HOME handed this composer bytes it has not yet sent. The initial
   *  question must compose (and so upload) those, or the very turn the
   *  technician attached them to is answered without them. */
  const hasCarried = useCallback(() => carried.current.length > 0, []);

  const hold = useCallback((file: File | null): Attachment | null => {
    if (!file) return null; // backed out of the native picker
    const attachment = describe(file);
    held.current.set(attachment.id, file);
    return attachment;
  }, []);

  const attachPhoto = useCallback(async () => hold(await pickPhoto("photo.jpg")), [hold]);
  const attachCamera = useCallback(async () => hold(await capturePhoto("photo.jpg")), [hold]);
  const attachFile = useCallback(async () => hold(await pickDocument()), [hold]);

  /** Park what this composer is holding for the thread a HOME send creates. */
  const stashForHandoff = useCallback((attachments: readonly Attachment[]) => {
    const items: HeldAttachment[] = [];
    for (const attachment of attachments) {
      const file = held.current.get(attachment.id);
      if (file) items.push({ attachment, file });
      held.current.delete(attachment.id);
    }
    stashAttachments(items);
  }, []);

  /**
   * Upload what was held and compose the send. Returns the question plus the
   * rider, so the caller performs exactly one send through its own path.
   */
  const compose = useCallback(async (
    raw: string,
    attachments: readonly Attachment[],
  ): Promise<ComposedSend> => {
    const items = [...carried.current.map((c) => c.attachment), ...attachments]
      .map((attachment) => ({ attachment, file: held.current.get(attachment.id) }))
      .filter((x): x is { attachment: Attachment; file: File } => Boolean(x.file));
    carried.current = [];
    const text = raw.trim();
    if (items.length === 0 || !notebookId) return { question: text };

    const photo = items.find((x) => x.attachment.kind === "photo");
    const documents = items.filter((x) => x.attachment.kind !== "photo");
    // An attachment with no typed question still deserves a question.
    const question = text || (photo
      ? "What am I looking at, and what should I check?"
      : "What is in this document?");
    let composedQuestion = question;

    // A failure must leave the bytes armed for another attempt. `held` still
    // has them (they are dropped only on success, below), but `carried` was
    // cleared above and the composer has already released its chip — so a retry
    // would compose NOTHING and send the photo question with no photo, the one
    // outcome this module refuses. Put the items back on every failure path.
    const retain = () => { carried.current = items; };

    let warning: string | undefined;
    try {
      if (documents.length > 0) {
        // The source-upload door needs the namespace node, which the shell does
        // not carry. Resolve it from the notebook the shell already names rather
        // than threading a new prop through the frozen screen.
        const detail = await getNotebookDetail(notebookId);
        for (const doc of documents) {
          const result = await uploadSourceToNotebook(detail.notebook, doc.file, { sourceRole: "manual" });
          // Indexing failures stay honest: the file uploaded, it is just not
          // searchable, and the technician is told so rather than left to assume.
          if (!result.attached) warning = uploadSourceWarningCopy(result.warning);
        }
      }

      let rider: VisualEvidenceRider | undefined;
      if (photo) {
        const look = await lookAtPhoto(notebookId, photo.file, crypto.randomUUID(), question);
        if (!look.fileId) {
          // Never send a photo question without the photo: that would answer
          // from nothing while looking like it answered from the picture.
          retain();
          return { question, failure: "The photo didn't upload — try again." };
        }
        if (!look.observation) {
          // A saved file ID proves storage, not visual understanding. Do not
          // let retrieval answer the technician from an unrelated manual when
          // LOOK could not describe the image.
          retain();
          return { question, failure: PHOTO_ANALYSIS_UNAVAILABLE };
        }
        composedQuestion = lookQuestion(
          look.observation.text,
          look.observation.capturedAt,
          question,
        );
        rider = {
          visualEvidence: {
            fileId: look.fileId,
            capturedAt: look.observation.capturedAt,
          },
        };
      }

      for (const item of items) held.current.delete(item.attachment.id);
      return { question: composedQuestion, rider, warning };
    } catch (error) {
      retain();
      throw error;
    }
  }, [notebookId]);

  return { attachPhoto, attachCamera, attachFile, compose, stashForHandoff, hasCarried };
}
