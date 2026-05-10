"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Printer, X } from "lucide-react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  onClose: () => void;
  value: string;
  assetName: string;
  assetTag: string;
};

// Modal designed to be held up at arm's length (~3 ft) so a colleague can
// scan from their phone. White background, high error correction, and a
// canvas-rendered code at 320px so the printed/downloaded copy is crisp.
export function QrCodeModal({ open, onClose, value, assetName, assetTag }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    QRCode.toDataURL(value, {
      width: 640,
      margin: 2,
      errorCorrectionLevel: "H",
      color: { dark: "#000000", light: "#FFFFFF" },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, value]);

  // Esc-to-close: a tablet at the expo is touch-only, but the modal also
  // shows on desktop, where keyboard dismissal is expected.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleDownload = useCallback(() => {
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${assetTag}-qr.png`;
    a.click();
  }, [dataUrl, assetTag]);

  const handlePrint = useCallback(() => {
    if (!dataUrl) return;
    const w = window.open("", "_blank", "noopener,noreferrer");
    if (!w) return;
    w.document.write(`<!doctype html>
<html>
  <head>
    <title>${assetTag} — QR</title>
    <style>
      @page { margin: 0.5in; }
      body { margin: 0; font-family: -apple-system, system-ui, sans-serif; text-align: center; padding: 1in; }
      img { width: 4in; height: 4in; image-rendering: pixelated; }
      .tag { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 14pt; margin-top: 12pt; color: #475569; }
      .name { font-size: 22pt; font-weight: 600; margin-top: 4pt; }
    </style>
  </head>
  <body>
    <img src="${dataUrl}" alt="QR code for ${assetTag}" />
    <div class="tag">${assetTag}</div>
    <div class="name">${assetName}</div>
    <script>window.onload = () => { window.print(); };</script>
  </body>
</html>`);
    w.document.close();
  }, [dataUrl, assetName, assetTag]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`QR code for ${assetName}`}
      onClick={onClose}
    >
      <div
        className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 p-2 rounded-full hover:bg-slate-100 text-slate-600"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex justify-center pt-2">
          {dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={dataUrl}
              alt={`QR code for ${assetTag}`}
              width={320}
              height={320}
              className="w-[320px] h-[320px] bg-white"
              style={{ imageRendering: "pixelated" }}
            />
          ) : (
            <div className="w-[320px] h-[320px] bg-slate-100 animate-pulse rounded" />
          )}
        </div>

        <div className="mt-4">
          <div className="text-xs font-mono uppercase tracking-wide text-slate-500">{assetTag}</div>
          <h2 className="text-xl font-semibold mt-1 text-slate-900">{assetName}</h2>
          <p className="text-xs text-slate-500 mt-2">
            Hold up to a phone camera. Scans open the asset page after sign-in.
          </p>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={handleDownload}
            disabled={!dataUrl}
          >
            <Download className="w-4 h-4 mr-2" />
            Download PNG
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={handlePrint}
            disabled={!dataUrl}
          >
            <Printer className="w-4 h-4 mr-2" />
            Print
          </Button>
        </div>
      </div>
    </div>
  );
}
