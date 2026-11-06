/** Test harness for the actual product shell/footer/walkthrough. Not a second product app. */
import React, { useReducer, useState } from "react";
import { createRoot } from "react-dom/client";
import { createShellState, getFixture, PROFILES, shellReducer } from "@factorylm/interaction";
import { Sidebar } from "@factorylm/ui/Sidebar";
import { HubAccountFooter } from "../../../mira-hub/src/factorylm-ui/HubAccountFooter";
import { CV101Walkthrough } from "../../../mira-hub/src/factorylm-ui/CV101Walkthrough";
import type { PracticeStorageProvider } from "../../../mira-hub/src/factorylm-ui/cv101-walkthrough-model";
import "../../../packages/factorylm-theme/src/tokens.css";
import "../../../packages/factorylm-ui/src/shell.css";
import "../../../packages/factorylm-ui/src/conversation.css";

function Preview() {
  const [state, dispatch] = useReducer(shellReducer, undefined, () => createShellState(getFixture("general-ask"), PROFILES.hub));
  const params = new URLSearchParams(window.location.search), mode = params.get("storage");
  const viewer = params.get("viewer") === "B" ? "cv101-practice-b@example.invalid" : "cv101-practice@example.invalid";
  const [negativeOpen, setNegativeOpen] = useState(mode === "denied" || mode === "corrupt");
  const fixtureStorage: PracticeStorageProvider = () => ({ getItem: () => { if (mode === "corrupt") return "{synthetic-corrupt-record"; throw new Error("Synthetic storage denial"); }, setItem: () => { throw new Error("Synthetic unavailable storage"); } });
  return <><div style={{ padding: "var(--fl-gap)", font: "var(--fl-fs-sm) var(--fl-font)", background: "var(--fl-warn-bg)", color: "var(--fl-ink)" }}>COMPONENT TEST PREVIEW · simulated session · actual product navigation/footer/walkthrough · no authentication, provider, equipment or Atlas connection{mode ? ` · synthetic storage fixture: ${mode}` : ""}</div><div className="fl-shell" data-surface="hub" data-navigation-visible={state.navigationVisible}><Sidebar state={state} dispatch={dispatch} footer={<HubAccountFooter email={viewer} signingOut={false} onSignOut={() => {}} />} /><main style={{ padding: "var(--fl-pad)" }}><h1>CV-101 component preview</h1><p>Open CV-101 walkthrough in the existing navigation footer.</p><button onClick={() => dispatch({ type: "set-navigation-visible", visible: true })}>Open navigation (preview control)</button><p>This is an isolated component test, not an authenticated product session. The actual Hub mounts the same footer through HubShellHost.</p></main></div>{negativeOpen && <CV101Walkthrough viewerScope={viewer} storage={fixtureStorage} onClose={() => setNegativeOpen(false)} />}</>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
