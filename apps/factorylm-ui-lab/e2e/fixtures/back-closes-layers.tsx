import "@factorylm/theme/workspace.css";
import "@factorylm/ui/shell.css";
import "@factorylm/ui/conversation.css";
import { useReducer } from "react";
import { createRoot } from "react-dom/client";
import { createShellState, getFixture, PROFILES, shellReducer } from "@factorylm/interaction";
import { FactoryLMShell } from "../../../../packages/factorylm-ui/src/FactoryLMShell";
import { fakeAdapter } from "../../../../packages/factorylm-ui/src/__tests__/harness";
import { useBackClosesLayers } from "../../../../mira-hub/src/factorylm-ui/back-closes-layers";

// Excluded from the lab typecheck (tsconfig.json): it imports the Hub hook, whose packages resolve
// only through mira-hub. Bun bundles it at run time. #5069: the Hub's web Back wiring on the phone profile (drawer open at mount), in a real browser.
function App() {
  const params = new URLSearchParams(window.location.search);
  const original = getFixture("grounded-answer");
  const fixture = params.get("document") === "1" ? {
    ...original,
    thread: { ...original.thread, turns: original.thread.turns.map((turn) => ({
      ...turn,
      parts: turn.parts.map((part) => part.type === "source"
        ? { ...part, source: { ...part.source, href: "https://example.test/manual.pdf#page=42" } }
        : part),
    })) },
  } : original;
  const profile = params.get("surface") === "hub" ? PROFILES.hub : PROFILES.mobile;
  const conversationSurface = params.get("thread") === "assistant" ? "assistant" : "classic";
  const [state, dispatch] = useReducer(shellReducer, createShellState(fixture, profile));
  useBackClosesLayers(state);
  return <FactoryLMShell state={state} dispatch={dispatch} adapter={fakeAdapter()} conversationSurface={conversationSurface} />;
}
createRoot(document.getElementById("root")!).render(<App />);
