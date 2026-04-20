// mira-web/src/lib/__tests__/qr-generate.test.ts
import { describe, test, expect } from "bun:test";
import { generatePng, generateSvg, clampSize } from "../qr-generate.js";

describe("clampSize", () => {
  test("clamps below 64 to 64", () => expect(clampSize(10)).toBe(64));
  test("clamps above 1024 to 1024", () => expect(clampSize(99999)).toBe(1024));
  test("passes through valid size", () => expect(clampSize(400)).toBe(400));
  test("defaults on NaN", () => expect(clampSize(NaN)).toBe(512));
});

describe("generatePng", () => {
  test("produces a PNG buffer for a real URL", async () => {
    const buf = await generatePng("https://app.factorylm.com/m/VFD-07", 256);
    expect(buf).toBeInstanceOf(Buffer);
    // PNG files start with 0x89 0x50 0x4E 0x47
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50);
    expect(buf[2]).toBe(0x4e);
    expect(buf[3]).toBe(0x47);
  });

  test("non-trivial size", async () => {
    const buf = await generatePng("https://app.factorylm.com/m/VFD-07", 512);
    expect(buf.length).toBeGreaterThan(500);
  });
});

describe("generateSvg", () => {
  test("returns SVG text", async () => {
    const svg = await generateSvg("https://app.factorylm.com/m/VFD-07");
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });
});
