import { useRef, useState } from "react";
import { Button } from "@vibe/core";
import { fileToBase64 } from "../lib/image.js";
import { scanExtract } from "../lib/api.js";

export default function ScanPanel({ sessionToken, onResult }) {
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const handleFile = async (file) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { base64, mimeType } = await fileToBase64(file);
      const plate = await scanExtract(base64, mimeType, sessionToken);
      onResult?.(plate);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

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
          disabled={busy}
        >
          Scan plate
        </Button>
        <Button
          kind="secondary"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
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
      {error && (
        <p style={{ color: "var(--negative-color, #d83a52)", marginTop: 8 }}>
          {error}
        </p>
      )}
    </div>
  );
}
