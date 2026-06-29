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
    role: "owner",
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

  // #2360: intra-tenant admin governance caps gated on hub_users.role.
  it("owner and admin roles get the governance caps", () => {
    for (const role of ["owner", "admin"]) {
      const caps = getCapabilities(ctx({ role }));
      expect(caps).toContain("proposals.decide");
      expect(caps).toContain("asset_agent.transition");
    }
  });

  it("non-admin tenant roles do NOT get governance caps", () => {
    for (const role of ["manager", "scheduler", "technician", "operator", "viewer"]) {
      const caps = getCapabilities(ctx({ role }));
      expect(caps).not.toContain("proposals.decide");
      expect(caps).not.toContain("asset_agent.transition");
      // still a normal tenant user
      expect(caps).toContain("workspace.read");
    }
  });

  it("unknown/empty role string never satisfies a governance gate (least-privilege)", () => {
    for (const role of ["", "superadmin", "ADMIN ", "root"]) {
      expect(hasCapability(ctx({ role }), "proposals.decide")).toBe(false);
      expect(hasCapability(ctx({ role }), "asset_agent.transition")).toBe(false);
    }
  });

  // #2360 deferred slice / #578: the full role → write-capability matrix.
  // Each role gets EXACTLY its documented write caps; everything else denied.
  it("operator (most-restricted) gets NO write caps — read-only", () => {
    const caps = getCapabilities(ctx({ role: "operator" }));
    for (const cap of [
      "assets.create", "assets.write", "work_orders.create", "work_orders.update",
      "pm_schedules.write", "pm_schedules.complete", "reports.generate",
      "namespace.admin", "proposals.decide", "asset_agent.transition",
    ] as const) {
      expect(caps).not.toContain(cap);
    }
    expect(caps).toContain("workspace.read"); // still an authed tenant user
  });

  it("technician executes work: WO create/update + PM complete only", () => {
    const caps = getCapabilities(ctx({ role: "technician" }));
    expect(caps).toContain("work_orders.create");
    expect(caps).toContain("work_orders.update");
    expect(caps).toContain("pm_schedules.complete");
    for (const cap of [
      "assets.create", "assets.write", "pm_schedules.write",
      "reports.generate", "namespace.admin",
    ] as const) {
      expect(caps).not.toContain(cap);
    }
  });

  it("scheduler owns the PM calendar + reports; no asset/WO mutation", () => {
    const caps = getCapabilities(ctx({ role: "scheduler" }));
    expect(caps).toContain("pm_schedules.write");
    expect(caps).toContain("pm_schedules.complete");
    expect(caps).toContain("reports.generate");
    for (const cap of [
      "assets.create", "assets.write", "work_orders.create",
      "work_orders.update", "namespace.admin",
    ] as const) {
      expect(caps).not.toContain(cap);
    }
  });

  it("manager has asset/WO/report scope; NOT namespace/governance", () => {
    const caps = getCapabilities(ctx({ role: "manager" }));
    for (const cap of [
      "assets.create", "assets.write", "work_orders.create", "work_orders.update",
      "pm_schedules.write", "pm_schedules.complete", "reports.generate",
    ] as const) {
      expect(caps).toContain(cap);
    }
    expect(caps).not.toContain("namespace.admin");
    expect(caps).not.toContain("proposals.decide");
    expect(caps).not.toContain("asset_agent.transition");
  });

  it("admin/owner hold full intra-tenant authority incl. namespace.admin", () => {
    for (const role of ["admin", "owner"]) {
      const caps = getCapabilities(ctx({ role }));
      for (const cap of [
        "assets.create", "assets.write", "work_orders.create", "work_orders.update",
        "pm_schedules.write", "pm_schedules.complete", "reports.generate",
        "namespace.admin", "proposals.decide", "asset_agent.transition",
      ] as const) {
        expect(caps).toContain(cap);
      }
    }
  });

  it("unknown role gets no write caps (least-privilege across the matrix)", () => {
    const caps = getCapabilities(ctx({ role: "supervisor" }));
    for (const cap of [
      "assets.create", "work_orders.create", "pm_schedules.write",
      "reports.generate", "namespace.admin",
    ] as const) {
      expect(caps).not.toContain(cap);
    }
  });
});
