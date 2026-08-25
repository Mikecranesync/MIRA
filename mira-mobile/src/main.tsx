import React from "react";
import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import App, { handleDeepLink } from "./App";
import { confirmBundleReady } from "./lib/live-update";
import "./app.css";

// OTA rollback confirmation — FIRST, before deep links, before any API call.
// This is the signal that says "this bundle booted". If a bad bundle never
// reaches it, the native layer restores the previous working bundle on the next
// launch; the packaged APK bundle is the permanent floor. Anything placed ahead
// of it can fail on a bad bundle and turn a recoverable rollback into a phone
// that boots to nothing. See ADR-0034 amendment + lib/live-update.ts.
void confirmBundleReady();

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
