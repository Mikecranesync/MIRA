import type { Attachment, PlatformAdapter, ShellAction, ShellState } from "@factorylm/interaction";
import { useState, type Dispatch, type FormEvent, type KeyboardEvent } from "react";
import { AttachmentMenu } from "./AttachmentMenu";
import { breadcrumb } from "./Conversation";
import { Overlay } from "./Overlay";
import { machineName, type HostHooks } from "./parts";
import { MicIcon } from "./icons";

import { withoutStatusCode } from "./SendError";

export interface ComposerProps {
  readonly state: ShellState;
  readonly dispatch: Dispatch<ShellAction>;
  readonly adapter: PlatformAdapter;
  readonly hooks?: HostHooks;
  /** The attachment sheet is the top-most layer (FactoryLMShell decides via topLayer). */
  readonly attachmentTrapsTab?: boolean;
}

export interface ComposerKeyEvent {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly isComposing: boolean;
  /** 229 is the IME-composition keyCode some engines report without `isComposing`. */
  readonly keyCode: number;
}

/** Enter sends; Shift+Enter inserts a newline; Enter during IME composition is left to the editor. */
export function composerKeyAction(event: ComposerKeyEvent): "send" | "newline" | "none" {
  if (event.key !== "Enter") return "none";
  if (event.isComposing || event.keyCode === 229) return "none";
  return event.shiftKey ? "newline" : "send";
}

const OFFLINE_LABEL = { online: "Online", offline: "Offline", syncing: "Syncing", error: "Sync error" } as const;

interface PendingAttachment {
  readonly attachment: Attachment;
  readonly threadId: string;
  readonly machineId?: string;
  readonly machineLabel: string;
}

type AdapterOperation = "photo" | "file" | "scan" | "camera";

function describeFailure(operation: AdapterOperation, error: unknown): string {
  const detail = error instanceof Error && error.message ? ` (${error.message})` : "";
  const verb = operation === "scan" ? "Machine scan" : operation === "camera" ? "Camera capture" : operation === "photo" ? "Photo capture" : "File attachment";
  return `${verb} failed${detail}. Try again.`;
}

export function Composer({ state, dispatch, adapter, hooks, attachmentTrapsTab = true }: ComposerProps) {
  const [pending, setPending] = useState<readonly PendingAttachment[]>([]);
  const [busy, setBusy] = useState<AdapterOperation | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const machine = machineName(state, state.activeContext.machineId);
  const native = state.profile.nativeDevice;
  const canSend = state.draft.trim().length > 0;
  const crumbs = breadcrumb(state);
  const using = [...crumbs, machine].filter((value): value is string => Boolean(value));
  // Pending attachments belong to the thread they were captured in; a loaded
  // thread never inherits another thread's pending evidence.
  const visiblePending = pending.filter((item) => item.threadId === state.thread.id);

  const closeMenu = () => dispatch({ type: "set-attachment-menu-visible", visible: false });

  const run = <T,>(operation: AdapterOperation, call: () => Promise<T>, onResult: (value: T) => void) => {
    if (busy) return;
    closeMenu();
    setBusy(operation);
    setFailure(null);
    call().then(onResult, (error: unknown) => setFailure(describeFailure(operation, error)))
      .finally(() => setBusy(null));
  };

  const attach = (operation: "photo" | "file" | "camera", pick: () => Promise<Attachment | null>) => {
    const captured = {
      threadId: state.thread.id,
      machineId: state.activeContext.machineId,
      machineLabel: machine ?? "no machine",
    };
    run(operation, pick, (attachment) => {
      if (attachment) setPending((current) => [...current, { attachment, ...captured }]);
    });
  };

  const scan = () => run("scan", adapter.scanMachine, (machineId) => {
    if (machineId) dispatch({ type: "select-machine", machineId });
  });

  const send = () => {
    const text = state.draft.trim();
    if (!text) return;
    if (hooks?.onSend) {
      try {
        hooks.onSend(text);
        dispatch({ type: "set-draft", draft: "" });
        dispatch({ type: "set-send-error", error: null });
      } catch (error) {
        // Preserve the question in the composer and show a plain-language error
        // (no status codes or technical details).
        const errorMessage = error instanceof Error ? error.message : String(error);
        const plainMessage = withoutStatusCode(errorMessage);
        dispatch({ type: "set-send-error", error: plainMessage.trim() || "Couldn't reach MIRA. Your message is saved." });
      }
    } else {
      dispatch({ type: "mock-send" });
      dispatch({ type: "set-send-error", error: null });
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    send();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const action = composerKeyAction({
      key: event.key,
      shiftKey: event.shiftKey,
      isComposing: event.nativeEvent.isComposing,
      keyCode: event.keyCode,
    });
    if (action !== "send") return;
    event.preventDefault();
    send();
  };

  return <form className="fl-composer" aria-label="Composer" data-menu-open={state.attachmentMenuVisible} onSubmit={onSubmit}>
    {state.offline.state !== "online" ? <p className="fl-composer__sync" role="status" aria-label="Sync status" aria-live="polite" aria-atomic="true" data-sync-state={state.offline.state}>
      {OFFLINE_LABEL[state.offline.state]} · {state.offline.pendingChanges} pending
      {state.offline.detail ? ` · ${state.offline.detail}` : ""}
    </p> : null}

    <p className="fl-composer__context" title={using.length > 0 ? using.join(" / ") : "Workspace"}>
      Using: {using.length > 0 ? using[using.length - 1] : "Workspace"}
    </p>

    {failure ? <p className="fl-composer__failure" role="alert" aria-label="Attachment error">{failure}</p> : null}

    {visiblePending.length > 0 ? <ul className="fl-composer__pending" aria-label="Pending attachments">
      {visiblePending.map((item) => <li
        key={item.attachment.id}
        data-captured-machine-id={item.machineId ?? ""}
        data-context-mismatch={item.machineId !== state.activeContext.machineId}
      >
        {item.attachment.name} · captured for {item.machineLabel}
        {item.machineId !== state.activeContext.machineId ? " · not the active machine" : ""}
        {" · pending · not sent in this lab"}
      </li>)}
    </ul> : null}

    <Overlay layer="attachment-menu" active={state.attachmentMenuVisible} modal trapsTab={attachmentTrapsTab}>
      {state.attachmentMenuVisible ? <AttachmentMenu
        native={native}
        busy={busy !== null}
        onPhoto={() => attach("photo", adapter.attachPhoto)}
        onFile={() => attach("file", adapter.attachFile)}
        onCamera={() => attach("camera", adapter.attachCamera)}
        onScan={scan}
        onClose={() => dispatch({ type: "set-attachment-menu-visible", visible: false })}
      /> : null}
    </Overlay>

    <div className="fl-composer__row">
      <button
        type="button"
        className="fl-composer__icon"
        aria-label="Add attachment"
        aria-expanded={state.attachmentMenuVisible}
        aria-busy={busy !== null}
        onClick={() => dispatch({ type: "set-attachment-menu-visible", visible: !state.attachmentMenuVisible })}
      >
        ＋
      </button>
      <textarea
        aria-label="Ask MIRA"
        // The prototype's full prompt on web; at phone width it wrapped to three lines
        // beside four controls, so the mobile profile keeps the short form.
        placeholder={state.profile.kind === "mobile" ? "Ask MIRA" : (machine ? "Ask MIRA about this machine…" : "Ask MIRA…")}
        rows={1}
        value={state.draft}
        onChange={(event) => dispatch({ type: "set-draft", draft: event.currentTarget.value })}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        className="fl-composer__machine"
        aria-label="Machine"
        aria-busy={busy === "scan"}
        disabled={native && busy !== null}
        title={native ? "Scan a machine QR code" : "Choose a machine in navigation"}
        onClick={() => {
          if (native) scan();
          else dispatch({ type: "set-navigation-visible", visible: true });
        }}
      >
        ⌁ {machine ? `${machine} · ${state.activeContext.machineIdentity.replace("_", " ")}` : "No machine"}
      </button>
      <button
        type="button"
        className="fl-composer__icon"
        aria-label="Voice"
        disabled
        title="Voice input is not available in this lab"
      >
        <MicIcon />
      </button>
      {hooks?.busy && hooks.onStop
        ? <button type="button" className="fl-composer__send" aria-label="Stop" onClick={hooks.onStop}>■</button>
        : <button type="submit" className="fl-composer__send" aria-label="Send" disabled={!canSend || Boolean(hooks?.busy)}>↑</button>}
    </div>
  </form>;
}
