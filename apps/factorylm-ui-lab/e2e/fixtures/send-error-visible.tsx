import "@factorylm/theme/workspace.css";
import "@factorylm/ui/shell.css";
import "@factorylm/ui/conversation.css";
import { useEffect, useReducer } from "react";
import { createRoot } from "react-dom/client";
import { createShellState, getFixture, PROFILES, shellReducer } from "@factorylm/interaction";
import { FactoryLMShell } from "../../../../packages/factorylm-ui/src/FactoryLMShell";
import { fakeAdapter } from "../../../../packages/factorylm-ui/src/__tests__/harness";
// #5572: a refused Send shows the target-review banner; it must sit above the
// composer and inside the viewport, not under the sticky composer.
const REVIEW = "This question was asked about the whole machine. The question target is now VFD1. Check it, then press Send to ask again.";
const base = getFixture("grounded-answer");
const params = new URLSearchParams(location.search);
// A long thread, as on the device: the shell grows past the viewport and the page scrolls.
const turns = Array.from({ length: 16 }, (_, i) => ({ ...base.thread.turns[0], id: `proof-${i}`, role: (i % 2 ? "assistant" : "user") as "user" | "assistant", parts: [{ type: "text" as const, text: `Turn ${i}. ` + "Diagnostic context and safe observation. ".repeat(18) }] }));
function App() {
  const [state, dispatch] = useReducer(shellReducer, createShellState({ ...base, thread: { ...base.thread, turns } }, PROFILES.web));
  useEffect(() => { dispatch({ type: "set-send-error", error: REVIEW }); }, []);
  // Grow the latest turn while the banner stays up (a streamed answer).
  (window as any).proof = {
    grow: () => dispatch({ type: "hydrate", data: { thread: { ...state.thread, turns: state.thread.turns.map((t, i) => i === state.thread.turns.length - 1 ? { ...t, parts: [{ type: "text" as const, text: (t.parts[0] as any).text + " Continued answer details. ".repeat(25) }] } : t) } } }),
  };
  return <FactoryLMShell state={state} dispatch={dispatch} adapter={fakeAdapter()} hooks={{ targetReview: REVIEW, onSend: () => undefined }} conversationSurface={params.get("renderer") === "assistant" ? "assistant" : "classic"} />;
}
createRoot(document.getElementById("root")!).render(<App />);
