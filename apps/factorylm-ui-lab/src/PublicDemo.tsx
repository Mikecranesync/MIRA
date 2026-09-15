/**
 * The public demo host.
 *
 * The lab is the only host that consumes the shared shell today (#3806), so it
 * is where the demo runs locally. It is a HOST, not a second product: it owns
 * configuration, the two clients, and the wiring between them, and it renders
 * `FactoryLMShell` exactly as the Hub or the phone would.
 *
 * Configuration is query-string only — no committed URL, no `.env`, no secret:
 *
 *   ?surface=public&demo=simlab
 *   &simlab=http://127.0.0.1:8099       (default)
 *   &hub=http://127.0.0.1:3000          (where the shared chat route lives)
 *   &notebook=<uuid>                    (the notebook whose sources ground it)
 *
 * Without `notebook` the chat client reports `not_configured` and the visitor is
 * told so. That is the honest state: the shared chat route begins with
 * `sessionOr401`, so an anonymous preview genuinely cannot reach it, and a demo
 * that answered anyway would be demonstrating something this product does not do.
 */
import {
  NotebookChatClient,
  PROFILES,
  SimLabClient,
  createShellState,
  demoMachines,
  getFixture,
  shellReducer,
  type ChatResult,
  type InteractionTurn,
  type ShellState,
} from "@factorylm/interaction";
import { FactoryLMShell, MachineView, useSimLabDemo } from "@factorylm/ui";
import { useCallback, useMemo, useReducer, useState } from "react";
import { createLabAdapter } from "./fake-adapter";

export interface PublicDemoConfig {
  readonly simlabUrl: string;
  readonly hubUrl: string;
  readonly notebookId?: string;
}

export const DEFAULT_DEMO_CONFIG: PublicDemoConfig = {
  simlabUrl: "http://127.0.0.1:8099",
  hubUrl: "http://127.0.0.1:3000",
};

export function parseDemoConfig(search: string): PublicDemoConfig {
  const params = new URLSearchParams(search);
  const notebookId = params.get("notebook") ?? undefined;
  return {
    simlabUrl: params.get("simlab") ?? DEFAULT_DEMO_CONFIG.simlabUrl,
    hubUrl: params.get("hub") ?? DEFAULT_DEMO_CONFIG.hubUrl,
    ...(notebookId ? { notebookId } : {}),
  };
}

/** Build the assistant turn for a chat result — answer or honest refusal. */
export function assistantTurn(threadId: string, result: ChatResult, state: ShellState, at: string): InteractionTurn {
  const base = {
    id: `${threadId}-a-${state.thread.turns.length + 1}`,
    threadId,
    role: "assistant" as const,
    context: state.activeContext,
    createdAt: at,
    updatedAt: at,
  };
  if (result.ok) return { ...base, parts: result.parts, lifecycle: result.lifecycle };
  // No answer, and nothing in its place: the reason, rendered as an error the
  // shell already knows how to show.
  return {
    ...base,
    parts: [
      { type: "error", error: { code: result.reason === "unreachable" ? "offline" : "provider_failure", message: result.message, retryable: true } },
      { type: "status", status: "failed" },
    ],
    lifecycle: "failed",
  };
}

export function userTurn(threadId: string, text: string, state: ShellState, at: string): InteractionTurn {
  return {
    id: `${threadId}-u-${state.thread.turns.length + 1}`,
    threadId,
    role: "user",
    parts: [{ type: "text", text }],
    lifecycle: "completed",
    context: state.activeContext,
    createdAt: at,
    updatedAt: at,
  };
}

export function PublicDemo({ config }: { readonly config: PublicDemoConfig }) {
  const simlab = useMemo(
    () => new SimLabClient({
      baseUrl: config.simlabUrl,
      fetch: (input, init) => fetch(input, init as RequestInit),
    }),
    [config.simlabUrl],
  );
  const chat = useMemo(
    () => new NotebookChatClient({
      baseUrl: config.hubUrl,
      ...(config.notebookId ? { notebookId: config.notebookId } : {}),
      fetch: (input, init) => fetch(input, init as RequestInit),
    }),
    [config.hubUrl, config.notebookId],
  );

  const demo = useSimLabDemo({ client: simlab });
  const [state, dispatch] = useReducer(
    shellReducer,
    null,
    () => createShellState(getFixture("empty"), PROFILES.public),
  );
  const [asking, setAsking] = useState(false);
  const [conversions, setConversions] = useState<string[]>([]);

  const adapter = useMemo(() => createLabAdapter(
    () => ({ activeMachineId: undefined, machineIds: [] }),
    () => {},
  ), []);

  // The machines in navigation are the demo's own assets, so the sidebar and
  // the diagram cannot disagree about what is on the line.
  const machines = useMemo(() => demoMachines(demo.state), [demo.state]);

  const onSend = useCallback((text: string) => {
    const at = new Date().toISOString();
    const withQuestion = shellReducer(state, {
      type: "hydrate",
      data: {
        thread: { ...state.thread, turns: [...state.thread.turns, userTurn(state.thread.id, text, state, at)] },
        machines,
      },
    });
    dispatch({ type: "hydrate", data: { thread: withQuestion.thread, machines } });
    setAsking(true);
    void chat
      .ask({
        message: text,
        history: state.thread.turns
          .filter((turn) => turn.role === "user" || turn.role === "assistant")
          .map((turn) => ({
            role: turn.role as "user" | "assistant",
            content: turn.parts.filter((part) => part.type === "text").map((part) => part.text).join(" "),
          })),
      })
      .then((result) => {
        dispatch({
          type: "hydrate",
          data: {
            thread: {
              ...withQuestion.thread,
              turns: [...withQuestion.thread.turns, assistantTurn(state.thread.id, result, withQuestion, new Date().toISOString())],
            },
            machines,
          },
        });
      })
      .finally(() => setAsking(false));
  }, [chat, machines, state]);

  const resetDemo = useCallback(async () => {
    await demo.reset();
    // The conversation resets with the machine: a cited answer about a jam that
    // is no longer there is the most confusing thing this page could leave up.
    dispatch({ type: "load-fixture", fixture: getFixture("empty"), profile: PROFILES.public });
  }, [demo]);

  return <FactoryLMShell
    state={state}
    dispatch={dispatch}
    adapter={adapter}
    hooks={{
      onSend,
      busy: asking,
      onConvert: (intent) => setConversions((seen) => [...seen, intent]),
    }}
    machinePanel={<MachineView
      state={state}
      demo={demo.state}
      onInject={() => { void demo.injectJam(); }}
      onReset={() => { void resetDemo(); }}
      busy={demo.busy}
    />}
    navigationFooter={<>
      <p className="lab__demo-config">
        SimLab {config.simlabUrl}
        <br />Hub {config.hubUrl}
        <br />Notebook {config.notebookId ?? "not configured"}
      </p>
      {conversions.length > 0
        ? <p className="lab__demo-config">Conversions: {conversions.join(", ")}</p>
        : null}
    </>}
  />;
}
