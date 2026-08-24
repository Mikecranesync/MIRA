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
import { useEffect, useState } from "react";
import { App as CapApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import {
  NATIVE_FINGERPRINT,
  checkAndStage,
  currentBundleId,
  recoverToPackaged,
  type OtaChannel,
} from "../lib/live-update";

type Row = { label: string; value: string };

export function AboutUpdates({
  pendingOfflineWork,
  onBack,
}: {
  pendingOfflineWork: () => Promise<boolean>;
  onBack: () => void;
}) {
  const [native, setNative] = useState<Row[]>([]);
  const [bundle, setBundle] = useState("…");
  const [channel] = useState<OtaChannel>("canary");
  const [status, setStatus] = useState<string | null>(null);
  const [staged, setStaged] = useState<string | null>(null);
  const [lastCheck, setLastCheck] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const rows: Row[] = [];
      try {
        const info = await CapApp.getInfo();
        rows.push({ label: "App version", value: `${info.version} (${info.build})` });
        rows.push({ label: "Package", value: info.id });
      } catch {
        rows.push({ label: "App version", value: "web preview" });
      }
      rows.push({ label: "Platform", value: Capacitor.getPlatform() });
      // The fingerprint is shown because it is the thing that decides whether an
      // OTA bundle is even offered. When an update "is not arriving", this is
      // usually the answer.
      rows.push({ label: "Native fingerprint", value: NATIVE_FINGERPRINT });
      setNative(rows);
      setBundle(await currentBundleId());
    })();
  }, []);

  const check = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const r = await checkAndStage({ channel, isBusy: pendingOfflineWork });
      setStaged(r.staged);
      setStatus(explain(r.reason));
      setLastCheck(new Date().toLocaleString());
    } finally {
      setBusy(false);
    }
  };

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
          Active bundle: <strong>{bundle}</strong>
          {bundle === "packaged" && " (shipped with the app)"}
        </div>
        <div className="meta">
          Channel: <strong>{channel}</strong>
        </div>
        <div className="meta">Last checked: {lastCheck ?? "not yet"}</div>
        {status && <div className="meta">Result: {status}</div>}

        {staged && (
          <>
            <div className="warnbox" style={{ marginTop: 10 }}>
              Update ready. It will be applied the next time the app starts.
            </div>
            <button className="btn-primary" onClick={() => void CapApp.exitApp()}>
              Restart to finish updating
            </button>
          </>
        )}

        <button style={{ marginTop: 8 }} disabled={busy} onClick={() => void check()}>
          {busy ? "Checking…" : "Check now"}
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
          onClick={async () => {
            await recoverToPackaged();
            setStatus("Recovered to the packaged version. Restart to apply.");
            setStaged(null);
          }}
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
    case "incompatible_native":
      return "An update exists but needs a newer app version. Install the new app to get it.";
    case "unsigned":
      return "Refused — the update was not properly signed.";
    case "not_https":
      return "Refused — insecure download location.";
    case "verify_failed":
      return "Refused — the update failed its integrity check. Nothing changed.";
    case "unreachable":
      return "Could not reach the update server. The app is unaffected.";
    case "not_native":
      return "Updates only apply to the installed app.";
    default:
      return reason.startsWith("server_") ? `Update server error (${reason.slice(7)}).` : reason;
  }
}
