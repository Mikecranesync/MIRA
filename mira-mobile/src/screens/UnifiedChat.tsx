/**
 * Unified conversation surface (FLM-UI-4000 Phase 2, mobile lane): the shared
 * FactoryLM shell rendering THIS notebook's real turns through the mobile
 * chat-adapter vocabulary — on the assistant-ui thread (ADR-0037: the library
 * owns viewport, autoscroll, jump-to-latest and run state; the shell's parts,
 * composer, header and navigation are unchanged). The screen keeps owning the send path, scope,
 * riders, Retry body, uploads and the citation viewer — exactly as ChatV2 does
 * — so switching surfaces changes the shell, never the semantics.
 *
 * Shared code stays host-agnostic: the packages are reached through Vite
 * aliases (no package.json change, so the OTA guard's native-path check stays
 * green) and receive live data through the reducer's `hydrate` action.
 */
import "@factorylm/theme/workspace.css";
import "@factorylm/ui/shell.css";
import "@factorylm/ui/conversation.css";
import "../unified/unified.css";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  PROFILES,
  createShellState,
  shellReducer,
  type Machine,
  type Project,
  type ProjectItem,
  type ShellState,
} from "@factorylm/interaction";
import type { ReactNode } from "react";
import type { Attachment, InteractionPart, InteractionTurn } from "@factorylm/interaction";
import { FactoryLMShell, closeLayerAction, topLayer, type HostHooks } from "@factorylm/ui";
import { AnswerMarkdown, copyText } from "./AnswerMarkdown";
import type { NotebookServerTurn } from "../api/resources";
import { threadMessages } from "../chat-adapter/turns-to-parts";
import type { ChatCitation, ChatTurn } from "../lib/sse";
import { registerTransientLayer } from "../lib/transient-layer";
import { createCapacitorAdapter } from "../unified/capacitor-adapter";
import {
  assertSupportedAttachments,
  questionForAttachments,
  useUnifiedAttachments,
  type VisualEvidenceRider,
} from "../unified/attachments";
import {
  citationIndex,
  contextFor,
  liveFixture,
  machinesFor,
  projectsFor,
  toThread,
  type UnifiedNotebookMeta,
} from "../unified/to-interaction";
import type { ChatV2Handlers } from "./ChatV2";

/** What the unified ROOT supplies when the shell owns the whole app: the
 *  notebook/machine tree, item opening, and host-owned navigation controls. */
export interface UnifiedShellHost {
  readonly projects: readonly Project[];
  readonly machines: readonly Machine[];
  readonly onOpenItem: (item: ProjectItem) => void;
  readonly onSelectProject?: (projectId: string) => void;
  readonly navigationFooter?: ReactNode;
}

export interface UnifiedChatProps {
  readonly turns: NotebookServerTurn[];
  readonly liveTurns: { q: string; a: ChatTurn }[];
  readonly pending: { q: string; a: ChatTurn } | null;
  readonly busy: boolean;
  readonly canStop: boolean;
  readonly canRetry: boolean;
  readonly chatError: string | null;
  readonly handlers: UnifiedChatHandlers;
  readonly meta: Omit<UnifiedNotebookMeta, "capturedAt">;
  readonly host?: UnifiedShellHost;
  readonly initialQuestion?: string | null;
  readonly onInitialQuestionSent?: () => void;
  readonly failedQuestion?: string | null;
  readonly groundingLine?: () => string | undefined;
  readonly suggestChips?: () => readonly { id: string; text: string }[] | undefined;
  /** Notebook attachments upload into. `null` on HOME, where the bytes are
   *  stashed for the thread the send is about to create. Defaults to the
   *  notebook this shell is already rendering. */
  readonly attachmentNotebookId?: string | null;
  /** Backend conversation id; meta.threadId is a shell presentation id. */
  readonly attachmentThreadId?: string | null;
}

/**
 * The unified surface's handler contract.
 *
 * `onSend` is widened HERE rather than in `ChatV2Handlers`: ChatV2 is a frozen
 * legacy surface with no pending-attachment chip, so giving it an
 * attachment-aware contract would change a rollback surface to serve the new
 * shell. The two attach members are inherited unchanged and deliberately
 * UNUSED on this surface — the shell picks natively through its own controller
 * (`../unified/attachments`), so a host that still passes ChatV2's
 * upload-and-ask handlers keeps compiling while the unified composer previews.
 *
 * `evidence` is the same rider the notebook send path already accepts for
 * Sensor, so an attachment rides the ONE existing send path rather than a
 * second one. A host that ignores the argument still compiles; it simply gets
 * no attachment support.
 */
export interface UnifiedChatHandlers
  extends Omit<ChatV2Handlers, "onSend" | "onAttachPhoto" | "onAttachCamera" | "onAttachFile"> {
  readonly onSend: (text: string, evidence?: VisualEvidenceRider) => void;
  /** Inherited from ChatV2 and UNUSED here — optional so neither host has to
   *  pass a handler the unified composer never calls. */
  readonly onAttachPhoto?: () => void;
  readonly onAttachCamera?: () => void;
  readonly onAttachFile?: () => void;
  readonly onScanMachine?: () => Promise<string | null> | string | null;
  readonly onNewChat?: () => void;
  readonly onCreateProject?: () => void;
}

function initialState(messages: ReturnType<typeof threadMessages>, meta: UnifiedNotebookMeta, host?: UnifiedShellHost): ShellState {
  const fixture = liveFixture(messages, meta);
  const created = createShellState(
    host ? { ...fixture, projects: host.projects, machines: host.machines } : fixture,
    PROFILES.mobile,
  );
  // The fixture contract opens the drawer at mount for review; a live screen
  // starts on the conversation.
  return shellReducer(created, { type: "set-navigation-visible", visible: false });
}

export function UnifiedChat({
  turns,
  liveTurns,
  pending,
  busy,
  canStop,
  canRetry,
  chatError,
  handlers,
  meta,
  host,
  initialQuestion,
  onInitialQuestionSent,
  failedQuestion,
  groundingLine,
  suggestChips,
  attachmentNotebookId,
  attachmentThreadId,
}: UnifiedChatProps) {
  const capturedAt = useRef(new Date().toISOString());
  const fullMeta = useMemo<UnifiedNotebookMeta>(() => ({ ...meta, capturedAt: capturedAt.current }), [meta]);
  const messages = useMemo(() => threadMessages(turns, liveTurns, pending), [turns, liveTurns, pending]);
  const citations = useMemo(() => citationIndex(messages), [messages]);
  const [state, dispatch] = useReducer(shellReducer, undefined, () => initialState(messages, fullMeta, host));

  useEffect(() => {
    dispatch({
      type: "hydrate",
      data: {
        thread: toThread(messages, fullMeta),
        projects: host ? host.projects : projectsFor(fullMeta),
        machines: host ? host.machines : machinesFor(fullMeta),
        activeContext: contextFor(fullMeta, messages.some((m) => m.parts.some((p) => p.type === "identity_dispute"))),
      },
    });
  }, [messages, fullMeta, host]);

  // Open shell layers join the app's one BACK stack (lib/transient-layer.ts):
  // hardware BACK closes the top layer before any tab navigation happens.
  const layer = topLayer(state);
  const layerRef = useRef(layer);
  layerRef.current = layer;
  useEffect(() => {
    if (!layer) return;
    return registerTransientLayer(() => {
      const current = layerRef.current;
      if (current) dispatch(closeLayerAction(current));
    });
  }, [layer]);

  // Attachments are the SHELL's job now, not the screen's: the controller owns
  // the native pick, holds the bytes, and uploads through the existing doors at
  // send time. The host's own attach handlers are intentionally not wired here
  // (see UnifiedChatHandlers) — they upload-and-ask immediately, which is the
  // behaviour the preview flow replaces.
  const attachTarget = attachmentNotebookId === undefined ? meta.notebookId : attachmentNotebookId;
  const attachments = useUnifiedAttachments(attachTarget, attachmentThreadId);
  const adapter = useMemo(() => createCapacitorAdapter({
    onAttachPhoto: attachments.attachPhoto,
    onAttachFile: attachments.attachFile,
    onAttachCamera: attachments.attachCamera,
    onScanMachine: handlers.onScanMachine,
  }), [attachments.attachPhoto, attachments.attachFile, attachments.attachCamera, handlers.onScanMachine]);

  // The assistant surface renders text through the SAME markdown + inline
  // citation-mark pipeline ChatV2 uses (AnswerMarkdown), gated on the turn's
  // own source parts so an unknown [7] stays literal text. A user turn is plain.
  const onCitation = handlers.onCitation;
  const renderText = useCallback((text: string, turn: InteractionTurn): ReactNode => {
    if (turn.role === "user") return text;
    const own: ChatCitation[] = [];
    for (const part of turn.parts) {
      if (part.type !== "source") continue;
      const citation = citations.get(part.source.id);
      if (citation) own.push(citation);
    }
    return <AnswerMarkdown text={text} citations={own} onCitation={onCitation} />;
  }, [citations, onCitation]);


  /**
   * Copy an answer WITH its citations. `copyText` is only the clipboard
   * primitive — ChatV2 copies the bare answer, so a pasted answer there loses
   * the one thing that makes it trustworthy. The shell hands us a turn id; we
   * rebuild the text from the store's own parts so the copied block always
   * matches what is on screen, then append the sources it cited.
   */
  const onCopy = useCallback((turnId: string) => {
    const turn = state.thread.turns.find((t) => t.id === turnId);
    if (!turn) return;
    const body = turn.parts
      .filter((part): part is Extract<InteractionPart, { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join("\n\n")
      .trim();
    const sources = turn.parts
      .filter((part): part is Extract<InteractionPart, { type: "source" }> => part.type === "source")
      // Label by the source id the inline marks use, so the pasted block matches
      // the [n] the reader saw. Numbering by position renumbers them silently.
      .map((part) => `[${part.source.id}] ${part.source.title}${part.source.locator ? ` ${part.source.locator}` : ""}`);
    const text = sources.length > 0 ? `${body}\n\nSources:\n${sources.join("\n")}` : body;
    if (text) void copyText(text);
  }, [state.thread.turns]);

  // NotebookScreen reports a failed send later via `chatError`, and nothing
  // throws, so the try/catch in Composer could never fire on device — the humane
  // error surface was unreachable exactly where it was needed. Mirror the host's
  // error into shell state so the in-thread surface (with Retry) is the one the
  // technician sees.
  // Mirror only on a CHANGE in the host's error. `state.draft` is a dependency
  // (the restore below reads it), so an unconditional dispatch re-ran on every
  // keystroke and on the draft this effect itself restores — forcing
  // `chatError ?? null` and silently erasing an error the attachment path had
  // just set locally. An upload that failed then looked like nothing happened:
  // the question reappeared in the composer with no explanation.
  const mirroredChatError = useRef<string | null>(null);
  useEffect(() => {
    const next = chatError ?? null;
    if (mirroredChatError.current === next) return;
    mirroredChatError.current = next;
    dispatch({ type: "set-send-error", error: next });
    // The composer clears the draft at send time, so by the time a failure
    // arrives the question is gone. Put it back — host-owned, because only the
    // host knows what was in flight. The reducer has no idea what failed.
    if (chatError && !state.draft.trim()) {
      const q = failedQuestion ?? pending?.q ?? liveTurns.at(-1)?.q ?? "";
      if (q) dispatch({ type: "set-draft", draft: q });
    }
  }, [chatError, failedQuestion, pending, liveTurns, state.draft]);

  /**
   * One send, composed. On HOME there is no notebook yet, so the bytes are
   * stashed and the host's send creates the thread that claims them. In a
   * notebook the uploads run first and the resulting rider goes out with the
   * question on the host's existing send path.
   */
  const onSend = useCallback((text: string, pending: readonly Attachment[], opts: { retry?: boolean } = {}) => {
    // Keep chips available when the request exceeds the single-photo contract.
    assertSupportedAttachments(pending);
    if (!attachTarget) {
      if (pending.length > 0) attachments.stashForHandoff(pending);
      handlers.onSend(questionForAttachments(text, pending));
      return;
    }
    // Nothing held here, nothing carried from HOME, and not a retry: the plain,
    // synchronous text send, unchanged. `hasCarried()` is what keeps the HOME
    // handoff from being skipped — the composer's own pending list is empty in
    // the notebook the handoff just opened, so a pending-only check sent the
    // question and left the photo behind for the NEXT send. A failed send's
    // retained bytes are deliberately NOT a reason to compose here (#3863):
    // they ride only the explicit Try again below.
    if (pending.length === 0 && !attachments.hasCarried() && !opts.retry) {
      handlers.onSend(text);
      return;
    }
    void attachments.compose(text, pending, opts).then((composed) => {
      if (composed.failure) {
        // Do not send: a photo question with no photo would answer from nothing.
        dispatch({ type: "set-send-error", error: composed.failure });
        dispatch({ type: "set-draft", draft: composed.question });
        return;
      }
      handlers.onSend(composed.question, composed.rider);
      // Uploaded but not searchable stays visible rather than being swallowed.
      if (composed.warning) dispatch({ type: "set-send-error", error: composed.warning });
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      dispatch({ type: "set-send-error", error: message || "The attachment didn't upload — try again." });
      dispatch({ type: "set-draft", draft: text });
    });
  }, [attachTarget, attachments, handlers, dispatch]);

  // The question HOME queued for the thread it just created. It goes through
  // `onSend` (not straight to the host) so the attachments HOME stashed are
  // composed and uploaded for THIS turn.
  const initialSentRef = useRef<string | null>(null);
  useEffect(() => {
    const text = initialQuestion?.trim();
    if (!text || busy || initialSentRef.current === text) return;
    initialSentRef.current = text;
    onSend(text, []);
    onInitialQuestionSent?.();
  }, [busy, onSend, initialQuestion, onInitialQuestionSent]);

  const hooks: HostHooks = {
    onSend,
    renderText,
    onCopy,
    ...(canStop ? { onStop: handlers.onStop } : {}),
    // The host retry re-sends the rendered turn as plain text. That is right for
    // a text turn and WRONG for one whose attachment never uploaded: it would
    // ask the photo question with no photo — the outcome `compose` refuses on
    // the first attempt (see attachments.ts). When the controller still holds
    // the bytes, retry through the composed path so the photo rides the turn.
    ...(canRetry && handlers.onRetry
      ? { onRetry: () => {
          if (attachments.hasRetained() || attachments.hasCarried()) {
            dispatch({ type: "set-send-error", error: null });
            onSend(state.draft, [], { retry: true });
            return;
          }
          handlers.onRetry?.();
        } }
      : {}),
    ...(handlers.onNewChat ? { onNewChat: handlers.onNewChat } : {}),
    ...(handlers.onCreateProject ? { onCreateProject: handlers.onCreateProject } : {}),
    onSource: (source) => {
      const citation: ChatCitation | undefined = citations.get(source.id);
      if (citation) handlers.onCitation(citation);
    },
    onScanMachine: handlers.onScanMachine,
    groundingLine,
    suggestChips,
    busy,
  };

  return <div className="unified-host" data-testid="unified-chat">
    {/* No host-level error banner: the shell's SendError is the surface now. It
        renders in the thread, strips status codes, offers the host's own Retry
        and dismisses — keeping this too drew two error surfaces for one failure. */}
    <FactoryLMShell
      state={state}
      dispatch={dispatch}
      adapter={adapter}
      hooks={hooks}
      conversationSurface="assistant"
      onOpenItem={host?.onOpenItem}
      onSelectProject={host?.onSelectProject}
      navigationFooter={host?.navigationFooter}
    />
  </div>;
}
