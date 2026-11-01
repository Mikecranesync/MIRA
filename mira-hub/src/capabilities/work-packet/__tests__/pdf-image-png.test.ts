/** pdf-image-png.test.ts — decoded manual photos to PNG data URLs (#4982 illustrated steps). */
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodedImageToPng } from "../pdf-image-png";

function decode(url: string) {
  const buf = Buffer.from(url.replace(/^data:image\/png;base64,/, ""), "base64");
  expect([...buf.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20), colourType = buf[25];
  const idatLen = buf.readUInt32BE(33);
  expect(buf.subarray(37, 41).toString("ascii")).toBe("IDAT");
  const raw = inflateSync(buf.subarray(41, 41 + idatLen));
  return { w, h, colourType, raw };
}

describe("decodedImageToPng", () => {
  it("an all-grey RGB photo is stored as one grey channel, pixel for pixel", () => {
    const data = new Uint8Array([10, 10, 10, 200, 200, 200, 30, 30, 30, 40, 40, 40]);
    const png = decode(decodedImageToPng({ width: 2, height: 2, kind: 2, data })!);
    expect(png).toMatchObject({ w: 2, h: 2, colourType: 0 });
    expect([...png.raw]).toEqual([0, 10, 200, 0, 30, 40]);
  });

  it("a colour photo keeps its three channels", () => {
    const data = new Uint8Array([255, 0, 0, 0, 255, 0]);
    const png = decode(decodedImageToPng({ width: 2, height: 1, kind: 2, data })!);
    expect(png).toMatchObject({ w: 2, h: 1, colourType: 2 });
    expect([...png.raw]).toEqual([0, 255, 0, 0, 0, 255, 0]);
  });

  it("a photo wider than 360px is shrunk by averaging whole pixels", () => {
    const data = new Uint8Array(720 * 1 * 3);
    for (let x = 0; x < 720; x++) data.fill(x % 2 === 0 ? 0 : 100, x * 3, x * 3 + 3);
    const png = decode(decodedImageToPng({ width: 720, height: 2, kind: 2, data: new Uint8Array([...data, ...data]) })!);
    expect(png).toMatchObject({ w: 360, h: 1, colourType: 0 });
    expect(png.raw[1]).toBe(50);
  });

  it("an unknown pixel format or short data is null, never a broken image", () => {
    expect(decodedImageToPng({ width: 2, height: 2, kind: 9, data: new Uint8Array(12) })).toBeNull();
    expect(decodedImageToPng({ width: 2, height: 2, kind: 2, data: new Uint8Array(3) })).toBeNull();
  });
});
