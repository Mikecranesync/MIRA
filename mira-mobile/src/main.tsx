import React from "react";
import { createRoot } from "react-dom/client";
import { App as CapApp } from "@capacitor/app";
import App, { handleDeepLink } from "./App";
import "./app.css";

// Deep links (factorylm://m/<TAG> and https://app.factorylm.com/m/<TAG>).
// Registered BEFORE first render so a cold-start URL is not missed.
void CapApp.addListener("appUrlOpen", ({ url }) => handleDeepLink(url));
void CapApp.getLaunchUrl().then((l) => {
  if (l?.url) handleDeepLink(l.url);
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
