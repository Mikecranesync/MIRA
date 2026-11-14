/**
 * What the technician is shown for each component: an honest status and, per
 * document of the project, four facts kept apart (Mike 2026-11-14 rule 7):
 *
 *  - selected:   is the document switched on for this project (the project's choice);
 *  - model:      does its cover say it is for this component's model, for another
 *                model, or not say (manual-applicability.ts, the same reader the
 *                answer path uses);
 *  - ready:      can it be searched now (document-readiness.ts `searchable`);
 *  - passages:   never decided here. Which pages may answer is decided per
 *                question by the retrieval gate, which still excludes another
 *                model's table and partial-document pages. Confirming a
 *                component cannot change that.
 *
 * "Unknown" is never shown as ready. Pure.
 */
import { manualAnswersFor, manualCoversNumber, modelNumbersIn } from "@/capabilities/manual-applicability";
import type { NotebookSource } from "@/lib/equipment-notebooks";
import { componentManualsBlocked, type ComponentRevision } from "./selection";
import type { ComponentRecord, StoredRevision } from "./store";

export type ComponentStatus = "not_described" | "not_confirmed" | "confirmed_no_model" | "confirmed" | "retired";

export type DocumentFit = {
  docId: string;
  filename: string | null;
  /** The project's own on/off choice for the document. */
  selected: boolean;
  /** "covers": the cover names this component's number; "other_model": it names others only;
   *  "not_stated": it names none we can read; "unknown": the component has no number to check. */
  model: "covers" | "other_model" | "not_stated" | "unknown";
  /** Numbers the cover declares when it is for another model. */
  declared: string[];
  /** Searchable now (selected, confirmed, readable, not partial). */
  ready: boolean;
  readyLabel: string;
};

export type ComponentView = {
  id: string;
  position: number;
  kind: string | null;
  origin: ComponentRecord["origin"];
  status: ComponentStatus;
  /** Short words for the status chip. Never "ready" for an unknown. */
  statusLabel: string;
  /** "Asking about ___" — what the technician would call it. */
  label: string;
  current: ComponentRevision | null;
  documents: DocumentFit[];
  /** True when at least one selected, ready document's cover names this component's number. */
  hasOwnDocument: boolean;
  /** What the record rests on (a confirmation, the schedule, an earlier photo). Evidence, never identity. */
  evidence: string;
};

/** "VFD1 · AutomationDirect GS11N-20P2", "B1 (identity not confirmed)", "Component 4". */
export function componentLabel(c: Pick<ComponentRecord, "position" | "kind">, rev: ComponentRevision | null): string {
  const tag = rev?.localTag?.trim();
  const name = [rev?.manufacturer, rev?.catalogNumber ?? rev?.family].filter((v) => v && v.trim()).join(" ");
  if (tag && name) return `${tag} · ${name}`;
  return tag || name || (c.kind ? c.kind.replace(/_/g, " ") : `Component ${c.position + 1}`);
}

export const NO_EVIDENCE = "Nothing recorded yet.";

function evidenceOf(rev: StoredRevision | null): string {
  if (!rev) return NO_EVIDENCE;
  const parts: string[] = [];
  if (rev.identityStatus === "user_confirmed") parts.push("Confirmed by a technician.");
  if (rev.evidenceNote) parts.push(rev.evidenceNote);
  return parts.length > 0 ? parts.join(" ") : NO_EVIDENCE;
}

function statusOf(c: ComponentRecord): { status: ComponentStatus; statusLabel: string } {
  if (c.retiredAt) return { status: "retired", statusLabel: "removed from the checklist" };
  if (!c.current) return { status: "not_described", statusLabel: "not described yet" };
  const blocked = componentManualsBlocked(c.current);
  if (blocked === "not_confirmed") return { status: "not_confirmed", statusLabel: "identity not confirmed" };
  if (blocked === "no_model") return { status: "confirmed_no_model", statusLabel: "confirmed, no model number" };
  return { status: "confirmed", statusLabel: "confirmed" };
}

/**
 * One component's documents. `headings` maps docId → the document's opening text
 * (the same text the answer path reads as its cover).
 */
export function documentFits(rev: ComponentRevision | null, sources: readonly NotebookSource[], headings: ReadonlyMap<string, string>): DocumentFit[] {
  const asked = rev && rev.identityStatus === "user_confirmed" ? modelNumbersIn(rev.catalogNumber ?? rev.family ?? "") : [];
  return sources.map((s) => {
    const heading = headings.get(s.docId) ?? "";
    const filename = s.filename ?? "";
    let model: DocumentFit["model"] = "unknown";
    let declared: string[] = [];
    if (asked.length > 0) {
      if (asked.every((n) => manualCoversNumber(n, heading, filename))) model = "covers";
      else {
        const verdict = manualAnswersFor(asked, heading, filename);
        if (verdict.admit) model = "not_stated";
        else {
          model = "other_model";
          declared = verdict.declared;
        }
      }
    }
    return {
      docId: s.docId,
      filename: s.filename,
      selected: s.enabledByDefault,
      model,
      declared,
      ready: s.searchable,
      readyLabel: s.searchableLabel,
    };
  });
}

export function componentView(c: ComponentRecord, sources: readonly NotebookSource[], headings: ReadonlyMap<string, string>): ComponentView {
  const documents = documentFits(c.current, sources, headings);
  return {
    id: c.id,
    position: c.position,
    kind: c.kind,
    origin: c.origin,
    ...statusOf(c),
    label: componentLabel(c, c.current),
    current: c.current,
    documents,
    hasOwnDocument: documents.some((d) => d.selected && d.ready && d.model === "covers"),
    evidence: evidenceOf(c.current),
  };
}
