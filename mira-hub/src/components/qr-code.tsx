"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

type Props = {
  value: string;
  size?: number;
  className?: string;
  alt?: string;
};

export function QrCodeImage({ value, size = 192, className, alt }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: "M",
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "QR generation failed");
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (error) {
    return (
      <div
        className={className}
        style={{ width: size, height: size }}
        role="img"
        aria-label={`QR code error: ${error}`}
      >
        <span className="text-xs text-red-600">QR error</span>
      </div>
    );
  }

  if (!dataUrl) {
    return (
      <div
        className={className}
        style={{ width: size, height: size, background: "#f1f5f9" }}
        aria-busy="true"
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={dataUrl}
      width={size}
      height={size}
      alt={alt ?? `QR code for ${value}`}
      className={className}
    />
  );
}
