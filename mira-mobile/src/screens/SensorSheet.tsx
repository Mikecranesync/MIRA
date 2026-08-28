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
import { useRef, useState } from "react";
import { Sheet } from "./Sheet";
import { SourceThumb } from "./FilePreview";
import { canPickNatively, pickPhoto } from "../lib/native-pick";
import { lookAtPhoto, type LookResult } from "../api/resources";
import {
  SENSOR_MODES,
  hhmmss,
  lookErrorCopy,
  lookQuestion,
  LOOK_DEFAULT_QUESTION,
  type SensorMode,
} from "../lib/sensor";

export function SensorSheet({
  notebookId,
  onClose,
  onChanged,
  onAsk,
}: {
  notebookId: string;
  onClose: () => void;
  /** The notebook's sources changed (a photo was parked and linked). */
  onChanged: () => void;
  /** Send a question through the notebook's ONE conversation. The caller
   *  closes the sheet and switches to the chat panel. */
  onAsk: (question: string) => void;
}) {
  const [mode, setMode] = useState<SensorMode | null>(null);
  const current = SENSOR_MODES.find((m) => m.id === mode) ?? null;

  return (
    <Sheet label="Sensor" onClose={onClose}>
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
          <h3>{current.label}</h3>
          <div className="meta" style={{ marginBottom: 10 }}>
            {current.description}
          </div>
          {current.id === "look" && (
            <LookPanel notebookId={notebookId} onChanged={onChanged} onAsk={onAsk} />
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
  | { name: "card"; photo: File; result: LookResult }
  | { name: "error"; photo: File; error: unknown };

function LookPanel({
  notebookId,
  onChanged,
  onAsk,
}: {
  notebookId: string;
  onChanged: () => void;
  onAsk: (question: string) => void;
}) {
  const [state, setState] = useState<LookState>({ name: "idle" });
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
      setState({ name: "card", photo, result });
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
                Visual observation · Photo captured ·{" "}
                {hhmmss(state.result.observation?.capturedAt ?? new Date())}
              </div>
              <div className="meta">Phone photo — saved to this notebook&apos;s sources.</div>
            </div>
          </div>
          {state.result.observation ? (
            <div className="msg-answer" style={{ marginTop: 8 }}>
              {state.result.observation.text}
            </div>
          ) : (
            <div className="meta" style={{ marginTop: 8 }}>
              The photo is saved, but no description came back. You can still
              ask MIRA about it.
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
            onClick={() =>
              onAsk(
                lookQuestion(
                  state.result.observation?.text ?? "(no description available)",
                  state.result.observation?.capturedAt ?? new Date(),
                  question,
                ),
              )
            }
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
            notebook&apos;s sources.
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
