// FactoryLM Sensor — the LOOK / READ / REPLAY instrument, hosted in the ONE
// approved bottom-sheet chrome (Sheet) so hardware BACK unwinds it through the
// transient-layer stack exactly like every other sheet: viewer → Sensor sheet
// → notebook → tab. No new chrome, no fourth notebook panel, no sixth tab
// (contract §2.1–2.2).
//
// Works with zero sources and no bound asset (§2.6): every mode renders and
// every visible action does something today. Modes that need a machine say so
// in one sentence and offer READ; nothing is disabled or "coming soon".
//
// One conversation (§2.3): every "Ask MIRA" here closes the sheet and sends
// through the notebook's existing `sendQuestion` — no Sensor chat store.
import { useEffect, useRef, useState } from "react";
import { BackDismiss, Sheet } from "./Sheet";
import { SourceThumb } from "./FilePreview";
import { ScanView, type ScanVia } from "./ScanView";
import { ComponentNameplateFlow } from "./ComponentNameplateFlow";
import { canPickNatively, pickPhoto } from "../lib/native-pick";
import {
  bindNotebookAsset,
  getAssetByTag,
  getAssetHistory,
  lookAtPhoto,
  openAssetNotebook,
  type LookResult,
  type Notebook,
} from "../api/resources";
import { ReplayTimeline } from "./ReplayTimeline";
import {
  REPLAY_DEFAULT_WINDOW,
  replayQuestion,
  type HistoryResult,
  type MachineEvidenceWindow,
  type ReplayWindow,
} from "../lib/replay";
import { ErrorState } from "./common";
import { extractAssetTag } from "../lib/tags";
import { readScan, type ReadOutcome } from "../lib/sensor-read";
import { assetCardState, resolvedAssetFromNotebook } from "../lib/notebook-asset-card";
import {
  SENSOR_MODES,
  REPLAY_NO_MACHINE,
  hhmmss,
  lookErrorCopy,
  lookQuestion,
  visualCardTitle,
  lastObservationTitle,
  LOOK_DEFAULT_QUESTION,
  LOOK_SAVED_COPY,
  type SensorMode,
  type VisualEvidence,
} from "../lib/sensor";

/** What a Sensor "Ask MIRA" hands the ONE conversation alongside the
 *  question: the REPLAY window (§4.4) and/or the LOOK photo (S5 D3). The
 *  server verifies and re-derives both; the client sends identifiers only. */
export interface SensorAskEvidence {
  machineEvidence?: MachineEvidenceWindow;
  visualEvidence?: VisualEvidence;
}

/** The last LOOK of THIS SESSION, held by the notebook screen so closing the
 *  sheet without asking doesn't throw the observation away.
 *
 *  Known v0 limit (documented, not hidden): the observation TEXT is memory
 *  only — it is conversation context, not a stored row, so it does not survive
 *  leaving the notebook or restarting the app. The PHOTO is persisted (parked
 *  + linked, role "photo") and stays in the notebook's files either way.
 *  Persisting the text needs a store, and a Sensor store is forbidden in v0
 *  (contract §2.3/§2.4). */
export interface RememberedLook {
  result: LookResult;
  /** Resolved once, when the look happened — so a restored card shows the
   *  capture time, not the time it was re-rendered. */
  capturedAt: string;
}

export function SensorSheet({
  notebook,
  onClose,
  onChanged,
  onAsk,
  onOpenNotebook,
  onUploadInstead,
  lastLook,
  onLook,
}: {
  notebook: Pick<Notebook, "id" | "displayName" | "asset">;
  onClose: () => void;
  /** The notebook changed (a photo was parked and linked; a machine was
   *  bound) — the caller re-reads it. */
  onChanged: () => void;
  /** Send a question through the notebook's ONE conversation. The caller
   *  closes the sheet and switches to the chat panel. REPLAY passes the
   *  selected Machine Memory window (contract §4.4); LOOK passes the parked
   *  photo (S5 D3). */
  onAsk: (question: string, evidence?: SensorAskEvidence) => void;
  /** A scan resolved to a DIFFERENT machine's notebook — go there (the
   *  existing scan → notebook transition). */
  onOpenNotebook: (notebookId: string) => void;
  /** The nameplate flow found a manual it could not import; the technician
   *  will add the PDF themselves via the Add-sources sheet. */
  onUploadInstead: () => void;
  /** This session's last LOOK, if any — reopening LOOK shows it again. */
  lastLook?: RememberedLook | null;
  /** A new LOOK landed; the caller remembers it for the session. */
  onLook?: (look: RememberedLook) => void;
}) {
  const notebookId = notebook.id;
  const [mode, setMode] = useState<SensorMode | null>(null);
  const current = SENSOR_MODES.find((m) => m.id === mode) ?? null;

  return (
    <Sheet label="Sensor" onClose={onClose}>
      <AssetIdentityChip notebook={notebook} />
      {current === null && (
        <>
          <h3>Sensor</h3>
          <div className="meta" style={{ marginBottom: 10 }}>
            Use the phone as an instrument on this machine. Everything you
            observe lands in this notebook&apos;s conversation.
          </div>
          {SENSOR_MODES.map((m) => (
            <button
              key={m.id}
              className="sheet-option sensor-mode"
              aria-label={m.label}
              onClick={() => setMode(m.id)}
            >
              <span className="sensor-mode-label">{m.label}</span>
              <span className="meta">{m.description}</span>
            </button>
          ))}
          <button style={{ marginTop: 6 }} onClick={onClose}>
            Done
          </button>
        </>
      )}
      {current !== null && (
        <>
          {/* Hardware BACK inside a mode returns to the mode picker — it does
              NOT close the whole sheet and throw away the LOOK card the
              technician is looking at. Registered as a transient layer (the
              same primitive the delete-confirm dialog and the READ viewfinder
              use), so the LIFO stack unwinds one layer per press:
              viewfinder → mode → Sensor sheet → notebook → tab. No custom
              back stack, no per-screen enumeration. */}
          <BackDismiss onDismiss={() => setMode(null)} />
          <h3>{current.label}</h3>
          <div className="meta" style={{ marginBottom: 10 }}>
            {current.description}
          </div>
          {current.id === "look" && (
            <LookPanel
              notebookId={notebookId}
              onChanged={onChanged}
              onAsk={onAsk}
              lastLook={lastLook ?? null}
              onLook={onLook}
            />
          )}
          {current.id === "read" && (
            <ReadPanel
              notebook={notebook}
              onChanged={onChanged}
              onOpenNotebook={onOpenNotebook}
              onUploadInstead={onUploadInstead}
            />
          )}
          {current.id === "replay" && (
            <ReplayPanel notebook={notebook} onAsk={onAsk} onIdentify={() => setMode("read")} />
          )}
          <button style={{ marginTop: 6 }} onClick={() => setMode(null)}>
            ← Modes
          </button>
        </>
      )}
    </Sheet>
  );
}

// --- LOOK -------------------------------------------------------------------
//
// Photograph → POST look (the server parks the file BEFORE vision, and links
// it to this notebook as role "photo") → evidence card → "Ask MIRA about this".
// The observation is conversation context: it rides as the question prefix on
// the existing chat route (§4.1). Nothing here writes a source or a citation.

type LookState =
  | { name: "idle" }
  | { name: "looking"; photo: File }
  /** `photo` is null for a card restored from the session (there is no File to
   *  retry with — the bytes are already parked on the server). `restored`
   *  only changes the title, never the actions. */
  | { name: "card"; photo: File | null; result: LookResult; capturedAt: string; restored: boolean }
  | { name: "error"; photo: File; error: unknown };

function LookPanel({
  notebookId,
  onChanged,
  onAsk,
  lastLook,
  onLook,
}: {
  notebookId: string;
  onChanged: () => void;
  onAsk: (question: string, evidence?: SensorAskEvidence) => void;
  lastLook: RememberedLook | null;
  onLook?: (look: RememberedLook) => void;
}) {
  // Reopening LOOK shows this session's last observation instead of an empty
  // picker — closing the sheet to read a manual no longer costs the card.
  const [state, setState] = useState<LookState>(
    lastLook
      ? { name: "card", photo: null, result: lastLook.result, capturedAt: lastLook.capturedAt, restored: true }
      : { name: "idle" },
  );
  const [question, setQuestion] = useState("");
  // Web build only — on device the phone's own picker is used (#3353).
  const cameraRef = useRef<HTMLInputElement | null>(null);

  const look = async (photo: File) => {
    // ONE key per photograph: a retry replays the same park+link, never a
    // second file or a second link (§2.4 one evidence model).
    const clientKey = crypto.randomUUID();
    setState({ name: "looking", photo });
    try {
      const result = await lookAtPhoto(notebookId, photo, clientKey);
      // The photo is a linked source now (role "photo") whatever vision said.
      onChanged();
      const capturedAt = result.observation?.capturedAt ?? new Date().toISOString();
      setState({ name: "card", photo, result, capturedAt, restored: false });
      onLook?.({ result, capturedAt });
    } catch (e) {
      // The server parks the photo before vision, so on a provider failure it
      // may already be a linked source — refresh so the Sources list is truthful.
      onChanged();
      setState({ name: "error", photo, error: e });
    }
  };

  const openPicker = async () => {
    if (!canPickNatively()) return cameraRef.current?.click();
    const f = await pickPhoto("look.jpg");
    if (f) await look(f);
  };

  return (
    <>
      {state.name === "idle" && (
        <button className="btn-primary" onClick={() => void openPicker()}>
          📷 Photograph or pick an image
        </button>
      )}
      {state.name === "looking" && (
        <div className="empty" style={{ marginTop: 12 }}>
          Saving the photo and describing what&apos;s visible…
        </div>
      )}
      {state.name === "card" && (
        <div className="card sensor-evidence" data-testid="look-card">
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            {state.result.fileId && <SourceThumb fileId={state.result.fileId} />}
            <div className="grow">
              <div className="title">
                {state.restored
                  ? lastObservationTitle(state.capturedAt)
                  : visualCardTitle(state.capturedAt)}
              </div>
              <div className="meta">{LOOK_SAVED_COPY}</div>
            </div>
          </div>
          {state.result.observation ? (
            <div className="msg-answer" style={{ marginTop: 8 }}>
              {state.result.observation.text}
            </div>
          ) : (
            <div className="meta" style={{ marginTop: 8 }} data-testid="look-no-observation">
              {state.result.message ?? "The photo is saved, but no description came back."}{" "}
              You can still ask MIRA about it.
            </div>
          )}
          <label style={{ marginTop: 10 }}>Your question (optional)</label>
          <textarea
            rows={2}
            aria-label="Question about this photo"
            placeholder={LOOK_DEFAULT_QUESTION}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button
            className="btn-primary"
            style={{ marginTop: 10 }}
            onClick={() => {
              const { capturedAt } = state;
              onAsk(
                lookQuestion(
                  state.result.observation?.text ?? "(no description available)",
                  capturedAt,
                  question,
                ),
                // S5 D3: the parked photo rides as {fileId, capturedAt} so the
                // server can verify the link and persist the visual entry.
                state.result.fileId
                  ? { visualEvidence: { fileId: state.result.fileId, capturedAt } }
                  : undefined,
              );
            }}
          >
            Ask MIRA about this
          </button>
          <button style={{ marginTop: 8 }} onClick={() => setState({ name: "idle" })}>
            Another photo
          </button>
        </div>
      )}
      {state.name === "error" && (
        <>
          <div className="warnbox" role="alert">
            {lookErrorCopy(state.error)}
          </div>
          <div className="meta" style={{ marginBottom: 8 }}>
            If the upload reached the server, the photo is already saved in this
            notebook&apos;s files.
          </div>
          <button onClick={() => void look(state.photo)}>Try again</button>
          <button style={{ marginTop: 8 }} onClick={() => setState({ name: "idle" })}>
            Pick a different photo
          </button>
        </>
      )}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="LOOK photo"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          e.target.value = "";
          if (f) void look(f);
        }}
      />
    </>
  );
}

// --- identity chip -----------------------------------------------------------
//
// The three-second test (dogfood spec §7): which machine is MIRA using, and
// how sure is that? Tone comes from the ported `assetCardState`; colour is
// applied at this boundary through tokens only.

function AssetIdentityChip({
  notebook,
}: {
  notebook: Pick<Notebook, "displayName" | "asset">;
}) {
  const card = assetCardState(resolvedAssetFromNotebook(notebook), notebook.asset);
  return (
    <div className={`asset-chip asset-chip-${card.tone}`} data-testid="asset-chip" data-tone={card.tone}>
      <div className="title">{card.headline}</div>
      <div className="meta">{card.detail}</div>
    </div>
  );
}

// --- READ -------------------------------------------------------------------
//
// Converges the identification doors that already exist: the FactoryLM QR
// scanner (ScanView → extractAssetTag → readScan), and the component
// nameplate flow (ComponentNameplateFlow, invoked as-is). A resolved QR
// upgrades THIS notebook in place (L1→L2 via PUT …/asset) when it has no
// machine yet; otherwise the scanned machine's own notebook opens.

type ReadState =
  | { name: "menu"; note: string | null }
  | { name: "scan" }
  | { name: "resolving"; tag: string }
  | { name: "nameplate"; photo: File };

function ReadPanel({
  notebook,
  onChanged,
  onOpenNotebook,
  onUploadInstead,
}: {
  notebook: Pick<Notebook, "id" | "displayName" | "asset">;
  onChanged: () => void;
  onOpenNotebook: (notebookId: string) => void;
  onUploadInstead: () => void;
}) {
  const [state, setState] = useState<ReadState>({ name: "menu", note: null });
  const cameraRef = useRef<HTMLInputElement | null>(null);

  const onScanned = async (text: string, via: ScanVia) => {
    const tag = extractAssetTag(text);
    if (!tag) return setState({ name: "menu", note: `Not a FactoryLM asset code: ${text}` });
    setState({ name: "resolving", tag });
    const out: ReadOutcome = await readScan(
      tag,
      { notebookId: notebook.id, boundEntityId: notebook.asset?.entityId ?? null },
      { getAssetByTag, openAssetNotebook, bindNotebookAsset },
      via,
    );
    switch (out.kind) {
      case "bound": {
        onChanged();
        // Confirmation is the SERVER's verdict, read off the returned binding:
        // a scan comes back unconfirmed; a signed-in typed tag comes back
        // confirmed by that user. The note never contradicts the chip.
        const from = via === "qr" ? "the QR sticker" : "the typed tag";
        const confirmed = out.notebook.asset?.confirmedAt != null;
        return setState({
          name: "menu",
          note: confirmed
            ? `${out.asset.name || tag} is now this notebook's machine — confirmed, selected from ${from}.`
            : `${out.asset.name || tag} is now this notebook's machine — selected from ${from}, not yet confirmed.`,
        });
      }
      case "same_machine":
        return setState({ name: "menu", note: `That's this notebook's machine (${out.asset.name || tag}).` });
      case "notebook":
        return onOpenNotebook(out.notebookId);
      case "notfound":
        return setState({ name: "menu", note: `No asset with tag “${tag}” in this workspace.` });
      case "asset_only":
      case "failed":
        return setState({ name: "menu", note: out.message });
    }
  };

  const openNameplatePicker = async () => {
    if (!canPickNatively()) return cameraRef.current?.click();
    const f = await pickPhoto("nameplate.jpg");
    if (f) setState({ name: "nameplate", photo: f });
  };

  if (state.name === "nameplate")
    return (
      <ComponentNameplateFlow
        notebookId={notebook.id}
        photo={state.photo}
        onDone={onChanged}
        onCancel={() => setState({ name: "menu", note: null })}
        onUploadInstead={onUploadInstead}
      />
    );

  return (
    <>
      {state.name === "scan" && (
        // Fullscreen, above the sheet; its own BACK layer so BACK closes the
        // viewfinder first, then the Sensor sheet, then the notebook.
        <div className="sensor-overlay" role="dialog" aria-label="Scan FactoryLM QR">
          <BackDismiss onDismiss={() => setState({ name: "menu", note: null })} />
          <ScanView
            cancelLabel="← Sensor"
            onCancel={() => setState({ name: "menu", note: null })}
            onResult={(text, via) => void onScanned(text, via)}
          />
        </div>
      )}
      {state.name === "resolving" && (
        <div className="empty" style={{ marginTop: 12 }}>
          Resolving {state.tag}…
        </div>
      )}
      {(state.name === "menu" || state.name === "scan") && (
        <>
          <button className="sheet-option" onClick={() => setState({ name: "scan" })}>
            🔳 Scan FactoryLM QR
          </button>
          <button className="sheet-option" onClick={() => void openNameplatePicker()}>
            📷 Photograph a nameplate
          </button>
          {state.name === "menu" && state.note && (
            <div className="meta" role="status">
              {state.note}
            </div>
          )}
        </>
      )}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="Nameplate photo"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          e.target.value = "";
          if (f) setState({ name: "nameplate", photo: f });
        }}
      />
    </>
  );
}

// --- REPLAY -----------------------------------------------------------------
//
// Machine Memory owns replay (§2.5). This panel asks the Hub for the
// fault-anchored window of what was actually recorded and renders it; then
// "Ask MIRA what happened" hands that exact window to the notebook's ONE
// conversation as body.machineEvidence (§4.4). Needs a bound machine — and
// when there is none it says so and offers READ. That sentence is an
// explanation, not a gate: LOOK and READ keep working regardless (§2.6).

type ReplayState =
  | { name: "loading" }
  | { name: "ready"; result: HistoryResult }
  | { name: "error"; error: unknown };

function ReplayPanel({
  notebook,
  onAsk,
  onIdentify,
}: {
  notebook: Pick<Notebook, "asset">;
  onAsk: (question: string, evidence?: SensorAskEvidence) => void;
  onIdentify: () => void;
}) {
  const assetId = notebook.asset?.entityId ?? null;
  const [state, setState] = useState<ReplayState>({ name: "loading" });
  // S5 D2: the phone always names its window (the server default of 5 s / 2 s
  // cannot reach a cause seconds before the fault); the header control
  // re-fetches with a different one.
  const [window, setWindow] = useState<ReplayWindow>({ ...REPLAY_DEFAULT_WINDOW });

  useEffect(() => {
    if (!assetId) return;
    let cancelled = false;
    setState({ name: "loading" });
    getAssetHistory(assetId, { pre: window.pre, post: window.post })
      .then((result) => !cancelled && setState({ name: "ready", result }))
      .catch((error) => !cancelled && setState({ name: "error", error }));
    return () => {
      cancelled = true;
    };
  }, [assetId, window.pre, window.post]);

  if (!assetId)
    return (
      <>
        <div className="meta" role="status" style={{ marginBottom: 8 }}>
          {REPLAY_NO_MACHINE}
        </div>
        <button className="sheet-option" onClick={onIdentify}>
          Identify the machine with READ
        </button>
      </>
    );

  if (state.name === "loading") return <div className="empty">Reading Machine Memory…</div>;
  if (state.name === "error") return <ErrorState error={state.error} />;

  const { result } = state;
  // Three server-stated empties, each its own sentence — none is a route
  // failure (that throws and renders ErrorState above).
  if (!result.ok && result.reason === "no_uns_path")
    return (
      <div className="meta" role="status">
        This machine has no Machine Memory yet (no UNS path), so there is nothing to replay.
      </div>
    );
  if (!result.ok)
    return (
      <div className="meta" role="status">
        {result.windowsAvailable
          ? "No fault window recorded for this machine, so there is nothing to replay."
          : "Machine state windows aren't available in this workspace yet, so there is nothing to replay."}
        {result.latest
          ? ` Latest recorded state: ${result.latest.state}${result.latest.at ? ` at ${hhmmss(result.latest.at)}` : ""}.`
          : ""}
      </div>
    );

  const { history } = result;
  // The window MIRA is asked about is the window the technician is looking
  // at: the one the rows were fetched for, as the server echoed it.
  const machineEvidence: MachineEvidenceWindow = {
    assetId,
    anchorAt: history.anchor.at,
    pre: history.pre,
    post: history.post,
  };
  return (
    <>
      <ReplayTimeline history={history} onWindowChange={setWindow} />
      <button
        className="btn-primary"
        onClick={() => onAsk(replayQuestion(history.anchor.at), { machineEvidence })}
      >
        Ask MIRA what happened
      </button>
    </>
  );
}
