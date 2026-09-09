/**
 * The conversation surface on assistant-ui primitives (blueprint Phase 3).
 *
 * assistant-ui owns: the thread viewport, stick-to-bottom autoscroll,
 * jump-to-latest, and the message list keyed by stable turn ids. FactoryLM
 * owns everything that carries meaning: the bar (breadcrumb, Ask/Work,
 * machine chip), the run card, the head line per turn, and every part — all
 * rendered by the same components the classic `Conversation` uses, so the two
 * surfaces cannot drift in what they say, only in how the viewport behaves.
 *
 * The composer stays the MIRA-owned `Composer` (mounted by the shell, outside
 * this component): its Enter/Shift+Enter/IME contract is proven on a device
 * soft keyboard, and the library input did not submit on a synthetic Enter
 * there (see mira-mobile ChatV2). Deliberate, documented, revisitable.
 */
import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  type DataMessagePartComponent,
} from "@assistant-ui/react";
import type { InteractionTurn, PlatformAdapter, ShellAction, ShellState } from "@factorylm/interaction";
import { createContext, useContext, useMemo, type Dispatch } from "react";
import { ConversationBar, RunCard } from "../Conversation";
import { PartRenderer, contextDiffers, describeContext, type HostHooks } from "../parts";
import { HEAD_PART_NAME, TURN_PART_NAME, useInteractionRuntime, type HeadPartData, type TurnPartData } from "./runtime";

export interface AssistantThreadProps {
  readonly state: ShellState;
  readonly dispatch: Dispatch<ShellAction>;
  readonly adapter: PlatformAdapter;
  readonly hooks?: HostHooks;
}

/** What every part component needs beyond its own payload: the live shell. */
interface ThreadEnvironment {
  readonly state: ShellState;
  readonly dispatch: Dispatch<ShellAction>;
  readonly adapter: PlatformAdapter;
  readonly hooks?: HostHooks;
  readonly turns: ReadonlyMap<string, InteractionTurn>;
}

const EnvironmentContext = createContext<ThreadEnvironment | null>(null);

function useEnvironment(): ThreadEnvironment {
  const environment = useContext(EnvironmentContext);
  if (!environment) throw new Error("AssistantThread parts must render inside AssistantThread");
  return environment;
}

const ROLE_LABEL = { user: "You", assistant: "MIRA", system: "System" } as const;

const HeadPart: DataMessagePartComponent<HeadPartData> = ({ data }) => {
  const { state } = useEnvironment();
  const { turn } = data as HeadPartData;
  return <div className="fl-turn__head">
    <span className="fl-turn__role">{ROLE_LABEL[turn.role]}</span>
    {contextDiffers(state, turn.context)
      ? <span className="fl-card__meta" data-context-line="turn">{describeContext(state, turn.context)}</span>
      : null}
  </div>;
};

const TurnPart: DataMessagePartComponent<TurnPartData> = ({ data }) => {
  const { state, dispatch, adapter, hooks } = useEnvironment();
  const { part, turn } = data as TurnPartData;
  return <PartRenderer part={part} turn={turn} state={state} dispatch={dispatch} adapter={adapter} hooks={hooks} />;
};

/** A part the library produced that the store never emitted (should not happen). */
const UnexpectedPart: DataMessagePartComponent = () => <p className="fl-part fl-unknown" data-part-type="unexpected">
  Unsupported content.
</p>;

const partComponents = {
  data: {
    by_name: {
      [HEAD_PART_NAME]: HeadPart,
      [TURN_PART_NAME]: TurnPart,
    },
    Fallback: UnexpectedPart,
  },
};

/** One turn. The root carries the same data attributes as the classic surface
 *  (`data-turn-id`, `data-role`, `data-lifecycle`) so tests and styles address
 *  both surfaces with one selector. */
function TurnMessage() {
  const id = useAuiState((aui) => aui.message.id);
  const { turns, hooks } = useEnvironment();
  const turn = turns.get(id);
  const isAssistant = turn?.role === "assistant";
  return <MessagePrimitive.Root
    className="fl-turn fl-turn--aui"
    data-turn-id={id}
    data-role={turn?.role ?? ""}
    data-lifecycle={turn?.lifecycle ?? ""}
    data-context-machine-id={turn?.context.machineId ?? ""}
  >
    <MessagePrimitive.Parts components={partComponents} />
    {isAssistant ? (
      <div className="fl-turn__actions">
        {hooks?.onCopy ? (
          <button
            type="button"
            className="fl-turn__action"
            aria-label="Copy"
            title="Copy answer"
            onClick={() => hooks.onCopy?.(id)}
          >
            <span className="fl-turn__action-icon">⧉</span>
          </button>
        ) : null}
        {hooks?.onRegenerate ? (
          <button
            type="button"
            className="fl-turn__action"
            aria-label="Regenerate"
            title="Regenerate answer"
            onClick={() => hooks.onRegenerate?.(id)}
          >
            <span className="fl-turn__action-icon">↻</span>
          </button>
        ) : null}
        {hooks?.onFeedback ? (
          <>
            <button
              type="button"
              className="fl-turn__action"
              aria-label="Feedback"
              title="Thumbs up"
              onClick={() => hooks.onFeedback?.(id, "up")}
            >
              <span className="fl-turn__action-icon">👍</span>
            </button>
            <button
              type="button"
              className="fl-turn__action"
              aria-label="Feedback down"
              title="Thumbs down"
              onClick={() => hooks.onFeedback?.(id, "down")}
            >
              <span className="fl-turn__action-icon">👎</span>
            </button>
          </>
        ) : null}
      </div>
    ) : null}
  </MessagePrimitive.Root>;
}

const messageComponents = { UserMessage: TurnMessage, AssistantMessage: TurnMessage };

export function AssistantThread({ state, dispatch, adapter, hooks }: AssistantThreadProps) {
  const runtime = useInteractionRuntime({ state, dispatch, hooks });
  const turns = useMemo(() => new Map(state.thread.turns.map((turn) => [turn.id, turn])), [state.thread.turns]);
  const environment = useMemo<ThreadEnvironment>(
    () => ({ state, dispatch, adapter, hooks, turns }),
    [state, dispatch, adapter, hooks, turns],
  );

  return <AssistantRuntimeProvider runtime={runtime}>
    <EnvironmentContext.Provider value={environment}>
      <ThreadPrimitive.Root
        className="fl-conversation fl-conversation--aui"
        role="region"
        aria-label="Conversation"
        data-mode={state.mode}
        data-conversation-surface="assistant"
      >
        <ConversationBar state={state} dispatch={dispatch} />
        <ThreadPrimitive.Viewport className="fl-thread__viewport" autoScroll>
          {state.mode === "work"
            ? (state.run
              ? <RunCard run={state.run} state={state} />
              : <p className="fl-conversation__notice" role="status">No diagnostic run exists for this thread in the lab.</p>)
            : null}
          {state.thread.turns.length === 0
            ? <p className="fl-conversation__empty">No turns yet.</p>
            : null}
          <ThreadPrimitive.Messages components={messageComponents} />
          <ThreadPrimitive.ScrollToBottom className="fl-thread__jump" aria-label="Jump to latest">
            ↓ Latest
          </ThreadPrimitive.ScrollToBottom>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </EnvironmentContext.Provider>
  </AssistantRuntimeProvider>;
}
