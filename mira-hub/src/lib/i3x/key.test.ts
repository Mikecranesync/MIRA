import { describe, expect, it } from "vitest";
import { generateApiKey } from "@/lib/i3x/key";
import { hashKey } from "@/lib/i3x/auth";

describe("generateApiKey", () => {
  it("plaintext starts with 'mira_i3x_'", () => {
    const { plaintext } = generateApiKey();
    expect(plaintext).toMatch(/^mira_i3x_/);
  });

  it("plaintext is substantial (>40 chars)", () => {
    const { plaintext } = generateApiKey();
    expect(plaintext.length).toBeGreaterThan(40);
  });

  it("hash equals hashKey(plaintext) and is a 64-char hex string", () => {
    const { plaintext, hash } = generateApiKey();
    expect(hash).toBe(hashKey(plaintext));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("two calls produce different plaintext and hash", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.hash).not.toBe(b.hash);
  });
});
