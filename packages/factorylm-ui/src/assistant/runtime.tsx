/**
 * assistant-ui ExternalStoreRuntime over the shared interaction contract.
 *
 * Boundary (blueprint §7, ADR-0037): assistant-ui owns the commodity thread
 * behaviour — viewport, autoscroll, jump-to-latest, run state. FactoryLM owns
 * the messages: the interaction store's `InteractionTurn`s are the truth, and
 * this module PROJECTS them into `ThreadMessageLike`s. It never invents state
 * and it never mutates a turn.
 *
 * Every `InteractionPart` rides as a data part (`data-flm-part`) carrying the
 * turn and the part object itself, so conversion is lossless by construction:
 * the shared `PartRenderer` receives exactly the part the store holds — ids,
 * citation labels, machine ids, lifecycle — with no re-encoding in between.
 * A leading `data-flm-head` part carries the turn for the head line (role and
 * context). Controls are exposed only when the host backs them: `onCancel`
 * exists only when `hooks.onStop` does.
 */
import { useExternalStoreRuntime, type ThreadMessageLike } from "@assistant-ui/react";
import type { InteractionPart, InteractionTurn, Lifecycle, ShellAction, ShellState } from "@factorylm/interaction";
import type { Dispatch } from "react";
import type { HostHooks } from "../parts";

export const HEAD_PART_NAME = "flm-head";
export const TURN_PART_NAME = "flm-part";

export interface HeadPartData {
  readonly turn: InteractionTurn;
}

export interface TurnPartData {
  readonly turn: InteractionTurn;
  readonly part: InteractionPart;
  readonly index: number;
}

type ThreadContent = Exclude<ThreadMessageLike["content"], string>;
type ThreadContentPart = ThreadContent[number];

/** Store lifecycle → library run status. Only assistant turns carry a status. */
export function statusOf(lifecycle: Lifecycle): NonNullable<ThreadMessageLike["status"]> {
  switch (lifecycle) {
    case "accepted":
    case "queued":
    case "running":
    case "waiting":
    case "stopping":
      return { type: "running" };
    case "stopped":
    case "cancelled":
    case "safety_stop":
      return { type: "incomplete", reason: "cancelled" };
    case "failed":
      return { type: "incomplete", reason: "error" };
    case "completed":
      return { type: "complete", reason: "stop" };
  }
}

function dataPart(name: string, data: unknown): ThreadContentPart {
  // Data parts are `{ type: "data-<name>", data }`; the library types the
  // payload as `any`, so the cast only names the shape we hand it.
  return { type: `data-${name}`, data } as unknown as ThreadContentPart;
}

/** The ONE inbound conversion (store → library). Pure; same input, same output. */
export function turnToThreadMessage(turn: InteractionTurn): ThreadMessageLike {
  const head = dataPart(HEAD_PART_NAME, { turn } satisfies HeadPartData);
  const parts = turn.parts.map((part, index) => dataPart(TURN_PART_NAME, { turn, part, index } satisfies TurnPartData));
  return {
    id: turn.id,
    // The library role is a rendering group, not the FactoryLM role: it requires
    // a system message to be exactly one text part, which cannot carry typed
    // parts. System turns therefore render in the assistant group; the head
    // label and every data attribute still come from the store turn.
    role: turn.role === "system" ? "assistant" : turn.role,
    createdAt: new Date(turn.createdAt),
    content: [head, ...parts],
    ...(turn.role !== "user" ? { status: statusOf(turn.lifecycle) } : {}),
  };
}

/** The text a library-composed message would send. Empty when there is none. */
export function textOfAppend(content: ThreadMessageLike["content"]): string {
  if (typeof content === "string") return content.trim();
  for (const part of content) {
    if (typeof part === "object" && part !== null && (part as { type?: string }).type === "text") {
      return String((part as { text?: string }).text ?? "").trim();
    }
  }
  return "";
}

/**
 * Route a library-originated send to the host. With a host `onSend` the text
 * goes to the host's real send path; without one (the disconnected lab) it
 * becomes a reducer mock send, exactly as the classic Composer does.
 */
export function sendText(text: string, dispatch: Dispatch<ShellAction>, hooks: HostHooks | undefined): void {
  if (!text) return;
  if (hooks?.onSend) {
    hooks.onSend(text);
    return;
  }
  dispatch({ type: "set-draft", draft: text });
  dispatch({ type: "mock-send" });
}

export interface InteractionRuntimeOptions {
  readonly state: ShellState;
  readonly dispatch: Dispatch<ShellAction>;
  readonly hooks?: HostHooks;
}

export function useInteractionRuntime({ state, dispatch, hooks }: InteractionRuntimeOptions) {
  return useExternalStoreRuntime<InteractionTurn>({
    messages: state.thread.turns,
    isRunning: Boolean(hooks?.busy),
    convertMessage: turnToThreadMessage,
    onNew: async (message) => {
      sendText(textOfAppend(message.content), dispatch, hooks);
    },
    // Stop exists only when the host can actually abort (blueprint §7: no fake stop).
    ...(hooks?.onStop ? { onCancel: async () => hooks.onStop?.() } : {}),
  });
}
