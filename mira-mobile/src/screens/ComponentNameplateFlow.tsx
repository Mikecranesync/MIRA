// "Photograph a component nameplate" — the notebook-scoped flow, driven end to
// end by the pure reducer in lib/nameplate-flow.ts.
//
// HARD RULE: the thing in the photo is a COMPONENT INSIDE the machine this
// notebook describes (a contactor in the panel, the drive on the wall). This
// component NEVER writes back to the notebook's own identity — there is no
// createNotebook / identity-patch call anywhere in this file, on purpose.
//
// HONESTY RULE: `complete` ("Manual added—ask a question") is rendered only
// when the server has confirmed BOTH that the relationship exists and that the
// notebook actually lists the new source. Every other outcome states plainly
// what happened, including the ones where the file was kept but the pipeline
// couldn't use it.
import { useEffect, useReducer, useRef, useState } from "react";
import {
  attachFileToTargets,
  canBeChatSource,
  confirmComponentNameplate,
  getNotebookDetail,
  recognizeComponentNameplate,
  type ComponentIdentity,
} from "../api/resources";
import {
  INITIAL_NAMEPLATE_STATE,
  NAMEPLATE_FIELDS,
  NAMEPLATE_FORM_HINT,
  canSubmitIdentity,
  candidateAction,
  nameplateReducer,
  nameplateStatusCopy,
  type NameplateManual,
} from "../lib/nameplate-flow";
import { ErrorState } from "./common";

export function ComponentNameplateFlow({
  notebookId,
  photo,
  onDone,
  onCancel,
  onUploadInstead,
}: {
  notebookId: string;
  photo: File;
  /** Called when the notebook's sources actually changed. */
  onDone: () => void;
  onCancel: () => void;
  /** Leave this flow and open the PDF picker — the honest next step when MIRA
   *  found a link it could not import, and the technician has downloaded the
   *  document themselves. */
  onUploadInstead: () => void;
}) {
  const [state, dispatch] = useReducer(nameplateReducer, INITIAL_NAMEPLATE_STATE);
  const [transportError, setTransportError] = useState<unknown>(null);
  // ONE key for this photo's confirm — a retry replays, never duplicates.
  const [confirmKey] = useState(() => crypto.randomUUID());
  // Opaque provider lineage from recognize, echoed back to confirm untouched.
  const [rawObservation, setRawObservation] = useState<unknown>(null);
  const started = useRef(false);

  // Photo → file + candidate reading. The server retains the photo as a
  // workspace file and links it to the notebook; we never fake either.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    dispatch({ type: "photo_selected" });
    dispatch({ type: "upload_finished" });
    void recognizeComponentNameplate(notebookId, photo)
      .then((r) => {
        // The photo is retained and linked to the notebook by the server before
        // recognition is even attempted — reflect that immediately.
        onDone();
        if (!r.fileId) return dispatch({ type: "recognize_failed" });
        setRawObservation(r.rawObservation);
        dispatch({
          type: "recognized",
          fileId: r.fileId,
          identity: r.candidate,
          confidence: r.confidence,
        });
      })
      .catch((e) => {
        // Even the honest failures (503 recognizer_not_configured, 502) keep
        // the photo AND its notebook link — so still refresh the source list.
        onDone();
        setTransportError(e);
        dispatch({ type: "recognize_failed" });
      });
  }, [notebookId, photo]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitIdentity = async (fileId: string, identity: ComponentIdentity) => {
    dispatch({ type: "confirm_submitted" });
    setTransportError(null);
    try {
      const result = await confirmComponentNameplate(
        notebookId,
        { fileId, identity, rawObservation, discover: true },
        confirmKey,
      );
      dispatch({ type: "confirm_result", result });
      // The notebook's sources changed on ANY outcome that retained a file.
      if (result.manual?.fileId) onDone();
    } catch (e) {
      setTransportError(e);
      dispatch({ type: "confirm_failed" });
    }
  };

  // Accept the proposed manual. The server already attached it as a CANDIDATE;
  // accepting promotes that link to user_confirmed. We then re-read the
  // notebook and only claim success if it really lists the source as citable —
  // the file existing is not the same as the notebook being able to cite it.
  const acceptCandidate = async (manual: NameplateManual, identity: ComponentIdentity) => {
    if (!manual.fileId) return;
    dispatch({ type: "candidate_accepted" });
    setTransportError(null);
    try {
      await attachFileToTargets(
        manual.fileId,
        [
          {
            targetType: "equipment_notebook",
            targetId: notebookId,
            role: "manual",
            matchState: "user_confirmed",
          },
        ],
        confirmKey,
      );
      onDone();
      const detail = await getNotebookDetail(notebookId);
      const source = detail.sources.find(
        (s) => s.fileId === manual.fileId && canBeChatSource(s),
      );
      if (!source) {
        // Kept, but not citable (e.g. a scanned PDF with no text). Say so.
        dispatch({ type: "confirm_failed", reason: "no_extractable_text" });
        return;
      }
      dispatch({
        type: "confirm_result",
        result: {
          status: "complete",
          manual: {
            ...manual,
            docId: source.docId,
            filename: source.filename,
            matchState: source.matchState,
            indexed: true,
          },
          candidate: null,
          applicability: null,
          message: null,
          warning: null,
        },
      });
    } catch (e) {
      setTransportError(e);
      dispatch({ type: "confirm_failed" });
    }
  };

  const headline = nameplateStatusCopy(state);

  return (
    <>
      <h3>Component nameplate</h3>

      {(state.name === "uploading" ||
        state.name === "recognizing" ||
        state.name === "searching" ||
        state.name === "downloading" ||
        state.name === "indexing") && (
        <div className="empty" style={{ marginTop: 24 }}>
          {headline}
        </div>
      )}

      {state.name === "confirm_identity" && (
        <>
          <div className="meta" style={{ marginBottom: 4, fontWeight: 600 }}>
            {headline}
          </div>
          <div className="meta" style={{ marginBottom: 8 }}>
            {NAMEPLATE_FORM_HINT}
          </div>
          {NAMEPLATE_FIELDS.map((f) => (
            <div key={f.key}>
              <label>{f.label}</label>
              <input
                value={state.identity[f.key]}
                onChange={(e) =>
                  dispatch({
                    type: "identity_edited",
                    identity: { ...state.identity, [f.key]: e.target.value },
                  })
                }
              />
            </div>
          ))}
          <button
            className="btn-primary"
            style={{ marginTop: 14 }}
            disabled={!canSubmitIdentity(state.identity)}
            onClick={() => void submitIdentity(state.fileId, state.identity)}
          >
            Find the manual for this component
          </button>
          {!canSubmitIdentity(state.identity) && (
            <div className="meta" style={{ marginTop: 6 }}>
              To continue: a manufacturer, plus a model or catalog number.
            </div>
          )}
          <button style={{ marginTop: 8 }} onClick={onCancel}>
            Cancel
          </button>
        </>
      )}

      {state.name === "candidate_review" && (
        <>
          <div className="warnbox">{headline}</div>
          <div className="title">
            {state.manual?.filename ?? state.candidate?.title ?? "Untitled document"}
          </div>
          <div className="meta" style={{ marginBottom: 8 }}>
            {state.candidate?.host ? `${state.candidate.host} · ` : ""}
            {state.candidate?.oemHost ? "manufacturer site" : "not a manufacturer site"}
          </div>
          {/* The whole point of this screen is "confirm before using", and a
           *  technician cannot confirm a document they cannot open. The URL used
           *  to be plain text — unreadable and untappable — so the only way to
           *  check it was to retype a 100-character Siemens link by hand.
           *
           *  Opens in the system browser, not the WebView: capacitor.config.ts
           *  sets no allowNavigation, so an off-origin link leaves the app and
           *  the flow is still here on return. This is a PUBLIC OEM url, so
           *  none of the authenticated-open concerns in api/client.ts
           *  (requestBinary) apply — no session cookie is involved. */}
          {state.candidate?.url && (
            <a
              className="candidate-link"
              href={state.candidate.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open this document to check it ↗
              <span className="candidate-link-url">{state.candidate.url}</span>
            </a>
          )}
          {state.message && (
            <div className="meta" style={{ marginBottom: 8 }}>
              {state.message}
            </div>
          )}
          {/* Two different situations wore the same button and the same label,
           *  which is what made this screen a dead end in the field.
           *
           *  When MIRA auto-imported the document there IS a file, and this
           *  promotes it to user_confirmed. When MIRA only found a LINK it could
           *  not auto-import (not validated / not a direct PDF / not an OEM
           *  host), there is nothing on the server to promote — the old button
           *  was permanently disabled, but rendered as a solid primary action,
           *  so the honest next step was invisible underneath it. */}
          {candidateAction(state.manual) === "accept" ? (
            <button
              className="btn-primary"
              onClick={() => state.manual && void acceptCandidate(state.manual, state.identity)}
            >
              Use this manual
            </button>
          ) : (
            <>
              <button className="btn-primary" onClick={onUploadInstead}>
                I checked it — add it as a source
              </button>
              <div className="meta" style={{ marginTop: 6 }}>
                MIRA could not confirm this is the official document, so it did
                not import it. Open the link above, download the PDF, then add it
                here and MIRA will use it.
              </div>
            </>
          )}
          <button style={{ marginTop: 8 }} onClick={() => dispatch({ type: "candidate_rejected" })}>
            Not this one — edit the details
          </button>
        </>
      )}

      {state.name === "complete" && (
        <>
          <div className="empty" style={{ marginTop: 20 }}>
            {headline}
          </div>
          <div className="meta" style={{ textAlign: "center" }}>
            {state.manual.filename ?? "The manual"} is now a searchable source
            in this notebook.
          </div>
          <button className="btn-primary" style={{ marginTop: 14 }} onClick={onCancel}>
            Done
          </button>
        </>
      )}

      {state.name === "error" && (
        <>
          <div className="warnbox">{headline}</div>
          <div className="meta" style={{ marginBottom: 8 }}>
            The photo is saved in your workspace either way.
          </div>
          {transportError != null && <ErrorState error={transportError} />}
          {state.fileId && (
            <button onClick={() => dispatch({ type: "edit_again" })}>
              Edit the details and try again
            </button>
          )}
          <button style={{ marginTop: 8 }} onClick={onCancel}>
            Close
          </button>
        </>
      )}
    </>
  );
}
