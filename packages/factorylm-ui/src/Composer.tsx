import type { Attachment, PlatformAdapter, ShellAction, ShellState } from "@factorylm/interaction";
import { useState, type Dispatch, type FormEvent } from "react";
import { breadcrumb } from "./Conversation";
import { machineName } from "./parts";

export interface ComposerProps {
  readonly state: ShellState;
  readonly dispatch: Dispatch<ShellAction>;
  readonly adapter: PlatformAdapter;
}

const OFFLINE_LABEL = { online: "Online", offline: "Offline", syncing: "Syncing", error: "Sync error" } as const;

export function Composer({ state, dispatch, adapter }: ComposerProps) {
  const [pending, setPending] = useState<readonly Attachment[]>([]);
  const machine = machineName(state, state.activeContext.machineId);
  const native = state.profile.nativeDevice;
  const canSend = state.draft.trim().length > 0;
  const crumbs = breadcrumb(state);
  const using = [...crumbs, machine].filter((value): value is string => Boolean(value));

  const closeMenu = () => dispatch({ type: "set-attachment-menu-visible", visible: false });

  const attach = (pick: () => Promise<Attachment | null>) => {
    closeMenu();
    void pick().then((attachment) => {
      if (attachment) setPending((current) => [...current, attachment]);
    });
  };

  const scan = () => {
    closeMenu();
    void adapter.scanMachine().then((machineId) => {
      if (machineId) dispatch({ type: "select-machine", machineId });
    });
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    dispatch({ type: "mock-send" });
  };

  return <form className="fl-composer" aria-label="Composer" onSubmit={onSubmit}>
    {state.offline.state !== "online" ? <p className="fl-composer__sync" role="status" aria-label="Sync status" data-sync-state={state.offline.state}>
      {OFFLINE_LABEL[state.offline.state]} · {state.offline.pendingChanges} pending
      {state.offline.detail ? ` · ${state.offline.detail}` : ""}
    </p> : null}

    <p className="fl-composer__context">Using: {using.length > 0 ? using.join(" / ") : "Workspace"}</p>

    {pending.length > 0 ? <ul className="fl-composer__pending" aria-label="Pending attachments">
      {pending.map((attachment) => <li key={attachment.id}>
        {attachment.name} · pending · not sent in this lab
      </li>)}
    </ul> : null}

    {state.attachmentMenuVisible ? <div className="fl-composer__menu" aria-label="Attachment menu">
      <button type="button" onClick={() => attach(adapter.attachPhoto)}>Photo</button>
      <button type="button" onClick={() => attach(adapter.attachFile)}>File</button>
      <button
        type="button"
        disabled={!native}
        title={native ? "Capture a photo with the device camera" : "Camera requires a native device"}
        onClick={() => attach(adapter.attachPhoto)}
      >
        Camera
      </button>
      <button
        type="button"
        disabled={!native}
        title={native ? "Scan a machine QR code" : "Scanning requires a native device"}
        onClick={scan}
      >
        Scan machine
      </button>
    </div> : null}

    <div className="fl-composer__row">
      <button
        type="button"
        className="fl-composer__icon"
        aria-label="Add attachment"
        aria-expanded={state.attachmentMenuVisible}
        onClick={() => dispatch({ type: "set-attachment-menu-visible", visible: !state.attachmentMenuVisible })}
      >
        ＋
      </button>
      <textarea
        aria-label="Message"
        placeholder={machine ? "Ask MIRA about this machine…" : "Ask MIRA…"}
        rows={1}
        value={state.draft}
        onChange={(event) => dispatch({ type: "set-draft", draft: event.currentTarget.value })}
      />
      <button
        type="button"
        className="fl-composer__machine"
        aria-label="Machine"
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
        ◉
      </button>
      <button type="submit" className="fl-composer__send" aria-label="Send" disabled={!canSend}>↑</button>
    </div>
  </form>;
}
