/**
 * Work Packet (#4982) — a manual photo, as decoded by pdf.js, to a small PNG data URL.
 *
 * pdf.js hands back decoded pixels (`{ width, height, kind, data }`). This encodes them as a PNG
 * with node's zlib — no image library (package.json is a guarded control). Photos wider than
 * `MAX_WIDTH` are shrunk by whole-pixel averaging; a photo whose pixels are all grey is stored as
 * one channel, a third of the size. Returns null for anything it does not understand.
 */
import { deflateSync } from "node:zlib";

/** pdf.js ImageKind: 1 = 1 bit/pixel grey, 2 = RGB 24-bit, 3 = RGBA 32-bit. */
export interface DecodedImage {
  width: number;
  height: number;
  kind: number;
  data: Uint8Array | Uint8ClampedArray;
}

const MAX_WIDTH = 360;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** RGB pixels (3 bytes each) for any supported kind, or null. */
function toRgb(img: DecodedImage): Uint8Array | null {
  const { width: w, height: h, kind, data } = img;
  if (!(w > 0 && h > 0)) return null;
  const rgb = new Uint8Array(w * h * 3);
  if (kind === 2 && data.length >= w * h * 3) {
    rgb.set(data.subarray(0, w * h * 3));
  } else if (kind === 3 && data.length >= w * h * 4) {
    for (let i = 0; i < w * h; i++) rgb.set([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]], i * 3);
  } else if (kind === 1) {
    const rowBytes = Math.ceil(w / 8);
    if (data.length < rowBytes * h) return null;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
        rgb.fill(v, (y * w + x) * 3, (y * w + x) * 3 + 3);
      }
  } else {
    return null;
  }
  return rgb;
}

export function decodedImageToPng(img: DecodedImage): string | null {
  const full = toRgb(img);
  if (!full) return null;
  const f = Math.max(1, Math.ceil(img.width / MAX_WIDTH));
  const w = Math.floor(img.width / f);
  const h = Math.floor(img.height / f);
  if (w === 0 || h === 0) return null;
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) sum += full[((y * f + dy) * img.width + (x * f + dx)) * 3 + c];
        rgb[(y * w + x) * 3 + c] = Math.round(sum / (f * f));
      }
  let grey = true;
  for (let i = 0; i < w * h && grey; i++) grey = rgb[i * 3] === rgb[i * 3 + 1] && rgb[i * 3] === rgb[i * 3 + 2];
  const channels = grey ? 1 : 3;
  const raw = new Uint8Array(h * (1 + w * channels));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * channels)] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const o = y * (1 + w * channels) + 1 + x * channels;
      if (grey) raw[o] = rgb[(y * w + x) * 3];
      else raw.set(rgb.subarray((y * w + x) * 3, (y * w + x) * 3 + 3), o);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = grey ? 0 : 2; // colour type: greyscale / truecolour
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}
