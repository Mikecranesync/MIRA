import { useRef, useState } from "react";
import { Button } from "@vibe/core";
import { fileToBase64 } from "../lib/image.js";
import { ApiError, scanExtract } from "../lib/api.js";

const SIGNUP_URL =
  import.meta.env.VITE_FACTORYLM_SIGNUP_URL || "https://app.factorylm.com/signup";

export default function ScanPanel({ sessionToken, onResult }) {
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [quota, setQuota] = useState(null);

  const handleFile = async (file) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setQuota(null);
    try {
      const { base64, mimeType } = await fileToBase64(file);
      const plate = await scanExtract(base64, mimeType, sessionToken);
      onResult?.(plate);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        // FastAPI's HTTPException(detail={...}) wraps the dict under
        // `detail` in the JSON response.
        const detail = (err.body && err.body.detail) || err.body || {};
        setQuota({
          used: detail.used,
          cap: detail.cap,
          message: detail.message || "Monthly scan limit reached.",
        });
      } else {
        setError(err.message || String(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const overCap = quota !== null;
  const upgradeHref = `${SIGNUP_URL}?utm=monday-scan-cap`;

  return (
    <div className="card">
      <h2 style={{ margin: 0, fontSize: 18 }}>Scan an asset nameplate</h2>
      <p className="muted" style={{ marginTop: 4 }}>
        Use the device camera or upload a photo. We extract make, model, serial,
        and electrical specs.
      </p>
      <div className="btn-row" style={{ marginTop: 12 }}>
        <Button
          onClick={() => cameraInputRef.current?.click()}
          disabled={busy || overCap}
        >
          Scan plate
        </Button>
        <Button
          kind="secondary"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy || overCap}
        >
          Upload photo
        </Button>
        {busy && <span className="muted">Reading nameplate…</span>}
      </div>
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      {overCap && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 6,
            background: "var(--primary-background-hover-color, #f4f6ff)",
            border: "1px solid var(--ui-border-color, #d0d4e4)",
          }}
        >
          <p style={{ margin: 0, fontWeight: 600 }}>
            {quota.message}
          </p>
          {Number.isFinite(quota.used) && Number.isFinite(quota.cap) && (
            <p className="muted" style={{ margin: "4px 0 8px" }}>
              {quota.used} of {quota.cap} scans used this month.
            </p>
          )}
          <Button
            kind="primary"
            onClick={() =>
              window.open(upgradeHref, "_blank", "noopener,noreferrer")
            }
          >
            Get more scans
          </Button>
        </div>
      )}
      {error && !overCap && (
        <p style={{ color: "var(--negative-color, #d83a52)", marginTop: 8 }}>
          {error}
        </p>
      )}
    </div>
  );
}
