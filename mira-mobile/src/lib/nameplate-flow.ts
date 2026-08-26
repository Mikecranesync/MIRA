// The component-nameplate workflow, as an EXPLICIT pure state machine.
//
// Why a reducer and not ad-hoc booleans: this flow has nine states, three of
// which are server-driven progress stages and six of which are honest terminal
// failures. Screens that model it with `busy`/`error` flags inevitably claim
// success early ("Manual added") while the server is still downloading, or
// land an error and a completion at the same time. Here `complete` is
// reachable ONLY from a server result that PROVES a citable source exists
// (an indexed doc with a trusted match state — see
// `confirmYieldedCitableSource`), and no event can move an `error` into
// `complete`. A retained file is not a source.
//
// HARD PRODUCT RULE encoded here: this is a COMPONENT inside the machine the
// notebook describes. Nothing in this module produces a notebook-identity
// patch — a contactor photo must never rename a PowerFlex notebook.

import type {
  ComponentIdentity,
  ConfirmComponentResult,
  ConfirmComponentStatus,
  ConfirmedManual,
  ManualCandidateView,
} from "../api/resources";
import { EMPTY_COMPONENT_IDENTITY, confirmYieldedCitableSource } from "../api/resources";

export type NameplateStateName =
  | "selecting_photo"
  | "uploading"
  | "recognizing"
  | "confirm_identity"
  | "searching"
  | "downloading"
  | "indexing"
  | "candidate_review"
  | "complete"
  | "error";

/** Terminal/error reasons. Each maps to ONE honest technician sentence. */
export type NameplateErrorReason =
  | "unreadable_nameplate"
  | "manufacturer_model_required"
  | "no_manual_found"
  | "no_extractable_text"
  | "search_unavailable"
  | "download_rejected"
  | "upload_failed"
  | "confirm_failed";

export type NameplateManual = ConfirmedManual;

export type NameplateState =
  | { name: "selecting_photo" }
  | { name: "uploading" }
  | { name: "recognizing" }
  | {
      name: "confirm_identity";
      fileId: string;
      identity: ComponentIdentity;
      confidence: number | null;
    }
  | { name: "searching"; fileId: string; identity: ComponentIdentity }
  | { name: "downloading"; fileId: string; identity: ComponentIdentity }
  | { name: "indexing"; fileId: string; identity: ComponentIdentity }
  | {
      name: "candidate_review";
      fileId: string;
      identity: ComponentIdentity;
      /** Retained bytes, if the server got that far (null on an early review). */
      manual: NameplateManual | null;
      /** Why it is only a candidate — the judge's evidence line, if any. */
      reason?: string | null;
      oemRequestUrl?: string | null;
      /** The search hit itself — always present on a review. */
      candidate: ManualCandidateView | null;
      message: string | null;
    }
  | {
      name: "complete";
      fileId: string;
      identity: ComponentIdentity;
      /** Proof: an INDEXED doc with a trusted match state. Never synthesized. */
      manual: NameplateManual;
    }
  | {
      name: "error";
      reason: NameplateErrorReason;
      /** Retained context so the user can correct and retry, not start over. */
      fileId: string | null;
      identity: ComponentIdentity | null;
      /** Official next step when no manual could be found: the OEM's own
       *  manual-request page, validated by the server. */
      oemRequestUrl?: string | null;
    };

export type NameplateEvent =
  | { type: "photo_selected" }
  | { type: "upload_finished" }
  | {
      type: "recognized";
      fileId: string;
      identity: Partial<ComponentIdentity>;
      confidence?: number | null;
    }
  | { type: "recognize_failed"; reason?: NameplateErrorReason }
  | { type: "identity_edited"; identity: ComponentIdentity }
  | { type: "confirm_submitted" }
  | { type: "stage"; stage: "downloading" | "indexing" }
  | { type: "confirm_result"; result: ConfirmComponentResult }
  | { type: "confirm_failed"; reason?: NameplateErrorReason }
  | { type: "candidate_accepted" }
  | { type: "candidate_rejected" }
  | { type: "edit_again" }
  | { type: "reset" };

export const INITIAL_NAMEPLATE_STATE: NameplateState = { name: "selecting_photo" };

/** Merge a partial server reading onto the full editable identity shape. */
export function identityFrom(partial: Partial<ComponentIdentity> | undefined): ComponentIdentity {
  return { ...EMPTY_COMPONENT_IDENTITY, ...(partial ?? {}) };
}

/** Server confirm statuses that are NOT success, mapped to a reason. */
const STATUS_TO_ERROR: Partial<Record<ConfirmComponentStatus, NameplateErrorReason>> = {
  no_manual_found: "no_manual_found",
  search_unavailable: "search_unavailable",
  no_extractable_text: "no_extractable_text",
  manufacturer_model_required: "manufacturer_model_required",
  download_rejected: "download_rejected",
};

function contextOf(s: NameplateState): { fileId: string | null; identity: ComponentIdentity | null } {
  const fileId = "fileId" in s ? s.fileId : null;
  const identity = "identity" in s ? s.identity : null;
  return { fileId, identity };
}

export function nameplateReducer(state: NameplateState, event: NameplateEvent): NameplateState {
  // `reset` is the only universal transition — everything else must be legal
  // for the CURRENT state, so a late/duplicate event cannot jump the flow.
  if (event.type === "reset") return INITIAL_NAMEPLATE_STATE;

  switch (state.name) {
    case "selecting_photo":
      if (event.type === "photo_selected") return { name: "uploading" };
      return state;

    case "uploading":
      if (event.type === "upload_finished") return { name: "recognizing" };
      if (event.type === "recognize_failed")
        return {
          name: "error",
          reason: event.reason ?? "upload_failed",
          fileId: null,
          identity: null,
        };
      return state;

    case "recognizing":
      if (event.type === "recognized")
        return {
          name: "confirm_identity",
          fileId: event.fileId,
          identity: identityFrom(event.identity),
          confidence: event.confidence ?? null,
        };
      if (event.type === "recognize_failed")
        return {
          name: "error",
          reason: event.reason ?? "unreadable_nameplate",
          fileId: null,
          identity: null,
        };
      return state;

    case "confirm_identity":
      if (event.type === "identity_edited") return { ...state, identity: event.identity };
      if (event.type === "confirm_submitted")
        return { name: "searching", fileId: state.fileId, identity: state.identity };
      return state;

    case "searching":
    case "downloading":
    case "indexing": {
      if (event.type === "stage")
        return { name: event.stage, fileId: state.fileId, identity: state.identity };
      if (event.type === "confirm_failed")
        return {
          name: "error",
          reason: event.reason ?? "confirm_failed",
          fileId: state.fileId,
          identity: state.identity,
        };
      if (event.type === "confirm_result") {
        const r = event.result;
        if (r.status === "candidate_review")
          return {
            name: "candidate_review",
            fileId: state.fileId,
            identity: state.identity,
            manual: r.manual,
            candidate: r.candidate,
            reason: r.discoveryReason ?? null,
            oemRequestUrl: r.oemRequestUrl ?? null,
            message: r.message,
          };
        if (r.status === "complete") {
          // Honesty gate: "complete" is a CLAIM ("Manual added—ask a question").
          // We only make it when the server's own payload proves an indexed,
          // trusted source row exists. A retained file is not a source.
          if (!confirmYieldedCitableSource(r) || !r.manual)
            return {
              name: "error",
              reason: "confirm_failed",
              fileId: state.fileId,
              identity: state.identity,
            };
          return {
            name: "complete",
            fileId: state.fileId,
            identity: state.identity,
            manual: r.manual,
          };
        }
        return {
          name: "error",
          reason: STATUS_TO_ERROR[r.status] ?? "confirm_failed",
          fileId: state.fileId,
          identity: state.identity,
          oemRequestUrl: r.oemRequestUrl ?? null,
        };
      }
      return state;
    }

    case "candidate_review":
      if (event.type === "candidate_accepted")
        return { name: "indexing", fileId: state.fileId, identity: state.identity };
      if (event.type === "candidate_rejected")
        return {
          name: "confirm_identity",
          fileId: state.fileId,
          identity: state.identity,
          confidence: null,
        };
      return state;

    case "error": {
      // An error can be corrected — but it can NEVER become `complete` without
      // going back through the server round-trip.
      if (event.type === "edit_again") {
        const { fileId, identity } = contextOf(state);
        if (!fileId) return INITIAL_NAMEPLATE_STATE;
        return {
          name: "confirm_identity",
          fileId,
          identity: identity ?? identityFrom(undefined),
          confidence: null,
        };
      }
      return state;
    }

    case "complete":
      return state; // terminal success; only `reset` leaves it
  }
}

/** In-flight progress copy. Empty string where the screen renders its own UI
 *  (the editable form, the candidate card, the terminal error). */
export function nameplateStatusCopy(state: NameplateState): string {
  switch (state.name) {
    case "selecting_photo":
      return "";
    case "uploading":
      return "Reading nameplate…";
    case "recognizing":
      return "Reading nameplate…";
    case "confirm_identity":
      return "Confirm this component";
    case "searching":
      return "Looking for the official manual…";
    case "downloading":
      return "Downloading and validating…";
    case "indexing":
      return "Adding it to this notebook…";
    case "candidate_review":
      return "Found a possible manual—confirm before using";
    case "complete":
      return "Manual added—ask a question";
    case "error":
      return nameplateErrorCopy(state.reason);
  }
}

/** One honest sentence per failure. No blame, no invented cause. */
export function nameplateErrorCopy(reason: NameplateErrorReason): string {
  switch (reason) {
    case "unreadable_nameplate":
      return "Couldn't read the nameplate";
    case "manufacturer_model_required":
      return "Manufacturer/model required";
    case "no_manual_found":
      return "No official manual found";
    case "no_extractable_text":
      return "PDF retained but has no extractable text";
    case "search_unavailable":
      return "Search service unavailable";
    case "download_rejected":
      return "File retained even though later processing failed";
    case "upload_failed":
      return "Couldn't read the nameplate";
    case "confirm_failed":
      return "File retained even though later processing failed";
  }
}

/** The editable confirm form, in nameplate reading order. */
export const NAMEPLATE_FIELDS: { key: keyof ComponentIdentity; label: string }[] = [
  { key: "manufacturer", label: "Manufacturer" },
  { key: "model", label: "Model" },
  { key: "catalogNumber", label: "Catalog/part number" },
  { key: "serialNumber", label: "Serial number" },
  { key: "equipmentType", label: "Equipment type" },
  { key: "voltage", label: "Voltage" },
  { key: "fullLoadAmps", label: "Full-load amps" },
  { key: "horsepower", label: "Horsepower" },
  { key: "frequency", label: "Frequency" },
  { key: "rpm", label: "RPM" },
];

export const NAMEPLATE_FORM_HINT = "Read from the nameplate—edit anything that's wrong.";

/** Mirrors the server's own precondition EXACTLY: a manufacturer, plus either
 *  a model or a catalog/part number. Gating on model alone would block a
 *  submission the server would have accepted (plenty of nameplates carry only
 *  a catalog number). */
export function canSubmitIdentity(identity: ComponentIdentity): boolean {
  return Boolean(
    identity.manufacturer.trim() &&
      (identity.model.trim() || identity.catalogNumber.trim()),
  );
}

/**
 * What the primary button on `candidate_review` should DO.
 *
 * Reported from the field on a Pixel: the screen offered "Use this manual" as a
 * solid primary button while it was permanently disabled, because the server had
 * found a LINK it declined to auto-import — there was no file to promote, and no
 * amount of tapping could produce one. The technician read a working button and
 * concluded the app had hung, which is the only fair reading of that screen.
 *
 * The two situations are genuinely different and must not share a control:
 *
 *   "accept" — the server auto-imported the PDF (validated + direct PDF + OEM
 *              host). A file exists; the button promotes it to user_confirmed.
 *   "upload" — the server surfaced a candidate URL for review WITHOUT importing
 *              it. Nothing exists to promote. The honest action is: open the
 *              link, check it, then add the downloaded PDF as a source.
 */
export function candidateAction(manual: NameplateManual | null | undefined): "accept" | "upload" {
  return manual?.fileId ? "accept" : "upload";
}
