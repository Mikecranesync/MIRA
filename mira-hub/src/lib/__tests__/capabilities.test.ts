// #1932 anti-regression guard: the capability model that gates the nav must
// match what the backend allows, and must NOT grant platform access to a
// plain owner/trial user (the exact account in the QA finding).

import { describe, it, expect } from "vitest";
import { getCapabilities, hasCapability } from "@/lib/capabilities";
import type { SessionContext } from "@/lib/session";

function ctx(over: Partial<SessionContext>): SessionContext {
  return {
    userId: "u_1",
    tenantId: "11111111-2222-3333-4444-555555555555",
    email: "owner@example.com",
    status: "trial",
    trialExpiresAt: null,
    ...over,
  };
}

describe("getCapabilities", () => {
  it("plain owner/trial gets workspace caps but NO platform caps", () => {
    // This IS the QA user in #1932: shown as Owner, status trial, email not in
    // the platform allowlist. After the fix they must not have review access.
    const caps = getCapabilities(ctx({ email: "owner@example.com", status: "trial" }));
    expect(caps).toContain("workspace.read");
    expect(caps).toContain("team.read");
    expect(caps).not.toContain("review_queue.read");
    expect(caps).not.toContain("review_queue.decide");
    expect(caps).not.toContain("platform.users.read");
  });

  it("platform-admin email (default ADMIN_EMAILS) gets review caps", () => {
    // harperhousebuyers@gmail.com is in the default ADMIN_EMAILS allowlist.
    const caps = getCapabilities(ctx({ email: "harperhousebuyers@gmail.com", status: "trial" }));
    expect(caps).toContain("review_queue.read");
    expect(caps).toContain("review_queue.decide");
    // Review-admin by email does NOT imply the platform user-admin (status gate).
    expect(caps).not.toContain("platform.users.read");
  });

  it("status==='admin' grants platform.users.read (matches the existing API gate)", () => {
    const caps = getCapabilities(ctx({ email: "owner@example.com", status: "admin" }));
    expect(caps).toContain("platform.users.read");
    // status admin is not in the email allowlist → no review caps.
    expect(caps).not.toContain("review_queue.read");
  });

  it("hasCapability mirrors getCapabilities", () => {
    const plain = ctx({ email: "owner@example.com", status: "trial" });
    expect(hasCapability(plain, "workspace.read")).toBe(true);
    expect(hasCapability(plain, "review_queue.read")).toBe(false);
  });
});
