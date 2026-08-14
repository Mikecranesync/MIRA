import React from "react";
import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import App, { handleDeepLink } from "./App";
import "./app.css";

// Dev-browser preview only: in a wide desktop window, render the app inside a
// centered phone-sized frame (see body.web-preview rules in app.css) so the
// full app is always visible without DevTools device mode. Native is untouched.
if (!Capacitor.isNativePlatform()) document.body.classList.add("web-preview");

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
