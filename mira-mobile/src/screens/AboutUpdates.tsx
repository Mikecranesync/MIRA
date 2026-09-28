// Settings → About & Updates.
//
// This screen exists to answer one question a technician (or Mike, debugging
// remotely) will actually ask: "what is this phone running right now?" Native
// version and OTA bundle are DIFFERENT things that both move, and a screen that
// showed only one of them would be the reason a fix "did not arrive" is
// impossible to diagnose over the phone.
//
// It never applies an update silently. A staged bundle is announced with an
// explicit Restart action, because swapping the app out from under someone
// mid-diagnosis is a worse defect than whatever the update fixed.
import { useOtaUpdates } from "../api/use-ota-updates";

type Row = { label: string; value: string };

export function AboutUpdates({
  pendingOfflineWork,
  onBack,
}: {
  pendingOfflineWork: () => Promise<boolean>;
  onBack: () => void;
}) {
  const updates = useOtaUpdates(pendingOfflineWork);
  const native: Row[] = updates.appInfo === undefined
    ? []
    : [
        {
          label: "App version",
          value: updates.appInfo
            ? `${updates.appInfo.version} (${updates.appInfo.build})`
            : updates.platform === "web"
              ? "web preview"
              : "unavailable",
        },
        ...(updates.appInfo ? [{ label: "Package", value: updates.appInfo.id }] : []),
        { label: "Platform", value: updates.platform },
        // This decides whether an OTA bundle is compatible with the installed shell.
        { label: "Native fingerprint", value: updates.nativeFingerprint },
      ];

  return (
    <div className="content bottompad">
      <button className="btn-link" onClick={onBack}>
        ← More
      </button>
      <h3>About &amp; updates</h3>

      <div className="card">
        <h3>This app</h3>
        {native.map((r) => (
          <div className="meta" key={r.label}>
            {r.label}: <strong>{r.value}</strong>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Update bundle</h3>
        <div className="meta">
          Active bundle:{" "}
          <strong>
            {updates.bundleId === undefined ? "loading…" : updates.bundleId ?? "unavailable"}
          </strong>
          {updates.bundleId === "packaged" && " (shipped with the app)"}
        </div>
        <div className="meta">
          Channel:{" "}
          <strong>
            {updates.channel === undefined ? "loading…" : updates.channel ?? "unavailable"}
          </strong>
        </div>
        <div className="meta">
          Last checked: {updates.lastCheckedAt?.toLocaleString() ?? "not yet"}
        </div>
        {updates.statusCode && <div className="meta">Result: {explain(updates.statusCode)}</div>}

        {updates.stagedBundleId && (
          <>
            <div className="warnbox" style={{ marginTop: 10 }}>
              Update ready. It will be applied the next time the app starts.
            </div>
            <button
              className="btn-primary"
              disabled={updates.busy}
              onClick={() => void updates.restartToApply()}
            >
              Restart to finish updating
            </button>
          </>
        )}

        <button
          style={{ marginTop: 8 }}
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
      </div>

      <div className="card">
        <h3>Recovery</h3>
        <div className="meta">
          Returns to the version that shipped inside the app. Use this if an update made
          something worse — the packaged version is always available.
        </div>
        <button
          style={{ marginTop: 8 }}
          disabled={updates.busy}
          onClick={() => void updates.recoverPackagedBundle()}
        >
          Recover to packaged version
        </button>
      </div>
    </div>
  );
}

/**
 * Reason codes → something a technician can act on.
 *
 * Each of these corresponds to a refusal in lib/live-update.ts. They are worth
 * surfacing verbatim rather than collapsing into "failed": "incompatible" and
 * "could not verify" mean very different things, and the second one matters.
 */
function explain(reason: string): string {
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
    case "recovered_to_packaged":
      return "Recovered to the packaged version. Restart to apply.";
    case "already_packaged":
      return "This app is already using the packaged version.";
    case "unreachable":
      return "Could not reach the update server. The app is unaffected.";
    case "not_native":
      return "Updates only apply to the installed app.";
    default:
      return reason.startsWith("server_") ? `Update server error (${reason.slice(7)}).` : reason;
  }
}
