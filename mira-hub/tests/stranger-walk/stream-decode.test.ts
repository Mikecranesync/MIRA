/**
 * The captured chat stream must keep the answer's own characters (#4460). The Hub's event stream
 * has no charset, and Playwright's `res.text()` read it as Windows-1252: the ⚠ banner became "âš ",
 * so a recorded notice no longer matched the scorer. Capture decodes the bytes as UTF-8, and old
 * recordings are repaired byte-for-byte before they are compared.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decodeChatBody, repairIfMisdecoded, repairMisdecodedStream } from "./stream-decode";
import { PINNED_S5B_STOP, servedTurnOf } from "./journey-judges";

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

describe("#5988: a stream the tablet (CDP) already mis-decoded is repaired on capture", () => {
  // paid3-tablet S5b (staging b938d52c2): the content frame's first bytes were C3 A2 E2 80 BA …
  const stop = 'data: {"kind":"content","content":"⛔ **SAFETY STOP — energized work.**\\n\\nI won’t give steps"}\n\n';
  const cdpBytes = Buffer.from(asCp1252(Buffer.from(stop, "utf8")), "utf8");
  it("the captured bytes are the mis-decode (precondition)", () => {
    expect(cdpBytes.subarray(cdpBytes.indexOf("content\":\"") + 10, cdpBytes.indexOf("content\":\"") + 15)).toEqual(Buffer.from([0xc3, 0xa2, 0xe2, 0x80, 0xba]));
  });
  it("decodeChatBody returns the original stop text", () => {
    expect(decodeChatBody(cdpBytes)).toBe(stop);
  });
  it("end to end: the pinned S5b stop survives the tablet's mis-decode, as the judge reads it", async () => {
    const body = `data: ${JSON.stringify({ kind: "content", content: PINNED_S5B_STOP })}\n\ndata: ${JSON.stringify({ kind: "status", status: "answered" })}\n\n`;
    const onTablet = Buffer.from(asCp1252(Buffer.from(body, "utf8")), "utf8");
    expect((await servedTurnOf(decodeChatBody(onTablet))).content).toBe(PINNED_S5B_STOP);
  });
  it("control: a correctly decoded stream with characters above U+00FF is unchanged", () => {
    expect(repairIfMisdecoded(stop)).toBe(stop);
  });
  it("control: plain ASCII is unchanged", () => {
    expect(repairIfMisdecoded('data: {"kind":"done"}\n')).toBe('data: {"kind":"done"}\n');
  });
  it("control: correct text whose only non-ASCII is Latin-1 is not mangled into U+FFFD", () => {
    expect(repairIfMisdecoded("data: café")).toBe("data: café");
  });
});
