import { describe, expect, it } from "bun:test";
import { ALLOWED_LICENSES, APPROVED_EXCEPTIONS, licenseVerdict, normalizeNoticeText } from "../../scripts/license-policy";

describe("dependency licence policy", () => {
  it("keeps the PRD §4 allowlist to MIT and Apache-2.0", () => {
    expect([...ALLOWED_LICENSES].sort()).toEqual(["Apache-2.0", "MIT"]);
    expect(licenseVerdict("anything", "1.0.0", "MIT")).toEqual({ ok: true, reason: "allowed" });
    expect(licenseVerdict("anything", "1.0.0", "Apache-2.0")).toEqual({ ok: true, reason: "allowed" });
  });

  it("fails a missing or non-allowlisted licence with no exception", () => {
    expect(licenseVerdict("anything", "1.0.0", undefined)).toEqual({ ok: false, reason: "missing" });
    expect(licenseVerdict("anything", "1.0.0", "BSD-3-Clause")).toEqual({ ok: false, reason: "not-allowed" });
    expect(licenseVerdict("anything", "1.0.0", "0BSD")).toEqual({ ok: false, reason: "not-allowed" });
  });

  it("admits each approved exception only at its exact version and licence", () => {
    expect(APPROVED_EXCEPTIONS.length).toBeGreaterThan(0);
    for (const exception of APPROVED_EXCEPTIONS) {
      expect(exception.decision).toMatch(/pull\/3731/);
      const exact = licenseVerdict(exception.name, exception.version, exception.license);
      expect(exact.ok).toBe(true);
      expect(exact.ok && exact.reason).toBe("approved-exception");
      // A bump, a licence change, or a same-licence stranger is a NEW decision.
      expect(licenseVerdict(exception.name, `${exception.version}-next`, exception.license).ok).toBe(false);
      expect(licenseVerdict(exception.name, exception.version, "GPL-3.0").ok).toBe(false);
      expect(licenseVerdict(`not-${exception.name}`, exception.version, exception.license).ok).toBe(false);
    }
  });

  it("compares notice text without caring about wrapping", () => {
    expect(normalizeNoticeText("Copyright (c)\n  Microsoft   Corporation.\n")).toBe("Copyright (c) Microsoft Corporation.");
  });
});
