import "@factorylm/theme/workspace.css";
import "@factorylm/ui/shell.css";
import "@factorylm/ui/conversation.css";
import { useReducer } from "react";
import { createRoot } from "react-dom/client";
import { createShellState, getFixture, PROFILES, shellReducer } from "@factorylm/interaction";
import { FactoryLMShell } from "../../../../packages/factorylm-ui/src/FactoryLMShell";
import { fakeAdapter } from "../../../../packages/factorylm-ui/src/__tests__/harness";
const base = getFixture("grounded-answer");
const params = new URLSearchParams(location.search);
if (params.get("nested") === "true") document.body.classList.add("nested");
let serial = 0;
const makeTurn = (role: "user" | "assistant", text: string) => ({ ...base.thread.turns[0], id: `proof-${serial++}`, role, parts: [{ type: "text" as const, text }] });
function App() {
  const [state, dispatch] = useReducer(shellReducer, createShellState({ ...base, thread: { ...base.thread, turns: Array.from({ length: 16 }, (_, i) => makeTurn(i % 2 ? "assistant" : "user", `Turn ${i}. ` + "Diagnostic context and safe observation. ".repeat(18))) } }, PROFILES.web));
  (window as any).proof = {
    append: () => dispatch({ type: "hydrate", data: { thread: { ...state.thread, turns: [...state.thread.turns, makeTurn("user", "New question"), makeTurn("assistant", "Answer starts here.")] } } }),
    grow: () => dispatch({ type: "hydrate", data: { thread: { ...state.thread, turns: state.thread.turns.map((turn, index) => index === state.thread.turns.length - 1 ? { ...turn, parts: [{ type: "text", text: (turn.parts[0] as any).text + " Continued answer details. ".repeat(25) }] } : turn) } } }),
    persist: () => dispatch({ type: "hydrate", data: { thread: { ...state.thread, turns: state.thread.turns.map((turn, index) => index >= state.thread.turns.length - 2 ? { ...turn, id: `persisted-${turn.id}` } : turn) } } }),
    switch: () => dispatch({ type: "hydrate", data: { thread: { ...state.thread, id: `thread-${serial++}` } } }),
  };
  return <FactoryLMShell state={state} dispatch={dispatch} adapter={fakeAdapter()} conversationSurface={params.get("renderer") === "assistant" ? "assistant" : "classic"} />;
}
createRoot(document.getElementById("root")!).render(<App />);
