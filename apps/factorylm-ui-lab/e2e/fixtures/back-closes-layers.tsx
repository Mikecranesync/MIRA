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
  const [state, dispatch] = useReducer(shellReducer, createShellState(getFixture("grounded-answer"), PROFILES.mobile));
  useBackClosesLayers(state);
  return <FactoryLMShell state={state} dispatch={dispatch} adapter={fakeAdapter()} />;
}
createRoot(document.getElementById("root")!).render(<App />);
