// mira-web/src/lib/qr-generate.ts
/**
 * QR image generation. Thin wrapper over the `qrcode` npm package.
 *
 * Only emits URLs under https://app.factorylm.com/m/{asset_tag}. No
 * caller-supplied URL override.
 */
import QRCode from "qrcode";

const MIN_PX = 64;
const MAX_PX = 1024;
const DEFAULT_PX = 512;

export function clampSize(sizePx: number): number {
  if (!Number.isFinite(sizePx)) return DEFAULT_PX;
  return Math.max(MIN_PX, Math.min(MAX_PX, Math.floor(sizePx)));
}

export async function generatePng(url: string, sizePx: number = DEFAULT_PX): Promise<Buffer> {
  const size = clampSize(sizePx);
  return await QRCode.toBuffer(url, {
    type: "png",
    errorCorrectionLevel: "M",
    width: size,
    margin: 1,
    color: { dark: "#000000", light: "#FFFFFF" },
  });
}

export async function generateSvg(url: string): Promise<string> {
  return await QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
  });
}

export function scanUrlFor(assetTag: string): string {
  const base = process.env.PUBLIC_BASE_URL ?? "https://app.factorylm.com";
  return `${base}/m/${encodeURIComponent(assetTag)}`;
}
