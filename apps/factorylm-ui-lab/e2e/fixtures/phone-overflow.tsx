import "@factorylm/theme/workspace.css";
import "@factorylm/ui/shell.css";
import "@factorylm/ui/conversation.css";
import { useReducer } from "react";
import { createRoot } from "react-dom/client";
import { createShellState, getFixture, PROFILES, shellReducer } from "@factorylm/interaction";
import { FactoryLMShell } from "../../../../packages/factorylm-ui/src/FactoryLMShell";
import { fakeAdapter } from "../../../../packages/factorylm-ui/src/__tests__/harness";

// #5068: the real Siemens URL from the Pixel walk, as one unbreakable token in both the
// "possible manual" status line (server copy) and an answer's text.
const URL_TOKEN = "https://support.industry.siemens.com/cs/attachments/109485603/hmi_comfort_panels_outdoor_operating_instructions_s_es-ES.pdf";
const base = getFixture("grounded-answer");
const params = new URLSearchParams(location.search);
const template = base.thread.turns[0];
const turns = [
  { ...template, id: "q", role: "user" as const, parts: [{ type: "text" as const, text: "what supply voltage does the TP700 Comfort need" }] },
  { ...template, id: "a", role: "assistant" as const, parts: [
    { type: "text" as const, text: `The manual link is ${URL_TOKEN} if you want to check it yourself.` },
    { type: "manual_search_status" as const, manufacturer: "Siemens", model: "TP700 Comfort", running: false, manualUrl: URL_TOKEN,
      message: `I found a possible manual for the Siemens TP700 Comfort, but couldn't download it. Open this website: ${URL_TOKEN}. If it is the right manual, download it and upload it to this notebook so I can answer with page citations.` },
  ] },
];
function App() {
  const [state, dispatch] = useReducer(shellReducer, createShellState({ ...base, thread: { ...base.thread, turns } }, PROFILES.mobile));
  return <FactoryLMShell state={state} dispatch={dispatch} adapter={fakeAdapter()} conversationSurface={params.get("renderer") === "assistant" ? "assistant" : "classic"} />;
}
createRoot(document.getElementById("root")!).render(<App />);
