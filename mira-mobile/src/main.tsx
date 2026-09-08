import React from "react";
import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import App, { handleDeepLink } from "./App";
import {
  confirmBundleReady,
  readBundleRestartState,
  recoverToPackaged,
} from "./lib/live-update";
import { installResumeGuard } from "./lib/resume-guard";
import "./app.css";

type BundleBootBoundaryState = {
  failed: boolean;
  recovering: boolean;
  recoveryFailed: boolean;
  recoveryPrepared: boolean;
  restartFailed: boolean;
};

class BundleBootBoundary extends React.Component<
  React.PropsWithChildren,
  BundleBootBoundaryState
> {
  state: BundleBootBoundaryState = {
    failed: false,
    recovering: false,
    recoveryFailed: false,
    recoveryPrepared: false,
    restartFailed: false,
  };

  static getDerivedStateFromError(): BundleBootBoundaryState {
    return {
      failed: true,
      recovering: false,
      recoveryFailed: false,
      recoveryPrepared: false,
      restartFailed: false,
    };
  }

  componentDidCatch(error: unknown): void {
    console.error("[boot] candidate bundle render failed", error);
  }

  private recoverAndRestart = async (): Promise<void> => {
    if (this.state.recovering) return;
    this.setState({ recovering: true, recoveryFailed: false, restartFailed: false });

    let recoveryPrepared = this.state.recoveryPrepared;
    if (!recoveryPrepared) {
      try {
        await recoverToPackaged();
        recoveryPrepared = true;
      } catch (resetError) {
        // Native reset can commit before the bridge loses its response. Only a
        // strict reread proving that packaged is the next target may advance to
        // restart; an unreadable or still-selected candidate fails closed.
        try {
          const restartState = await readBundleRestartState();
          recoveryPrepared = restartState.pendingBundleId === null;
        } catch (stateError) {
          console.error("[boot] packaged recovery outcome unavailable", resetError, stateError);
        }
        if (!recoveryPrepared) {
          console.error("[boot] packaged recovery was not prepared", resetError);
          this.setState({ recovering: false, recoveryFailed: true });
          return;
        }
      }
      this.setState({ recoveryPrepared: true });
    }

    try {
      await CapApp.exitApp();
    } catch (error) {
      console.error("[boot] packaged recovery restart failed", error);
      this.setState({ recovering: false, recoveryPrepared: true, restartFailed: true });
    }
  };

  render() {
    if (this.state.failed) {
      return (
        <main className="empty" role="alert">
          <h1>FactoryLM could not start</h1>
          <p>
            Recover the version packaged with the app, then reopen FactoryLM.
          </p>
          <button
            type="button"
            disabled={this.state.recovering}
            onClick={() => void this.recoverAndRestart()}
          >
            {this.state.recovering
              ? this.state.recoveryPrepared
                ? "Restarting FactoryLM…"
                : "Preparing packaged recovery…"
              : this.state.recoveryPrepared
                ? "Restart FactoryLM"
                : "Recover packaged version and restart"}
          </button>
          {this.state.recoveryFailed ? (
            <p>Recovery could not be prepared. Keep the app open and try again.</p>
          ) : null}
          {this.state.restartFailed ? (
            <p>Packaged recovery is ready. Close and reopen FactoryLM to finish.</p>
          ) : null}
        </main>
      );
    }
    return this.props.children;
  }
}

// Dev-browser preview only: in a wide desktop window, render the app inside a
// centered phone-sized frame (see body.web-preview rules in app.css) so the
// full app is always visible without DevTools device mode. Native is untouched.
if (!Capacitor.isNativePlatform()) document.body.classList.add("web-preview");

// Deep links (factorylm://m/<TAG> and https://app.factorylm.com/m/<TAG>).
// Registered BEFORE first render so a cold-start URL is not missed.
// Blank-white-screen recovery after background/picker round-trips (#3392).
installResumeGuard();

void CapApp.addListener("appUrlOpen", ({ url }) => handleDeepLink(url));
void CapApp.getLaunchUrl().then((l) => {
  if (l?.url) handleDeepLink(l.url);
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BundleBootBoundary>
      <App onBundleReady={confirmBundleReady} />
    </BundleBootBoundary>
  </React.StrictMode>,
);
