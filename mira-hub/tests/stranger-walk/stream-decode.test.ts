/**
 * The captured chat stream must keep the answer's own characters (#4460). The Hub's event stream
 * has no charset, and Playwright's `res.text()` read it as Windows-1252: the ⚠ banner became "âš ",
 * so a recorded notice no longer matched the scorer. Capture decodes the bytes as UTF-8, and old
 * recordings are repaired byte-for-byte before they are compared.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decodeChatBody, repairMisdecodedStream } from "./stream-decode";

const frame = 'data: {"kind":"content","content":"⚠ Wait 5 minutes – then measure 0 V “at the DC bus”"}\n\n';
const bytes = Buffer.from(frame, "utf8");
// What `res.text()` produced: each UTF-8 byte read as one Windows-1252 character.
const CP1252_HIGH = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ";
const asCp1252 = (b: Buffer) => [...b].map((x) => (x >= 0x80 && x <= 0x9f ? CP1252_HIGH[x - 0x80] : String.fromCharCode(x))).join("");

describe("chat stream capture", () => {
  it("decodes the body bytes as UTF-8, keeping the banner, dashes and quotes", () => {
    expect(decodeChatBody(bytes)).toBe(frame);
    expect(decodeChatBody(bytes)).not.toMatch(/â/);
  });

  it("accepts a Uint8Array as well as a Buffer", () => {
    expect(decodeChatBody(new Uint8Array(bytes))).toBe(frame);
  });

  it("walk.spec captures through decodeChatBody, not res.text()", () => {
    const code = readFileSync(path.join(__dirname, "walk.spec.ts"), "utf8").replace(/^\s*(\/\/|\*).*$/gm, "");
    expect(code).toMatch(/const sse = .*res\.body\(\)\.then\(\(b\) => decodeChatBody\(b\)/);
    expect(code).not.toMatch(/\bres\.text\(\)/);
  });
});

describe("repairing a recording made before the fix", () => {
  it("maps a Windows-1252 mis-decode back to the original text", () => {
    const misdecoded = asCp1252(bytes);
    expect(misdecoded).toMatch(/âš/);
    expect(repairMisdecodedStream(misdecoded)).toBe(frame);
  });

  it("leaves plain ASCII unchanged", () => {
    expect(repairMisdecodedStream('data: {"kind":"done"}\n')).toBe('data: {"kind":"done"}\n');
  });

  it("refuses text that was not a byte-wise mis-decode", () => {
    expect(() => repairMisdecodedStream("⚠ already decoded")).toThrow(/not a byte-wise mis-decode/);
  });
});
