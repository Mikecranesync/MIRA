// Run: npx vitest run src/lib/visual/signed-url.test.ts
//
// Signed evidence tokens (PR V2): short-lived, tenant-bound, fail-closed.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mintEvidenceToken, verifyEvidenceToken } from "./signed-url";

const EVIDENCE = "11111111-2222-3333-4444-555555555555";
const TENANT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("signed evidence tokens", () => {
  beforeEach(() => {
    process.env.VISUAL_EVIDENCE_SIGNING_SECRET = "unit-test-secret-0123456789";
  });
  afterEach(() => {
    delete process.env.VISUAL_EVIDENCE_SIGNING_SECRET;
  });

  it("mints and verifies a token bound to evidence + tenant", () => {
    const token = mintEvidenceToken(EVIDENCE, TENANT);
    expect(token).toBeTruthy();
    const verified = verifyEvidenceToken(token!, EVIDENCE);
    expect(verified).toEqual({ tenantId: TENANT });
  });

  it("rejects a token presented for a different evidence id", () => {
    const token = mintEvidenceToken(EVIDENCE, TENANT)!;
    expect(verifyEvidenceToken(token, "99999999-8888-7777-6666-555555555555")).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = mintEvidenceToken(EVIDENCE, TENANT, -10)!;
    expect(verifyEvidenceToken(token, EVIDENCE)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const token = mintEvidenceToken(EVIDENCE, TENANT)!;
    const [v, payload, sig] = token.split(".");
    const flipped = (sig[0] === "0" ? "1" : "0") + sig.slice(1);
    expect(verifyEvidenceToken(`${v}.${payload}.${flipped}`, EVIDENCE)).toBeNull();
  });

  it("rejects a payload re-signed under a different secret", () => {
    const token = mintEvidenceToken(EVIDENCE, TENANT)!;
    process.env.VISUAL_EVIDENCE_SIGNING_SECRET = "a-completely-different-secret";
    expect(verifyEvidenceToken(token, EVIDENCE)).toBeNull();
  });

  it("rejects malformed tokens", () => {
    expect(verifyEvidenceToken("", EVIDENCE)).toBeNull();
    expect(verifyEvidenceToken("v1.onlytwo", EVIDENCE)).toBeNull();
    expect(verifyEvidenceToken("v2.a.b", EVIDENCE)).toBeNull();
    expect(verifyEvidenceToken("v1.!!!.deadbeef", EVIDENCE)).toBeNull();
  });

  it("fails closed with no secret configured", () => {
    const token = mintEvidenceToken(EVIDENCE, TENANT)!;
    delete process.env.VISUAL_EVIDENCE_SIGNING_SECRET;
    expect(mintEvidenceToken(EVIDENCE, TENANT)).toBeNull();
    expect(verifyEvidenceToken(token, EVIDENCE)).toBeNull();
  });

  it("fails closed with a too-short secret", () => {
    process.env.VISUAL_EVIDENCE_SIGNING_SECRET = "short";
    expect(mintEvidenceToken(EVIDENCE, TENANT)).toBeNull();
  });
});
