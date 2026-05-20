"use client";

import { useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";

type Props = {
  onScan: (text: string) => void;
  onError?: (msg: string) => void;
};

type Status = "idle" | "starting" | "scanning" | "denied" | "no-camera" | "error";

// iOS Safari only opens the camera after a user gesture, so the scanner stays
// idle until the operator taps "Start scanner". The camera stream is torn down
// on unmount and on every error to avoid leaving the LED on after navigation.
export function QrScannerView({ onScan, onError }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const start = async () => {
    if (!videoRef.current || scannerRef.current) return;
    setStatus("starting");
    setErrMsg(null);
    try {
      const hasCamera = await QrScanner.hasCamera();
      if (!hasCamera) {
        setStatus("no-camera");
        return;
      }
      const scanner = new QrScanner(
        videoRef.current,
        (result) => onScan(result.data),
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
      if (/permission|denied|notallowed/i.test(msg)) {
        setStatus("denied");
      } else {
        setStatus("error");
        setErrMsg(msg);
      }
      scannerRef.current?.destroy();
      scannerRef.current = null;
      onError?.(msg);
    }
  };

  useEffect(() => {
    return () => {
      scannerRef.current?.stop();
      scannerRef.current?.destroy();
      scannerRef.current = null;
    };
  }, []);

  return (
    <div className="relative w-full aspect-square max-w-md mx-auto overflow-hidden rounded-xl bg-black">
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        playsInline
        muted
      />
      {status !== "scanning" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/70 text-white p-6 text-center">
          {status === "idle" && (
            <>
              <p className="text-base">Camera off. Tap to scan an asset QR code.</p>
              <button
                type="button"
                onClick={start}
                className="px-6 py-3 rounded-full bg-white text-slate-900 font-semibold text-lg shadow"
              >
                Start scanner
              </button>
            </>
          )}
          {status === "starting" && <p>Starting camera…</p>}
          {status === "denied" && (
            <>
              <p className="font-semibold">Camera access denied</p>
              <p className="text-sm text-slate-300">
                Allow camera in your browser settings, then reload this page.
              </p>
            </>
          )}
          {status === "no-camera" && (
            <p className="font-semibold">No camera detected on this device.</p>
          )}
          {status === "error" && (
            <>
              <p className="font-semibold">Scanner error</p>
              <p className="text-xs text-slate-300 break-all">{errMsg}</p>
              <button
                type="button"
                onClick={start}
                className="mt-2 px-4 py-2 rounded bg-white text-slate-900 text-sm"
              >
                Retry
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
