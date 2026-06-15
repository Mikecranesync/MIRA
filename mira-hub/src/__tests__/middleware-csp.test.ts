// Regression coverage for the Content-Security-Policy built in middleware.ts.
//
// Run: cd mira-hub && npx vitest run src/__tests__/middleware-csp.test.ts
//
// #1902: the Dropbox Chooser (`dropins.js`) was CSP-blocked because
// www.dropbox.com was missing from script-src/frame-src. These tests pin the
// directives the cloud file pickers depend on so a future CSP edit can't
// silently re-break them.

import { describe, it, expect } from "vitest";
import { buildCsp } from "../middleware";

function directive(csp: string, name: string): string {
  const part = csp.split(";").map((s) => s.trim()).find((s) => s.startsWith(name + " "));
  return part ?? "";
}

describe("buildCsp — content security policy", () => {
  const csp = buildCsp("test-nonce", "/namespace");

  it("allows the Dropbox Chooser script + iframe (#1902)", () => {
    expect(directive(csp, "script-src")).toContain("https://www.dropbox.com");
    expect(directive(csp, "frame-src")).toContain("https://www.dropbox.com");
  });

  it("does NOT widen connect-src to Dropbox (picked file is downloaded server-side)", () => {
    expect(directive(csp, "connect-src")).not.toContain("dropbox");
  });

  it("keeps the Google Picker origins (the other cloud picker)", () => {
    expect(directive(csp, "script-src")).toContain("https://apis.google.com");
    expect(directive(csp, "frame-src")).toContain("https://accounts.google.com");
  });

  it("carries the per-request nonce and stays self-by-default", () => {
    expect(directive(csp, "script-src")).toContain("'nonce-test-nonce'");
    expect(directive(csp, "default-src")).toContain("'self'");
  });

  it("only relaxes frame-ancestors for the monday.com /scan iframe", () => {
    expect(buildCsp("n", "/scan")).toContain("frame-ancestors 'self' https://*.monday.com");
    expect(buildCsp("n", "/namespace")).toContain("frame-ancestors 'self'");
    expect(buildCsp("n", "/namespace")).not.toContain("monday.com");
  });
});
