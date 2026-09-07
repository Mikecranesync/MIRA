import "@factorylm/theme/workspace.css";
import "@factorylm/ui/conversation.css";
import "./unified.css";
import { useState } from "react";
import { useOtaUpdates } from "../api/use-ota-updates";

function resultCopy(reason: string): string {
  switch (reason) {
    case "staged":
      return "Update downloaded and verified.";
    case "no_update":
      return "Up to date.";
    case "busy":
      return "Skipped — you have work that has not finished syncing.";
    case "restart_failed":
      return "Could not restart the app. The staged update is still waiting.";
    case "incompatible_native":
      return "An update exists but needs a newer app version. Install the new app to get it.";
    case "unsigned":
      return "Refused — the update was not properly signed.";
    case "not_https":
      return "Refused — insecure download location.";
    case "verify_failed":
      return "Refused — the update failed its integrity check. Nothing changed.";
    case "invalid_manifest_origin":
      return "Refused — update source is not FactoryLM.";
    case "channel_mismatch":
      return "Refused — update channel does not match this device.";
    case "invalid_pointer_timestamp":
    case "invalid_pointer_signature":
      return "Refused — update authorization could not be verified.";
    case "invalid_packaged_minimum":
      return "This app cannot verify update age. Install a newer app.";
    case "stale_pointer":
      return "Refused — update is older than this app.";
    case "replayed_pointer":
      return "Refused — update is older than this device's trusted history.";
    case "pointer_state_unavailable":
      return "Could not safely save update history. Restart the app before checking again.";
    case "pointer_state_invalid":
      return "Update history is invalid. Install a fresh app before updating.";
    case "pending_bundle_state_unavailable":
      return "Could not verify the pending update state. Restart the app before changing channels.";
    case "channel_state_unavailable":
      return "Could not verify this device's update channel. Restart the app before checking for updates.";
    case "check_failed":
      return "Could not check for updates. The app is unaffected.";
    case "recovery_failed":
      return "Could not recover the packaged version. Nothing changed.";
    case "bundle_state_unavailable":
      return "Could not safely inspect downloaded updates. Nothing changed.";
    case "bundle_cleanup_failed":
      return "Could not safely prepare the update. Restart the app and try again.";
    case "unreachable":
      return "Could not reach the update server. The app is unaffected.";
    case "not_native":
      return "Updates only apply to the installed app.";
    case "recovered_to_packaged":
      return "Recovered to the packaged version. Restart to apply.";
    case "already_packaged":
      return "This app is already using the packaged version.";
    default:
      return reason.startsWith("server_")
        ? `Update server error (${reason.slice(7)}).`
        : reason;
  }
}

export function UnifiedAboutUpdates({
  pendingOfflineWork,
  onBack,
}: {
  pendingOfflineWork: () => Promise<boolean>;
  onBack: () => void;
}) {
  const updates = useOtaUpdates(pendingOfflineWork);
  const [channelMessage, setChannelMessage] = useState<string | null>(null);

  const enrollCanary = async () => {
    if (
      !window.confirm(
        "Canary updates are early builds for testing and may be less stable. Enroll this device?",
      )
    ) {
      return;
    }
    try {
      const result = await updates.changeChannel("canary");
      if (result === "unchanged") {
        setChannelMessage("Could not save canary enrollment. This device remains on production.");
        return;
      }
      if (result === "channel_state_unavailable") {
        setChannelMessage(null);
        return;
      }
      if (result === "pointer_state_unavailable") {
        setChannelMessage(null);
        return;
      }
      if (result === "busy") {
        setChannelMessage("Wait for the current update action to finish.");
        return;
      }
      if (result !== "changed") {
        setChannelMessage("Restart or recover the staged update before changing channels.");
        return;
      }
      setChannelMessage("This device is enrolled in canary updates.");
    } catch {
      setChannelMessage("Could not save canary enrollment. This device remains on production.");
    }
  };

  const leaveCanary = async () => {
    try {
      const result = await updates.changeChannel("production");
      if (result === "unchanged") {
        setChannelMessage("Could not leave canary updates. This device remains on canary.");
        return;
      }
      if (result === "channel_state_unavailable") {
        setChannelMessage(null);
        return;
      }
      if (result === "pointer_state_unavailable") {
        setChannelMessage(null);
        return;
      }
      if (result === "busy") {
        setChannelMessage("Wait for the current update action to finish.");
        return;
      }
      if (result !== "changed") {
        setChannelMessage("Restart or recover the staged update before changing channels.");
        return;
      }
      setChannelMessage("This device now receives production updates.");
    } catch {
      setChannelMessage("Could not change the update channel.");
    }
  };

  const appVersion = updates.appInfo === undefined
    ? "loading…"
    : updates.appInfo
      ? `${updates.appInfo.version} (${updates.appInfo.build})`
      : updates.platform === "web"
        ? "web preview"
        : "unavailable";
  const activeBundle = updates.bundleId === undefined
    ? "loading…"
    : updates.bundleId ?? "unavailable";
  const updateChannel = updates.channel === undefined
    ? "loading…"
    : updates.channel ?? "unavailable";

  return (
    <div className="unified-root unified-updates" data-testid="unified-about-updates">
      <header className="unified-updates__header">
        <button type="button" className="unified-updates__back" onClick={onBack}>
          <span aria-hidden="true">←</span> Back
        </button>
        <div>
          <p className="fl-card__label">FactoryLM mobile</p>
          <h1>About &amp; updates</h1>
        </div>
      </header>

      <main className="unified-updates__content">
        <section className="fl-card" aria-labelledby="unified-app-heading">
          <p className="fl-card__label">Installed app</p>
          <h2 id="unified-app-heading">This device</h2>
          <dl className="fl-card__facts">
            <div><dt>App version</dt><dd>{appVersion}</dd></div>
            {updates.appInfo ? <div><dt>Package</dt><dd>{updates.appInfo.id}</dd></div> : null}
            <div><dt>Platform</dt><dd>{updates.platform}</dd></div>
            <div><dt>Native fingerprint</dt><dd>{updates.nativeFingerprint}</dd></div>
          </dl>
        </section>

        <section className="fl-card" aria-labelledby="unified-bundle-heading">
          <p className="fl-card__label">Over-the-air delivery</p>
          <h2 id="unified-bundle-heading">Update bundle</h2>
          <dl className="fl-card__facts">
            <div><dt>Active bundle</dt><dd>{activeBundle}</dd></div>
            <div><dt>Channel</dt><dd>{updateChannel}</dd></div>
            <div>
              <dt>Last checked</dt>
              <dd>{updates.lastCheckedAt?.toLocaleString() ?? "not yet"}</dd>
            </div>
          </dl>

          <div className="fl-card__actions unified-updates__actions">
            <button
              type="button"
              className="unified-updates__primary"
              disabled={
                updates.busy ||
                !updates.channel ||
                !updates.pendingBundleKnown ||
                !updates.replayStateKnown ||
                Boolean(updates.stagedBundleId)
              }
              onClick={() => void updates.checkNow()}
            >
              {updates.busy ? "Checking…" : "Check now"}
            </button>
            {updates.channel === "production" ? (
              <button
                type="button"
                disabled={
                  updates.busy ||
                  !updates.pendingBundleKnown ||
                  !updates.replayStateKnown ||
                  Boolean(updates.stagedBundleId)
                }
                onClick={() => void enrollCanary()}
              >
                Enroll in canary updates
              </button>
            ) : null}
            {updates.channel === "canary" ? (
              <button
                type="button"
                disabled={
                  updates.busy ||
                  !updates.pendingBundleKnown ||
                  !updates.replayStateKnown ||
                  Boolean(updates.stagedBundleId)
                }
                onClick={() => void leaveCanary()}
              >
                Return to production updates
              </button>
            ) : null}
          </div>

          {updates.stagedBundleId ? (
            <p className="fl-card__meta">
              Restart or recover the staged update before changing channels.
            </p>
          ) : null}
          {channelMessage ? <p className="fl-card__meta" role="status">{channelMessage}</p> : null}
          {updates.statusCode ? (
            <p className="unified-updates__result" role="status">
              {resultCopy(updates.statusCode)}
            </p>
          ) : null}
          {updates.stagedBundleId ? (
            <div className="unified-updates__ready" role="status">
              <div>
                <strong>Update ready</strong>
                <p>
                  {updates.stagedBundleId === "packaged"
                    ? "Restart to return to the packaged version."
                    : `Restart to switch to bundle ${updates.stagedBundleId}.`}
                </p>
              </div>
              <button
                type="button"
                className="unified-updates__primary"
                disabled={updates.busy}
                onClick={() => void updates.restartToApply()}
              >
                Restart to finish updating
              </button>
            </div>
          ) : null}
        </section>

        <section className="fl-card" aria-labelledby="unified-recovery-heading">
          <p className="fl-card__label">Safe fallback</p>
          <h2 id="unified-recovery-heading">Recovery</h2>
          <p className="fl-card__meta">
            Return to the version shipped inside the app if an update made something worse.
          </p>
          <div className="fl-card__actions unified-updates__actions">
            <button
              type="button"
              disabled={updates.busy}
              onClick={() => void updates.recoverPackagedBundle()}
            >
              Recover packaged version
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
