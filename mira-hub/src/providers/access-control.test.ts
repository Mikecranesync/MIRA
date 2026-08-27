/**
 * Regression for the `role ?? "owner"` fallback: before this, the NextAuth
 * session never carried a role, so `accessControlProvider.can` resolved every
 * user to owner and client-side access control was a no-op for everyone.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth/react", () => ({ getSession: vi.fn() }));

import { getSession } from "next-auth/react";
import { accessControlProvider, canAccess } from "@/providers/access-control";

const mockSession = (user: Record<string, unknown> | null) =>
  vi.mocked(getSession).mockResolvedValue((user ? { user } : null) as never);

const RESOURCES = ["feed", "assets", "workorders", "documents", "parts", "schedule", "requests", "reports", "team"];
const ACTIONS = ["list", "show", "create", "edit", "delete"];

describe("accessControlProvider.can — fail closed on unresolved role", () => {
  beforeEach(() => {
    vi.mocked(getSession).mockReset();
  });

  it.each([
    ["no session", null],
    ["user without role (the pre-fix session shape)", { id: "u1", tenantId: "t1", status: "active" }],
    ["malformed role", { role: "superuser" }],
    ["legacy 'member' role", { role: "member" }],
    ["empty role", { role: "" }],
  ])("%s → can:false for every resource/action, including unknown resources", async (_label, user) => {
    mockSession(user);
    for (const resource of [...RESOURCES, "admin", "not-a-resource"]) {
      for (const action of ACTIONS) {
        const r = await accessControlProvider.can({ resource, action });
        expect(r.can, `${resource}.${action}`).toBe(false);
      }
    }
  });

  it("owner (explicitly resolved) can do everything", async () => {
    mockSession({ role: "owner" });
    expect((await accessControlProvider.can({ resource: "team", action: "delete" })).can).toBe(true);
    expect((await accessControlProvider.can({ resource: "not-a-resource", action: "x" })).can).toBe(true);
  });

  it("technician keeps its table-driven permissions", async () => {
    mockSession({ role: "technician" });
    expect((await accessControlProvider.can({ resource: "workorders", action: "create" })).can).toBe(true);
    expect((await accessControlProvider.can({ resource: "workorders", action: "delete" })).can).toBe(false);
    expect((await accessControlProvider.can({ resource: "team", action: "list" })).can).toBe(false);
  });

  it("missing resource is denied regardless of role", async () => {
    mockSession({ role: "owner" });
    expect((await accessControlProvider.can({ resource: undefined as never, action: "list" })).can).toBe(false);
  });
});

describe("canAccess — unknown resource falls to admin/owner only", () => {
  it("technician cannot touch an unlisted resource; admin can", () => {
    expect(canAccess("technician", "unlisted", "list")).toBe(false);
    expect(canAccess("admin", "unlisted", "list")).toBe(true);
  });
});
