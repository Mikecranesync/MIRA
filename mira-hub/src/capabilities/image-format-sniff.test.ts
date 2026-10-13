import { describe, it, expect } from "vitest";
import { sniffImageFormat } from "./image-format-sniff";

const bytes = (...xs: number[]) => new Uint8Array(xs);
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const ftyp = (brand: string) => new Uint8Array([0, 0, 0, 0x18, ...ascii("ftyp"), ...ascii(brand), 0, 0, 0, 0]);

describe("sniffImageFormat", () => {
  it.each([
    ["jpeg", bytes(0xff, 0xd8, 0xff, 0xe0)],
    ["png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
    ["gif", new Uint8Array(ascii("GIF89a"))],
    ["webp", new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")])],
    ["heic", ftyp("heic")],
    ["heic", ftyp("hevc")],
    ["heif", ftyp("mif1")],
    ["avif", ftyp("avif")],
    ["tiff", bytes(0x49, 0x49, 0x2a, 0x00)],
    ["tiff", bytes(0x4d, 0x4d, 0x00, 0x2a)],
    ["bmp", new Uint8Array([...ascii("BM"), 0, 0])],
  ] as const)("names %s", (format, input) => {
    expect(sniffImageFormat(input)).toBe(format);
  });

  it("says unknown for random bytes and for empty input", () => {
    expect(sniffImageFormat(bytes(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12))).toBe("unknown");
    expect(sniffImageFormat(new Uint8Array())).toBe("unknown");
  });

  it("does not call an ftyp box with a video brand an image (mp4 control)", () => {
    expect(sniffImageFormat(ftyp("isom"))).toBe("unknown");
  });
});
