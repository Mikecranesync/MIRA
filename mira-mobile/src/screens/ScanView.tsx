// QR scan (ADR-0034 Phase 4) — ported from the rescued Hub qr-scanner-view.tsx
// (wip/expo-scan-page-rescue-2026-05-20). Same semantics: the camera only
// starts on an explicit user gesture (iOS requirement), the stream is torn
// down on unmount and on every error, and permission/no-camera/error states
// are first-class. Adapted for the Capacitor WebView (secure origin ⇒
// getUserMedia works once CAMERA is granted; Capacitor's bridge surfaces the
// native permission prompt) and single-fire: the first successful decode
// stops the scanner BEFORE routing so the camera LED never outlives the view.
import { useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";

type Status = "idle" | "starting" | "scanning" | "denied" | "no-camera" | "error";

export function ScanView({
  onResult,
  onCancel,
}: {
  onResult: (text: string) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const firedRef = useRef(false);
  const [status, setStatus] = useState<Status>("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const teardown = () => {
    scannerRef.current?.stop();
    scannerRef.current?.destroy();
    scannerRef.current = null;
  };

  const start = async () => {
    if (!videoRef.current || scannerRef.current) return;
    setStatus("starting");
    setErrMsg(null);
    try {
      if (!(await QrScanner.hasCamera())) {
        setStatus("no-camera");
        return;
      }
      const scanner = new QrScanner(
        videoRef.current,
        (result) => {
          if (firedRef.current) return;
          firedRef.current = true;
          teardown();
          onResult(result.data);
        },
        {
          highlightScanRegion: true,
          highlightCodeOutline: true,
          preferredCamera: "environment",
          maxScansPerSecond: 5,
        },
      );
      scannerRef.current = scanner;
      await scanner.start();
      setStatus("scanning");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrMsg(msg);
      setStatus(/permission|denied|notallowed/i.test(msg) ? "denied" : "error");
      teardown();
    }
  };

  useEffect(() => teardown, []);

  return (
    <div className="content bottompad">
      <button className="btn-link" onClick={onCancel}>
        ← Assets
      </button>
      <div className="scanbox">
        <video ref={videoRef} playsInline muted />
        {status !== "scanning" && (
          <div className="scan-overlay">
            {status === "idle" && (
              <>
                <p>Point the camera at an asset QR code.</p>
                <button className="btn-primary" style={{ width: "auto" }} onClick={() => void start()}>
                  Start scanner
                </button>
              </>
            )}
            {status === "starting" && <p>Starting camera…</p>}
            {status === "denied" && (
              <>
                <p>
                  <b>Camera access denied</b>
                </p>
                <p>Allow camera for FactoryLM in system settings, then retry.</p>
                <button style={{ width: "auto" }} onClick={() => void start()}>
                  Retry
                </button>
              </>
            )}
            {status === "no-camera" && <p>No camera detected on this device.</p>}
            {status === "error" && (
              <>
                <p>
                  <b>Scanner error</b>
                </p>
                <p style={{ fontSize: 12, wordBreak: "break-all" }}>{errMsg}</p>
                <button style={{ width: "auto" }} onClick={() => void start()}>
                  Retry
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
