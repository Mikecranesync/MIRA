"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Keyboard, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { extractAssetTag } from "@/lib/scan-target";

type ScanState = "starting" | "scanning" | "denied" | "unsupported" | "error";

type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
};

export default function ScanPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const [state, setState] = useState<ScanState>("starting");
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (typeof window === "undefined") return;
    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
      .BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      return;
    }
    setState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (!v) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      v.srcObject = stream;
      await v.play().catch(() => null);
      const detector = new Detector({ formats: ["qr_code"] });
      setState("scanning");

      const tick = async () => {
        if (!videoRef.current || !streamRef.current) return;
        try {
          if (videoRef.current.readyState >= 2) {
            const results = await detector.detect(videoRef.current);
            if (results.length > 0) {
              const tag = extractAssetTag(results[0].rawValue);
              if (tag) {
                stop();
                router.push(`/m/${encodeURIComponent(tag)}`);
                return;
              }
            }
          }
        } catch {
          // Frame decode error — common when motion-blurred. Keep trying.
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      const err = e as DOMException;
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setState("denied");
      } else if (err.name === "NotFoundError" || err.name === "OverconstrainedError") {
        setState("error");
        setError("No camera was found on this device.");
      } else {
        setState("error");
        setError(err.message || "Could not start the camera.");
      }
    }
  }, [router, stop]);

  useEffect(() => {
    // Defer to a microtask so the synchronous setState calls inside start()
    // (when BarcodeDetector is unsupported or before the first await) don't
    // cascade renders directly from the effect body.
    queueMicrotask(() => {
      void start();
    });
    return stop;
  }, [start, stop]);

  function submitManual(e: React.FormEvent) {
    e.preventDefault();
    const tag = extractAssetTag(manual);
    if (!tag) return;
    stop();
    router.push(`/m/${encodeURIComponent(tag)}`);
  }

  const manualValid = extractAssetTag(manual) !== null;
  const showCamera = state === "starting" || state === "scanning";

  return (
    <div className="w-full max-w-md mx-auto px-4 py-6">
      <h1 className="text-2xl font-semibold mb-1" style={{ color: "var(--foreground)" }}>
        Scan an asset
      </h1>
      <p className="text-sm mb-4" style={{ color: "var(--foreground-muted)" }}>
        Point your camera at a MIRA QR label to anchor your next action to that
        asset.
      </p>

      {showCamera ? (
        <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-black">
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            playsInline
            muted
            aria-label="Camera viewfinder"
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
              className="w-2/3 aspect-square border-2 border-white/80 rounded-2xl"
              style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)" }}
            />
          </div>
          <div className="absolute bottom-3 left-3 right-3 text-center text-white text-xs font-medium">
            {state === "starting" ? "Starting camera…" : "Scanning for QR codes…"}
          </div>
        </div>
      ) : null}

      {state === "denied" ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex gap-3">
          <AlertCircle className="h-5 w-5 text-amber-700 shrink-0" />
          <div>
            <p className="font-semibold text-amber-900">Camera permission denied</p>
            <p className="text-sm text-amber-800 mt-1">
              Enable camera access in your browser&apos;s site settings, then
              reload — or type the asset tag below.
            </p>
            <Button size="sm" variant="outline" className="mt-3" onClick={start}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Try again
            </Button>
          </div>
        </div>
      ) : null}

      {state === "unsupported" ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 flex gap-3">
          <Keyboard className="h-5 w-5 text-slate-700 shrink-0" />
          <div>
            <p className="font-semibold text-slate-900">
              In-page scanning isn&apos;t available here
            </p>
            <p className="text-sm text-slate-700 mt-1">
              This browser doesn&apos;t support in-page QR decoding. Type the
              asset tag below, or scan the label with your phone&apos;s default
              camera app — it will open the asset directly.
            </p>
          </div>
        </div>
      ) : null}

      {state === "error" ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 flex gap-3">
          <AlertCircle className="h-5 w-5 text-rose-700 shrink-0" />
          <div>
            <p className="font-semibold text-rose-900">Couldn&apos;t start the camera</p>
            <p className="text-sm text-rose-800 mt-1">{error ?? "Unknown error"}</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={start}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Try again
            </Button>
          </div>
        </div>
      ) : null}

      <form onSubmit={submitManual} className="mt-5">
        <label
          className="block text-xs uppercase tracking-wide mb-1"
          style={{ color: "var(--foreground-muted)" }}
          htmlFor="scan-manual"
        >
          Or enter the asset tag manually
        </label>
        <div className="flex gap-2">
          <input
            id="scan-manual"
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            placeholder="e.g. VFD-07"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            className="flex-1 h-11 rounded-lg border px-3 font-mono text-sm"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-0)" }}
          />
          <Button type="submit" size="lg" disabled={!manualValid}>
            Open
          </Button>
        </div>
      </form>
    </div>
  );
}
