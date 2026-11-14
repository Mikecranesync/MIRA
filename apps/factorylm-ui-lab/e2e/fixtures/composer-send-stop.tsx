import "@factorylm/theme/workspace.css";
import "@factorylm/ui/shell.css";
import "@factorylm/ui/conversation.css";
import { useEffect, useReducer } from "react";
import { createRoot } from "react-dom/client";
import { createShellState, getFixture, PROFILES, shellReducer, type ShellFixture } from "@factorylm/interaction";
import { FactoryLMShell } from "../../../../packages/factorylm-ui/src/FactoryLMShell";
import { fakeAdapter } from "../../../../packages/factorylm-ui/src/__tests__/harness";

// Visual proof for #4924 / #4798 / stopped Retry. Query:
//   scene=busy-draft|queued|stopped|stopped-no-retry
//   profile=hub|mobile
const params = new URLSearchParams(location.search);
const scene = params.get("scene") ?? "busy-draft";
const profile = params.get("profile") === "hub" ? "hub" : "mobile";

function stoppedFixture(retryable: boolean): ShellFixture {
  const base = getFixture("error-retry");
  const assistant = base.thread.turns[0];
  return {
    ...base,
    offline: { state: "online", pendingChanges: 0 },
    thread: {
      ...base.thread,
      turns: [
        {
          ...assistant,
          id: "turn-stopped-q",
          role: "user",
          lifecycle: "completed",
          parts: [{ type: "text", text: "what does fault F004 mean" }],
        },
        {
          ...assistant,
          id: "turn-stopped-a",
          lifecycle: "stopped",
          parts: [
            { type: "text", text: "Check the drive supply and the braking resistor before—" },
            { type: "error", error: { code: "stopped", message: "Stopped before the answer completed.", retryable } },
          ],
        },
      ],
    },
  };
}

function App() {
  const fixture = scene === "stopped" || scene === "stopped-no-retry"
    ? stoppedFixture(scene === "stopped")
    : getFixture("grounded-answer");
  const [state, dispatch] = useReducer(shellReducer, createShellState(fixture, PROFILES[profile]));
  useEffect(() => {
    if (scene === "busy-draft" || scene === "queued") {
      dispatch({ type: "set-draft", draft: "and what happens on a comm fault" });
    }
  }, []);
  const busy = scene === "busy-draft" || scene === "queued";
  return <FactoryLMShell
    state={state}
    dispatch={dispatch}
    adapter={fakeAdapter()}
    hooks={{ busy, onSend: () => {}, onStop: () => {}, onRetry: () => {} }}
  />;
}

createRoot(document.getElementById("root")!).render(<App />);
