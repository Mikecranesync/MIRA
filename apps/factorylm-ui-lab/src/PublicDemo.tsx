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
  type ConversionIntent,
  type InteractionTurn,
  type ShellState,
} from "@factorylm/interaction";
import { FactoryLMShell, MachineView, useSimLabDemo } from "@factorylm/ui";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { createLabAdapter } from "./fake-adapter";

const DEFAULT_APP_ORIGIN = "https://app.factorylm.com";

export interface PublicDemoConfig {
  readonly simlabUrl: string;
  readonly hubUrl: string;
  readonly notebookId?: string;
  /** Where Create workspace / Sign in send the visitor. */
  readonly appOrigin: string;
}

export const DEFAULT_DEMO_CONFIG: PublicDemoConfig = {
  simlabUrl: "http://127.0.0.1:8099",
  hubUrl: "http://127.0.0.1:3000",
  appOrigin: DEFAULT_APP_ORIGIN,
};

export function parseDemoConfig(search: string): PublicDemoConfig {
  const params = new URLSearchParams(search);
  const notebookId = params.get("notebook") ?? undefined;
  return {
    simlabUrl: params.get("simlab") ?? DEFAULT_DEMO_CONFIG.simlabUrl,
    hubUrl: params.get("hub") ?? DEFAULT_DEMO_CONFIG.hubUrl,
    appOrigin: params.get("app") ?? DEFAULT_DEMO_CONFIG.appOrigin,
    ...(notebookId ? { notebookId } : {}),
  };
}

/**
 * The doors this host can open, in the order the visitor should read them.
 *
 * First is primary (the stylesheet marks it). "Create workspace" leads because
 * the visitor asking a question in a preview is, almost always, someone who has
 * equipment of their own — not someone who already has an account and is
 * signed out.
 *
 * `try-your-equipment` is deliberately absent HERE. It is the attachment menu's
 * door (a visitor reaching for a file), and repeating it on a question the
 * route declined would offer three ways to do one thing.
 */
export const ASK_CONVERSION_INTENTS: readonly ConversionIntent[] = ["create-workspace", "sign-in"];

/**
 * Build the assistant turn for a chat result — answer, invitation, or error.
 *
 * Three outcomes, and the difference between the last two is the whole point:
 *
 * - `ok`            — the real route answered. Its parts, its lifecycle.
 * - `gate: account` — the route worked and declined an anonymous turn. That is
 *                     not a failure, so it is NOT an error part and NOT a
 *                     `failed` lifecycle. The turn COMPLETED: MIRA said what it
 *                     would need, and the visitor is shown the door.
 * - `gate: fault`   — something is actually broken. Error part, `failed`
 *                     lifecycle, retry offered if the host provides one.
 *
 * Collapsing the middle case into the last is the tempting shortcut and the one
 * to refuse: a red "MIRA could not answer" at the moment of highest intent
 * teaches the visitor the product is broken, when what actually happened is
 * that they do not have an account yet.
 *
 * Nothing is invented in either case. No canned answer, no sample diagnosis.
 */
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

  if (result.gate === "account") {
    return {
      ...base,
      parts: [
        { type: "conversion_prompt", prompt: { reason: result.message, intents: ASK_CONVERSION_INTENTS } },
        { type: "status", status: "completed" },
      ],
      lifecycle: "completed",
    };
  }

  // A real fault: the reason, rendered as the error it is. Never dressed up as
  // a sign-up prompt — that would mislead the visitor AND hide the bug.
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

/**
 * Bring the newest turn on screen once the answer (or the invitation) lands.
 *
 * The shell sets `.fl-shell { min-block-size: 100dvh }` — a MINIMUM, not a
 * height — so when the machine panel makes the content taller than the viewport
 * the PAGE scrolls, and `.fl-conversation`'s own `overflow-y: auto` never
 * engages. Measured in the browser: with the jam injected, the document is
 * 1170px tall in a 915px mobile viewport and the conversion prompt's buttons
 * sit at y≈1003 — below the fold, on the one turn where the visitor is being
 * asked to act. After this, they sit at y≈748.
 *
 * The host owns the page, so the host scrolls it. This deliberately does NOT
 * reach into shell internals to find a turn element; the shared fix (bound the
 * shell's height so the conversation is the scroller, and keep the newest turn
 * pinned) belongs to the shell owner and is recorded in the handoff.
 *
 * A no-op when the page already fits — scrolling a page that does not scroll is
 * how a "helpful" jump becomes a flicker.
 */
export function revealNewestTurn(): void {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") return;
  window.requestAnimationFrame(() => {
    const page = document.scrollingElement ?? document.body;
    if (!page || page.scrollHeight <= page.clientHeight) return;
    window.scrollTo({ top: page.scrollHeight, behavior: "smooth" });
  });
}

/**
 * Where a conversion actually sends the visitor.
 *
 * The demo deliberately cannot answer an anonymous question (the shared chat
 * route begins with `sessionOr401`), so these buttons are the ONLY exit from
 * the funnel — a CTA that records an intent and goes nowhere is the failure
 * this map exists to prevent.
 *
 * `/login` and `/signup` are the Hub's real pages and are already the two links
 * `mira-web` uses elsewhere, so this adds no new contract.
 *
 * Overridable via `?app=` for local verification against a dev Hub; the default
 * is production because that is where a factorylm.com visitor must land.
 */

export function conversionDestination(intent: ConversionIntent, appOrigin: string): string {
  const base = appOrigin.replace(/\/+$/, "");
  switch (intent) {
    case "sign-in":
      return `${base}/login`;
    case "create-workspace":
    case "try-your-equipment":
      // Both mean "I have equipment of my own" — that starts with an account.
      return `${base}/signup`;
  }
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

  /**
   * On a narrow viewport the visitor must land on the machine, not on a drawer.
   *
   * `createShellState` opens navigation for every surface, and shell.css turns
   * the sidebar into a fixed overlay below 48rem regardless of surface — so a
   * public demo on a phone opens with the nav covering the whole page. The
   * browser proof failed on exactly that: the Inject control was visible and
   * enabled but the drawer intercepted every click.
   *
   * Closing it here is a HOST decision and touches no shell semantics. The
   * underlying mismatch is wider than this demo — `navigationIsLayer` keys on
   * `profile.kind === "mobile"` while the stylesheet keys on viewport width, so
   * a narrow `public`/`web`/`hub` surface gets a drawer with no scrim and no
   * Escape-to-close. That belongs to the shell owner; see HANDOFF.md.
   */
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    if (window.matchMedia("(max-width: 48rem)").matches) {
      dispatch({ type: "set-navigation-visible", visible: false });
    }
  }, []);

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
      .finally(() => {
        setAsking(false);
        revealNewestTurn();
      });
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
      onConvert: (intent) => {
        setConversions((seen) => [...seen, intent]);
        // The handoff. The demo cannot answer an anonymous question by design,
        // so this navigation IS the funnel's exit — not an analytics event.
        if (typeof window !== "undefined") {
          window.location.assign(conversionDestination(intent, config.appOrigin));
        }
      },
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
